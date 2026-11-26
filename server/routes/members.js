import { randomUUID } from 'node:crypto'
import { memberFromRow } from '../db.js'
import { INVITABLE_ROLES, MEMBER_STATUSES, pagination } from '../lib/validation.js'

/** Build org-scoped member management handlers. */
export function createMemberHandlers(db) {
  function listMembers(req, res) {
    const orgId = req.org.id
    const { page, limit, offset } = pagination(req, 100)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const role = typeof req.query.role === 'string' ? req.query.role : ''
    const clauses = ['m.organisation_id = ?']
    const params = [orgId]
    if (search) {
      clauses.push('(lower(u.name) LIKE ? OR lower(u.email) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    if (['Owner', 'Admin', 'Mentor', 'Mentee'].includes(role)) {
      clauses.push('m.role = ?')
      params.push(role)
    }
    const where = `WHERE ${clauses.join(' AND ')}`
    const total = db.prepare(`
      SELECT COUNT(*) AS count
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      ${where}
    `).get(...params).count
    const rows = db.prepare(`
      SELECT m.*, u.name, u.email
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      ${where}
      ORDER BY CASE m.role WHEN 'Owner' THEN 0 WHEN 'Admin' THEN 1 WHEN 'Mentor' THEN 2 ELSE 3 END, m.joined_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset)
    res.json({
      organisation: {
        id: req.org.id,
        slug: req.org.slug,
        name: req.org.name,
      },
      members: rows.map(memberFromRow),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    })
  }

  function updateMember(req, res) {
    const orgId = req.org.id
    const existing = db.prepare(`
      SELECT m.*, u.name, u.email
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE (m.id = ? OR m.user_id = ?) AND m.organisation_id = ?
    `).get(req.params.id, req.params.id, orgId)
    if (!existing) {
      res.status(404).json({ error: 'Member not found.' })
      return
    }
    if (existing.role === 'Owner') {
      res.status(403).json({ error: 'The workspace owner cannot be modified.' })
      return
    }
    const nextRole = req.body?.role !== undefined ? req.body.role : existing.role
    const nextStatus = req.body?.status !== undefined ? req.body.status : existing.status
    if (!INVITABLE_ROLES.includes(nextRole)) {
      res.status(400).json({ error: 'Role must be Admin, Mentor, or Mentee.' })
      return
    }
    if (!MEMBER_STATUSES.includes(nextStatus)) {
      res.status(400).json({ error: 'Status must be Active or Suspended.' })
      return
    }
    const updateTx = db.transaction(() => {
      db.prepare(`
        UPDATE memberships SET role = ?, status = ?
        WHERE id = ? AND organisation_id = ?
      `).run(nextRole, nextStatus, existing.id, orgId)
      if (nextRole === 'Mentee') {
        const existingMentee = db.prepare('SELECT id FROM mentees WHERE organisation_id = ? AND lower(email) = ?').get(orgId, existing.email.toLowerCase())
        if (!existingMentee) {
          db.prepare('INSERT INTO mentees (id, organisation_id, name, email) VALUES (?, ?, ?, ?)').run(
            `M-${randomUUID().slice(0, 8).toUpperCase()}`,
            orgId,
            existing.name,
            existing.email.toLowerCase(),
          )
        }
      }
    })
    updateTx()
    const row = db.prepare(`
      SELECT m.*, u.name, u.email
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.id = ? AND m.organisation_id = ?
    `).get(existing.id, orgId)
    res.json({ member: memberFromRow(row) })
  }

  function deleteMember(req, res) {
    const orgId = req.org.id
    const existing = db.prepare(`
      SELECT * FROM memberships WHERE (id = ? OR user_id = ?) AND organisation_id = ?
    `).get(req.params.id, req.params.id, orgId)
    if (!existing) {
      res.status(404).json({ error: 'Member not found.' })
      return
    }
    if (existing.role === 'Owner') {
      res.status(403).json({ error: 'The workspace owner cannot be removed.' })
      return
    }
    db.prepare('DELETE FROM memberships WHERE id = ? AND organisation_id = ?').run(existing.id, orgId)
    res.json({ ok: true })
  }

  return { listMembers, updateMember, deleteMember }
}

import { randomUUID } from 'node:crypto'
import { menteeFromRow } from '../db.js'
import { verifyCsrf } from '../middleware/auth.js'
import { pagination, validateMentee } from '../lib/validation.js'

/** Register organisation-scoped mentee roster CRUD routes. */
export function registerMenteeRoutes(router, db) {
  router.get('/mentees', (req, res) => {
    const { page, limit, offset } = pagination(req)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const clauses = ['organisation_id = ?']
    const params = [req.org.id]
    if (search) {
      clauses.push('(lower(name) LIKE ? OR lower(email) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    const where = `WHERE ${clauses.join(' AND ')}`
    const total = db.prepare(`SELECT COUNT(*) AS count FROM mentees ${where}`).get(...params).count
    const rows = db.prepare(`SELECT * FROM mentees ${where} ORDER BY name LIMIT ? OFFSET ?`).all(...params, limit, offset)
    res.json({ mentees: rows.map(menteeFromRow), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } })
  })

  router.post('/mentees', verifyCsrf, (req, res) => {
    const validationError = validateMentee(req.body)
    if (validationError) {
      res.status(400).json({ error: validationError })
      return
    }
    const name = req.body.name.trim()
    const email = req.body.email.trim().toLowerCase()
    const existing = db.prepare('SELECT id FROM mentees WHERE organisation_id = ? AND lower(email) = ?').get(req.org.id, email)
    if (existing) {
      res.status(409).json({ error: 'A mentee with this email already exists.' })
      return
    }
    const mentee = { id: `M-${randomUUID().slice(0, 8).toUpperCase()}`, organisationId: req.org.id, name, email }
    db.prepare('INSERT INTO mentees (id, organisation_id, name, email) VALUES (?, ?, ?, ?)').run(mentee.id, req.org.id, name, email)
    res.status(201).json({ mentee: menteeFromRow({ ...mentee }) })
  })

  router.patch('/mentees/:id', verifyCsrf, (req, res) => {
    const validationError = validateMentee(req.body)
    if (validationError) {
      res.status(400).json({ error: validationError })
      return
    }
    const existing = db.prepare('SELECT * FROM mentees WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
    if (!existing) {
      res.status(404).json({ error: 'Mentee not found.' })
      return
    }
    const name = req.body.name.trim()
    const email = req.body.email.trim().toLowerCase()
    const duplicate = db.prepare('SELECT id FROM mentees WHERE organisation_id = ? AND lower(email) = ? AND id != ?').get(req.org.id, email, req.params.id)
    if (duplicate) {
      res.status(409).json({ error: 'A mentee with this email already exists.' })
      return
    }
    db.prepare('UPDATE mentees SET name = ?, email = ? WHERE id = ? AND organisation_id = ?').run(name, email, req.params.id, req.org.id)
    res.json({ mentee: menteeFromRow(db.prepare('SELECT * FROM mentees WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)) })
  })

  router.delete('/mentees/:id', verifyCsrf, (req, res) => {
    const deleted = db.prepare('DELETE FROM mentees WHERE id = ? AND organisation_id = ?').run(req.params.id, req.org.id)
    if (!deleted.changes) {
      res.status(404).json({ error: 'Mentee not found.' })
      return
    }
    res.json({ ok: true })
  })
}

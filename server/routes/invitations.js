import { randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { invitationFromRow, memberFromRow } from '../db.js'
import { requireAuth, verifyCsrf } from '../middleware/auth.js'
import {
  hashInvitationToken,
  maskEmail,
  pagination,
  validateInvitationCreate,
  validateInviteAccept,
} from '../lib/validation.js'
import { findInvitationByToken, rejectUnusableInvitation } from '../lib/workspaceHelpers.js'
import { createMemberHandlers } from './members.js'

/** Register public invitation preview and acceptance routes. */
export function registerPublicInvitationRoutes(router, { db, inviteLimiter }) {
  router.get('/invitations/:token', inviteLimiter, (req, res) => {
    const invitation = findInvitationByToken(db, req.params.token)
    if (rejectUnusableInvitation(res, invitation)) return
    res.json({
      invitation: {
        id: invitation.id,
        organisationName: invitation.organisation_name,
        organisationSlug: invitation.organisation_slug,
        role: invitation.role,
        type: invitation.type,
        requiresEmailMatch: invitation.type === 'email',
        emailHint: maskEmail(invitation.email),
        inviterName: invitation.created_by,
        expiresAt: invitation.expires_at,
      },
    })
  })

  router.post('/invitations/:token/accept', inviteLimiter, verifyCsrf, async (req, res, next) => {
    try {
      const validationError = validateInviteAccept(req.body)
      if (validationError) {
        res.status(400).json({ error: validationError })
        return
      }

      const invitation = findInvitationByToken(db, req.params.token)
      if (rejectUnusableInvitation(res, invitation)) return

      const name = req.body.name.trim()
      const email = req.body.email.trim().toLowerCase()
      const password = req.body.password

      if (invitation.type === 'email' && invitation.email && invitation.email.toLowerCase() !== email) {
        res.status(403).json({
          error: 'This invitation was issued for a different email address.',
          state: 'EmailMismatch',
        })
        return
      }

      const existingUser = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email)
      if (existingUser && existingUser.password_hash) {
        const matches = await bcrypt.compare(password, existingUser.password_hash)
        if (!matches) {
          res.status(401).json({
            error: 'An account with this email already exists. Enter that account password to accept this invitation.',
          })
          return
        }
      }

      const newPasswordHash = (!existingUser || !existingUser.password_hash)
        ? await bcrypt.hash(password, 10)
        : null

      const acceptTx = db.transaction(() => {
        const freshInvite = findInvitationByToken(db, req.params.token)
        if (!freshInvite) {
          return { errorStatus: 404, error: 'Invitation not found or invalid.', state: 'Invalid' }
        }
        if (freshInvite.revoked) {
          return { errorStatus: 410, error: 'This invitation has been revoked.', state: 'Revoked' }
        }
        if (Date.parse(freshInvite.expires_at) <= Date.now()) {
          return { errorStatus: 410, error: 'This invitation has expired.', state: 'Expired' }
        }

        const now = new Date().toISOString()
        let user = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email)
        if (!user) {
          const userId = `U-${randomUUID().slice(0, 8).toUpperCase()}`
          db.prepare(`
            INSERT INTO users (id, email, name, password_hash, email_verified_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(userId, email, name, newPasswordHash, now, now)
          user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
        } else if (!user.password_hash && newPasswordHash) {
          db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(newPasswordHash, user.id)
        }

        const existingMembership = db.prepare(`
          SELECT m.*, u.name, u.email
          FROM memberships m
          JOIN users u ON u.id = m.user_id
          WHERE m.user_id = ? AND m.organisation_id = ?
        `).get(user.id, freshInvite.organisation_id)

        if (existingMembership) {
          if (existingMembership.status === 'Suspended') {
            return { errorStatus: 403, error: 'Your membership in this organisation is currently suspended.' }
          }
          const linkedMentee = db.prepare('SELECT id FROM mentees WHERE organisation_id = ? AND lower(email) = ?').get(freshInvite.organisation_id, email)
          return {
            alreadyMember: true,
            member: memberFromRow(existingMembership),
            organisation: {
              id: freshInvite.organisation_id,
              name: freshInvite.organisation_name,
              slug: freshInvite.organisation_slug,
            },
            menteeId: linkedMentee?.id || null,
          }
        }

        const updated = db.prepare(`
          UPDATE invitations SET uses = uses + 1
          WHERE id = ? AND revoked = 0 AND uses < max_uses
        `).run(freshInvite.id)
        if (updated.changes === 0) {
          return { errorStatus: 410, error: 'This invitation has reached its maximum number of uses.', state: 'Exhausted' }
        }

        const membershipId = `MEM-${randomUUID().slice(0, 8).toUpperCase()}`
        db.prepare(`
          INSERT INTO memberships (id, user_id, organisation_id, role, status, joined_at)
          VALUES (?, ?, ?, ?, 'Active', ?)
        `).run(membershipId, user.id, freshInvite.organisation_id, freshInvite.role, now)

        let menteeId = null
        if (freshInvite.role === 'Mentee') {
          const existingMentee = db.prepare('SELECT id FROM mentees WHERE organisation_id = ? AND lower(email) = ?').get(freshInvite.organisation_id, email)
          if (existingMentee) {
            menteeId = existingMentee.id
          } else {
            menteeId = `M-${randomUUID().slice(0, 8).toUpperCase()}`
            db.prepare('INSERT INTO mentees (id, organisation_id, name, email) VALUES (?, ?, ?, ?)').run(
              menteeId,
              freshInvite.organisation_id,
              user.name,
              email,
            )
          }
        }

        const membershipRow = db.prepare(`
          SELECT m.*, u.name, u.email
          FROM memberships m
          JOIN users u ON u.id = m.user_id
          WHERE m.id = ?
        `).get(membershipId)

        return {
          alreadyMember: false,
          member: memberFromRow(membershipRow),
          organisation: {
            id: freshInvite.organisation_id,
            name: freshInvite.organisation_name,
            slug: freshInvite.organisation_slug,
          },
          menteeId,
        }
      })

      const result = acceptTx.immediate()
      if (result.errorStatus) {
        res.status(result.errorStatus).json({ error: result.error, state: result.state })
        return
      }
      res.status(result.alreadyMember ? 200 : 201).json(result)
    } catch (error) {
      next(error)
    }
  })
}

/** Build combined org-scoped member and invitation handlers. */
export function createMemberInvitationHandlers(db) {
  const memberHandlers = createMemberHandlers(db)

  function listInvitations(req, res) {
    const orgId = req.org.id
    const { page, limit, offset } = pagination(req, 100)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const clauses = ['organisation_id = ?']
    const params = [orgId]
    if (search) {
      clauses.push('(lower(id) LIKE ? OR lower(coalesce(email, \'\')) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    const where = `WHERE ${clauses.join(' AND ')}`
    const total = db.prepare(`SELECT COUNT(*) AS count FROM invitations ${where}`).get(...params).count
    const rows = db.prepare(`
      SELECT * FROM invitations ${where}
      ORDER BY created_at DESC, id DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset)
    res.json({
      invitations: rows.map(invitationFromRow),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    })
  }

  function createInvitation(req, res) {
    const orgId = req.org.id
    const validationError = validateInvitationCreate(req.body)
    if (validationError) {
      res.status(400).json({ error: validationError })
      return
    }
    const type = req.body.type
    const role = req.body.role
    const days = Number(req.body.days ?? 7)
    const maxUses = type === 'email' ? 1 : Number(req.body.maxUses ?? 10)
    const email = type === 'email' ? req.body.email.trim().toLowerCase() : null
    const now = new Date()
    const createdAt = now.toISOString()
    const expiresAt = new Date(now.getTime() + days * 86400000).toISOString()
    const id = `INV-${randomUUID().slice(0, 8).toUpperCase()}`
    const token = `MUNA-${randomBytes(16).toString('base64url')}`
    const tokenHash = hashInvitationToken(token)

    db.prepare(`
      INSERT INTO invitations (id, organisation_id, type, email, role, token_hash, created_by, created_at, expires_at, max_uses, uses, revoked)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    `).run(id, orgId, type, email, role, tokenHash, req.session.user.name, createdAt, expiresAt, maxUses)

    const row = db.prepare('SELECT * FROM invitations WHERE id = ?').get(id)
    res.status(201).json({
      invitation: {
        ...invitationFromRow(row),
        token,
        acceptPath: `/invite/${token}`,
      },
    })
  }

  function deleteInvitation(req, res) {
    const orgId = req.org.id
    const existing = db.prepare('SELECT * FROM invitations WHERE id = ? AND organisation_id = ?').get(req.params.id, orgId)
    if (!existing) {
      res.status(404).json({ error: 'Invitation not found.' })
      return
    }
    db.prepare('UPDATE invitations SET revoked = 1 WHERE id = ? AND organisation_id = ?').run(req.params.id, orgId)
    const row = db.prepare('SELECT * FROM invitations WHERE id = ? AND organisation_id = ?').get(req.params.id, orgId)
    res.json({ ok: true, invitation: invitationFromRow(row) })
  }

  return {
    ...memberHandlers,
    listInvitations,
    createInvitation,
    deleteInvitation,
  }
}

/** Register org-parameterized member/invitation endpoints (`/organisations/:orgId/...`). */
export function registerOrgScopedAdminRoutes(router, { auth, handlers }) {
  const { requireVerifiedEmail, resolveOrgContext, requireOrgAdmin } = auth
  router.get('/organisations/:orgId/members', requireAuth, requireVerifiedEmail, resolveOrgContext, handlers.listMembers)
  router.patch('/organisations/:orgId/members/:id', requireAuth, requireVerifiedEmail, resolveOrgContext, requireOrgAdmin, verifyCsrf, handlers.updateMember)
  router.delete('/organisations/:orgId/members/:id', requireAuth, requireVerifiedEmail, resolveOrgContext, requireOrgAdmin, verifyCsrf, handlers.deleteMember)
  router.get('/organisations/:orgId/invitations', requireAuth, requireVerifiedEmail, resolveOrgContext, handlers.listInvitations)
  router.post('/organisations/:orgId/invitations', requireAuth, requireVerifiedEmail, resolveOrgContext, requireOrgAdmin, verifyCsrf, handlers.createInvitation)
  router.delete('/organisations/:orgId/invitations/:id', requireAuth, requireVerifiedEmail, resolveOrgContext, requireOrgAdmin, verifyCsrf, handlers.deleteInvitation)
}

/** Register active-workspace member and invitation endpoints. */
export function registerActiveWorkspaceMemberRoutes(router, { requireOrgAdmin, handlers }) {
  router.get('/members', handlers.listMembers)
  router.patch('/members/:id', requireOrgAdmin, verifyCsrf, handlers.updateMember)
  router.delete('/members/:id', requireOrgAdmin, verifyCsrf, handlers.deleteMember)

  router.get('/invitations', handlers.listInvitations)
  router.post('/invitations', requireOrgAdmin, verifyCsrf, handlers.createInvitation)
  router.delete('/invitations/:id', requireOrgAdmin, verifyCsrf, handlers.deleteInvitation)
}

import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'

export function csrfMatches(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
}

export function requestHasSameOrigin(req) {
  if (req.get('sec-fetch-site') === 'cross-site') return false
  const origin = req.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === req.get('host')
  } catch {
    return false
  }
}

export function verifyCsrf(req, res, next) {
  if (!requestHasSameOrigin(req) || !csrfMatches(req.session?.csrfToken, req.get('x-csrf-token'))) {
    res.status(403).json({ error: 'Your session token is invalid or expired. Refresh the page and try again.' })
    return
  }
  next()
}

export function requireAuth(req, res, next) {
  if (!req.session?.user && !req.session?.admin) {
    res.status(401).json({ error: 'Sign-in is required.' })
    return
  }
  next()
}

/** Build database-backed authorization and tenant-scoping middleware. */
export function createAuthMiddleware(db) {
  function requireVerifiedEmail(req, res, next) {
    if (!req.session?.user?.id) {
      res.status(401).json({ error: 'Sign-in is required.' })
      return
    }
    const row = db.prepare('SELECT email_verified_at FROM users WHERE id = ?').get(req.session.user.id)
    if (!row || !row.email_verified_at) {
      res.status(403).json({
        error: 'Verify your email address before accessing your workspace.',
        emailVerificationRequired: true,
      })
      return
    }
    req.session.user.emailVerified = true
    next()
  }

  function checkLearnerAccess(req, mentee) {
    const sessionUser = req.session?.user
    if (!sessionUser?.id) {
      return { ok: false, statusCode: 401, error: 'Sign-in is required.' }
    }
    const orgId = mentee.organisation_id || 'ORG-DEFAULT'
    const membership = db.prepare(`
      SELECT role, status FROM memberships
      WHERE user_id = ? AND organisation_id = ?
    `).get(sessionUser.id, orgId)
    if (!membership || membership.status !== 'Active') {
      return { ok: false, statusCode: 403, error: 'You do not have access to this organisation.' }
    }
    if (['Owner', 'Admin', 'Mentor'].includes(membership.role)) {
      return { ok: true }
    }
    if (membership.role === 'Mentee' && sessionUser.email?.toLowerCase() === mentee.email.toLowerCase()) {
      return { ok: true }
    }
    return { ok: false, statusCode: 403, error: 'You can only view your own learner assessments.' }
  }

  function requireOrgAdmin(req, res, next) {
    if (!['Owner', 'Admin'].includes(req.org?.role)) {
      res.status(403).json({ error: 'Only workspace owners or admins can manage members and invitations.' })
      return
    }
    next()
  }

  function resolveOrgContext(req, res, next) {
    const requestedOrgKey = typeof req.params?.orgId === 'string' && req.params.orgId
      ? req.params.orgId.trim()
      : (typeof req.get('x-organisation-id') === 'string' && req.get('x-organisation-id').trim())
        ? req.get('x-organisation-id').trim()
        : req.session?.activeOrganisationId
    const row = requestedOrgKey
      ? db.prepare(`
          SELECT o.id, o.slug, o.name, m.role, m.status
          FROM memberships m
          JOIN organisations o ON o.id = m.organisation_id
          WHERE m.user_id = ? AND (o.id = ? OR o.slug = ?)
        `).get(req.session.user.id, requestedOrgKey, requestedOrgKey)
      : db.prepare(`
          SELECT o.id, o.slug, o.name, m.role, m.status
          FROM memberships m
          JOIN organisations o ON o.id = m.organisation_id
          WHERE m.user_id = ? AND m.status = 'Active'
          ORDER BY CASE m.role WHEN 'Owner' THEN 0 WHEN 'Admin' THEN 1 WHEN 'Mentor' THEN 2 ELSE 3 END, m.joined_at ASC
          LIMIT 1
        `).get(req.session.user.id)

    if (!row) {
      res.status(403).json({ error: 'You do not have access to this organisation.' })
      return
    }
    if (row.status !== 'Active') {
      res.status(403).json({ error: 'Your membership in this organisation is suspended.' })
      return
    }
    if (!['Owner', 'Admin', 'Mentor'].includes(row.role)) {
      res.status(403).json({ error: 'Workspace access requires an Owner, Admin, or Mentor role.' })
      return
    }
    req.org = { id: row.id, slug: row.slug, name: row.name, role: row.role }
    req.session.activeOrganisationId = row.id
    next()
  }

  return {
    requireVerifiedEmail,
    checkLearnerAccess,
    requireOrgAdmin,
    resolveOrgContext,
  }
}

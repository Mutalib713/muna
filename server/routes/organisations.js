import { randomUUID } from 'node:crypto'
import { uniqueSlugForOrg } from '../db.js'
import { requireAuth, verifyCsrf } from '../middleware/auth.js'
import { getUserOrganisations } from '../lib/workspaceHelpers.js'

/** Register multi-organisation listing, creation, and switching routes. */
export function registerOrganisationRoutes(router, { db, requireVerifiedEmail }) {
  router.get('/organisations', requireAuth, (req, res) => {
    const organisations = getUserOrganisations(db, req.session.user.id, req.session.user.email)
    res.json({
      organisations,
      activeOrganisationId: req.session.activeOrganisationId || organisations[0]?.id || null,
    })
  })

  router.post('/organisations', requireAuth, requireVerifiedEmail, verifyCsrf, (req, res) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
    if (name.length < 2 || name.length > 120) {
      res.status(400).json({ error: 'Organisation name must be between 2 and 120 characters.' })
      return
    }
    const createdAt = new Date().toISOString()
    const createdOrg = db.transaction(() => {
      const id = `ORG-${randomUUID().slice(0, 8).toUpperCase()}`
      const slug = uniqueSlugForOrg(db, name)
      db.prepare('INSERT INTO organisations (id, slug, name, created_at) VALUES (?, ?, ?, ?)').run(id, slug, name, createdAt)
      db.prepare(`
        INSERT INTO memberships (id, user_id, organisation_id, role, status, joined_at)
        VALUES (?, ?, ?, 'Owner', 'Active', ?)
      `).run(`MEM-${randomUUID().slice(0, 8).toUpperCase()}`, req.session.user.id, id, createdAt)
      return { id, slug, name, role: 'Owner', status: 'Active', joinedAt: createdAt }
    })()
    req.session.activeOrganisationId = createdOrg.id
    res.status(201).json({ organisation: createdOrg })
  })

  router.post('/organisations/switch', requireAuth, verifyCsrf, (req, res) => {
    const target = typeof req.body?.organisationId === 'string' && req.body.organisationId.trim()
      ? req.body.organisationId.trim()
      : (typeof req.body?.slug === 'string' ? req.body.slug.trim() : '')
    const organisations = getUserOrganisations(db, req.session.user.id, req.session.user.email)
    const matched = organisations.find((org) => org.id === target || org.slug === target)
    if (!matched) {
      res.status(403).json({ error: 'You do not have access to this organisation.' })
      return
    }
    req.session.activeOrganisationId = matched.id
    res.json({ organisation: matched, organisations })
  })
}

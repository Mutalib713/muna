import { randomUUID } from 'node:crypto'

/** Ensure the default organisation and optional owner user/membership exist. */
export function ensureWorkspaceBootstrap(db, {
  adminEmail,
  adminName = 'Administrator',
  passwordHash = null,
  orgName = 'Muna Workspace',
  orgSlug = 'muna-workspace',
} = {}) {
  return db.transaction(() => {
    const now = new Date().toISOString()
    let organisation = db.prepare('SELECT * FROM organisations ORDER BY created_at ASC LIMIT 1').get()
    if (!organisation) {
      const orgId = 'ORG-DEFAULT'
      db.prepare(`
        INSERT INTO organisations (id, slug, name, created_at)
        VALUES (?, ?, ?, ?)
      `).run(orgId, orgSlug, orgName, now)
      organisation = db.prepare('SELECT * FROM organisations WHERE id = ?').get(orgId)
    }

    const storedAdmin = !adminEmail
      ? db.prepare('SELECT name, email, password_hash FROM admin_account WHERE id = 1').get()
      : null
    const email = String(adminEmail || storedAdmin?.email || '').trim().toLowerCase()
    const name = String(adminName || storedAdmin?.name || 'Administrator').trim() || 'Administrator'
    const resolvedHash = passwordHash || storedAdmin?.password_hash || null

    if (!email) {
      return { organisation, ownerUser: null, ownerMembership: null }
    }

    let ownerUser = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email)
    if (!ownerUser) {
      const userId = `U-${randomUUID().slice(0, 8).toUpperCase()}`
      db.prepare(`
        INSERT INTO users (id, email, name, password_hash, email_verified_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(userId, email, name, resolvedHash, now, now)
      ownerUser = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
    } else if (!ownerUser.password_hash && resolvedHash) {
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(resolvedHash, ownerUser.id)
      ownerUser = db.prepare('SELECT * FROM users WHERE id = ?').get(ownerUser.id)
    }

    let ownerMembership = db.prepare(`
      SELECT * FROM memberships WHERE user_id = ? AND organisation_id = ?
    `).get(ownerUser.id, organisation.id)
    if (!ownerMembership) {
      const membershipId = `MEM-${randomUUID().slice(0, 8).toUpperCase()}`
      db.prepare(`
        INSERT INTO memberships (id, user_id, organisation_id, role, status, joined_at)
        VALUES (?, ?, ?, 'Owner', 'Active', ?)
      `).run(membershipId, ownerUser.id, organisation.id, now)
      ownerMembership = db.prepare('SELECT * FROM memberships WHERE id = ?').get(membershipId)
    }

    return { organisation, ownerUser, ownerMembership }
  })()
}

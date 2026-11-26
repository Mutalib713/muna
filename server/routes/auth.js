import { Buffer } from 'node:buffer'
import { randomBytes, randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { ensureWorkspaceBootstrap, uniqueSlugForOrg } from '../db.js'
import { csrfMatches, requireAuth, verifyCsrf } from '../middleware/auth.js'
import { hashInvitationToken, isValidEmail } from '../lib/validation.js'
import { createVerificationTokenForUser, getUserOrganisations } from '../lib/workspaceHelpers.js'

/** Register authentication, signup, verification, and session lifecycle routes. */
export function registerAuthRoutes(router, {
  db,
  setupCode,
  production,
  orgName,
  orgSlug,
  authLimiter,
  onVerificationEmail,
}) {
  function signUserIn(req, res, next, user, preferredOrgId = null, { statusCode = 200, extra = {} } = {}) {
    const organisations = getUserOrganisations(db, user.id, user.email)
    const activeOrg = (preferredOrgId && organisations.find((o) => o.id === preferredOrgId || o.slug === preferredOrgId))
      || organisations[0]
      || null
    const adminRow = db.prepare('SELECT email FROM admin_account WHERE id = 1').get()
    const isBootstrapAdmin = Boolean(adminRow && adminRow.email === user.email.toLowerCase())
    req.session.regenerate((error) => {
      if (error) {
        next(error)
        return
      }
      const userSession = {
        id: user.id,
        email: user.email,
        name: user.name,
        emailVerified: Boolean(user.email_verified_at),
        role: isBootstrapAdmin ? 'admin' : (activeOrg?.role || 'Mentee'),
      }
      req.session.user = userSession
      req.session.admin = userSession
      req.session.activeOrganisationId = activeOrg?.id || null
      req.session.csrfToken = randomBytes(32).toString('hex')
      req.session.save((saveError) => {
        if (saveError) {
          next(saveError)
          return
        }
        res.status(statusCode).json({
          user: userSession,
          organisation: activeOrg,
          organisations,
          csrfToken: req.session.csrfToken,
          ...extra,
        })
      })
    })
  }

  router.get('/auth/csrf', (req, res) => {
    if (!req.session.csrfToken) {
      req.session.csrfToken = randomBytes(32).toString('hex')
    }
    res.json({ csrfToken: req.session.csrfToken })
  })

  router.get('/auth/status', (req, res) => {
    res.json({ setupRequired: !db.prepare('SELECT 1 FROM admin_account WHERE id = 1').get() })
  })

  router.post('/auth/setup', (req, res, next) => {
    if (db.prepare('SELECT 1 FROM admin_account WHERE id = 1').get()) {
      res.status(403).json({ error: 'An admin account has already been created.' })
      return
    }
    next()
  }, authLimiter, verifyCsrf, async (req, res, next) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
      const password = typeof req.body?.password === 'string' ? req.body.password : ''
      const confirmPassword = typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : ''
      const submittedCode = typeof req.body?.setupCode === 'string' ? req.body.setupCode : ''
      if (!name || name.length > 120 || !isValidEmail(email)) {
        res.status(400).json({ error: 'Enter your name and a valid email address.' })
        return
      }
      if (password.length < 10) {
        res.status(400).json({ error: 'Your password must be at least 10 characters long.' })
        return
      }
      if (Buffer.byteLength(password, 'utf8') > 72) {
        res.status(400).json({ error: 'Your password must be no more than 72 UTF-8 bytes.' })
        return
      }
      if (password !== confirmPassword) {
        res.status(400).json({ error: 'Your passwords do not match.' })
        return
      }
      if (!csrfMatches(setupCode, submittedCode)) {
        res.status(403).json({ error: 'The setup code is incorrect.' })
        return
      }

      const passwordHash = await bcrypt.hash(password, 12)
      const createAdmin = db.transaction(() => {
        if (db.prepare('SELECT 1 FROM admin_account WHERE id = 1').get()) return false
        db.prepare('INSERT INTO admin_account (id, name, email, password_hash) VALUES (1, ?, ?, ?)')
          .run(name, email, passwordHash)
        return true
      })
      if (!createAdmin.immediate()) {
        res.status(403).json({ error: 'An admin account has already been created.' })
        return
      }
      const bootstrapped = ensureWorkspaceBootstrap(db, { adminEmail: email, adminName: name, passwordHash, orgName, orgSlug })
      signUserIn(req, res, next, bootstrapped.ownerUser, bootstrapped.organisation.id)
    } catch (error) {
      next(error)
    }
  })

  router.post('/auth/signup', authLimiter, verifyCsrf, async (req, res, next) => {
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
      const password = typeof req.body?.password === 'string' ? req.body.password : ''
      const organisationName = typeof req.body?.organisationName === 'string' ? req.body.organisationName.trim() : ''
      const requestedSlug = typeof req.body?.slug === 'string' ? req.body.slug.trim().toLowerCase() : ''

      if (!name || name.length > 120 || !isValidEmail(email)) {
        res.status(400).json({ error: 'Enter your name and a valid email address.' })
        return
      }
      if (password.length < 8) {
        res.status(400).json({ error: 'Password must be at least 8 characters long.' })
        return
      }
      if (Buffer.byteLength(password, 'utf8') > 72) {
        res.status(400).json({ error: 'Password must be no more than 72 UTF-8 bytes.' })
        return
      }
      if (!organisationName || organisationName.length > 120) {
        res.status(400).json({ error: 'Organisation name must contain 1 to 120 characters.' })
        return
      }
      if (requestedSlug && !/^[a-z0-9][a-z0-9-]{1,47}$/.test(requestedSlug)) {
        res.status(400).json({ error: 'Organisation slug must be 2–48 lowercase letters, numbers, or hyphens.' })
        return
      }

      const existingUser = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email)
      if (existingUser) {
        res.status(409).json({ error: 'An account with this email already exists.' })
        return
      }

      const passwordHash = await bcrypt.hash(password, 10)
      const signupTx = db.transaction(() => {
        if (db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email)) {
          return { statusCode: 409, error: 'An account with this email already exists.' }
        }
        const slug = requestedSlug || uniqueSlugForOrg(db, organisationName)
        if (db.prepare('SELECT 1 FROM organisations WHERE slug = ?').get(slug)) {
          return { statusCode: 409, error: 'This organisation slug is already taken.' }
        }
        const now = new Date().toISOString()
        const userId = `U-${randomUUID().slice(0, 8).toUpperCase()}`
        const orgId = `ORG-${randomUUID().slice(0, 8).toUpperCase()}`
        const membershipId = `MEM-${randomUUID().slice(0, 8).toUpperCase()}`

        db.prepare(`
          INSERT INTO users (id, email, name, password_hash, email_verified_at, created_at)
          VALUES (?, ?, ?, ?, NULL, ?)
        `).run(userId, email, name, passwordHash, now)
        db.prepare(`
          INSERT INTO organisations (id, slug, name, created_at)
          VALUES (?, ?, ?, ?)
        `).run(orgId, slug, organisationName, now)
        db.prepare(`
          INSERT INTO memberships (id, user_id, organisation_id, role, status, joined_at)
          VALUES (?, ?, ?, 'Owner', 'Active', ?)
        `).run(membershipId, userId, orgId, now)

        const verificationToken = createVerificationTokenForUser(db, userId)
        const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId)
        return { user, orgId, verificationToken }
      })

      const outcome = signupTx.immediate()
      if (outcome.error) {
        res.status(outcome.statusCode).json({ error: outcome.error })
        return
      }
      onVerificationEmail?.({ email, name, token: outcome.verificationToken })
      signUserIn(req, res, next, outcome.user, outcome.orgId, {
        statusCode: 201,
        extra: production
          ? { emailVerificationRequired: true }
          : { emailVerificationRequired: true, verificationToken: outcome.verificationToken },
      })
    } catch (error) {
      next(error)
    }
  })

  router.post('/auth/verify-email', authLimiter, verifyCsrf, (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : ''
    if (!token || token.length > 200) {
      res.status(400).json({ error: 'A verification token is required.' })
      return
    }
    const tokenHash = hashInvitationToken(token)
    const row = db.prepare('SELECT * FROM email_verification_tokens WHERE token_hash = ?').get(tokenHash)
    if (!row) {
      res.status(400).json({ error: 'Invalid or already used verification token.' })
      return
    }
    if (Date.parse(row.expires_at) <= Date.now()) {
      db.prepare('DELETE FROM email_verification_tokens WHERE token_hash = ?').run(tokenHash)
      res.status(410).json({ error: 'Verification token has expired. Request a new verification email.' })
      return
    }
    const now = new Date().toISOString()
    db.transaction(() => {
      db.prepare('UPDATE users SET email_verified_at = ? WHERE id = ?').run(now, row.user_id)
      db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(row.user_id)
    })()
    if (req.session?.user?.id === row.user_id) {
      req.session.user.emailVerified = true
    }
    res.json({ ok: true, emailVerified: true })
  })

  router.post('/auth/resend-verification', requireAuth, authLimiter, verifyCsrf, (req, res) => {
    const userId = req.session.user?.id
    const user = userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(userId) : null
    if (!user) {
      res.status(404).json({ error: 'User account not found.' })
      return
    }
    if (user.email_verified_at) {
      res.json({ ok: true, alreadyVerified: true })
      return
    }
    const verificationToken = createVerificationTokenForUser(db, user.id)
    onVerificationEmail?.({ email: user.email, name: user.name, token: verificationToken })
    res.json(production ? { ok: true } : { ok: true, verificationToken })
  })

  router.post('/auth/login', authLimiter, verifyCsrf, async (req, res, next) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
      const password = typeof req.body?.password === 'string' ? req.body.password : ''
      if (!email || !password) {
        res.status(401).json({ error: 'Invalid email or password.' })
        return
      }

      let user = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email)
      const admin = db.prepare('SELECT name, email, password_hash FROM admin_account WHERE id = 1').get()

      if (user && user.password_hash) {
        const matches = await bcrypt.compare(password, user.password_hash)
        if (!matches) {
          res.status(401).json({ error: 'Invalid email or password.' })
          return
        }
      } else if (admin && email === admin.email && await bcrypt.compare(password, admin.password_hash)) {
        const bootstrapped = ensureWorkspaceBootstrap(db, {
          adminEmail: admin.email,
          adminName: admin.name,
          passwordHash: admin.password_hash,
          orgName,
          orgSlug,
        })
        user = bootstrapped.ownerUser
      } else {
        res.status(401).json({ error: 'Invalid email or password.' })
        return
      }

      signUserIn(req, res, next, user)
    } catch (error) {
      next(error)
    }
  })

  router.get('/auth/me', requireAuth, (req, res) => {
    const userId = req.session.user?.id
    const userRow = userId ? db.prepare('SELECT * FROM users WHERE id = ?').get(userId) : null
    if (!userRow) {
      res.status(401).json({ error: 'Sign-in is required.' })
      return
    }
    const organisations = getUserOrganisations(db, userRow.id, userRow.email)
    const activeOrg = organisations.find((o) => o.id === req.session.activeOrganisationId) || organisations[0] || null
    req.session.user = {
      ...req.session.user,
      emailVerified: Boolean(userRow.email_verified_at),
    }
    req.session.activeOrganisationId = activeOrg?.id || null
    res.json({
      user: req.session.user,
      organisation: activeOrg,
      organisations,
    })
  })

  router.post('/auth/logout', requireAuth, verifyCsrf, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) {
        next(error)
        return
      }
      res.clearCookie('muna.sid', { httpOnly: true, sameSite: 'strict', secure: production, path: '/' })
      res.json({ ok: true })
    })
  })
}

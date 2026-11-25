import { Buffer } from 'node:buffer'
import { createHash, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import express from 'express'
import session from 'express-session'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import {
  answerFromRow,
  assessmentFromRow,
  ensureWorkspaceBootstrap,
  flagFromRow,
  getInvitationState,
  initialsFor,
  invitationFromRow,
  memberFromRow,
  menteeFromRow,
  questionFromRow,
} from './db.js'
import {
  formatPoints,
  gradeQuestionResponse,
  normalizeQuestionInput,
  sanitizeQuestionForLearner,
  validateQuestion,
} from './question-utils.js'
import { SQLiteSessionStore } from './sqlite-session-store.js'

const SESSION_TTL_MS = 8 * 60 * 60 * 1000

function csrfMatches(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(received)
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer)
}

function requestHasSameOrigin(req) {
  if (req.get('sec-fetch-site') === 'cross-site') return false
  const origin = req.get('origin')
  if (!origin) return true
  try {
    return new URL(origin).host === req.get('host')
  } catch {
    return false
  }
}

function verifyCsrf(req, res, next) {
  if (!requestHasSameOrigin(req) || !csrfMatches(req.session?.csrfToken, req.get('x-csrf-token'))) {
    res.status(403).json({ error: 'Your session token is invalid or expired. Refresh the page and try again.' })
    return
  }
  next()
}

function requireAdmin(req, res, next) {
  if (!req.session?.admin) {
    res.status(401).json({ error: 'Administrator sign-in is required.' })
    return
  }
  next()
}

const NAVIGATION_MODES = ['free', 'sequential']
const FEEDBACK_POLICIES = ['immediate', 'after_deadline', 'manual']

function parseOptionalIsoDate(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return false
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return false
  return new Date(ms).toISOString()
}

function validateAssessment(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Assessment details are required.'
  const title = typeof input.title === 'string' ? input.title.trim() : ''
  if (!title || title.length > 120) return 'Assessment title must contain 1 to 120 characters.'
  if (typeof input.description !== 'undefined' && (typeof input.description !== 'string' || input.description.length > 1000)) {
    return 'Assessment instructions must be 1000 characters or fewer.'
  }
  const questionIds = input.questionIds
  if (!Array.isArray(questionIds) || questionIds.length === 0 || questionIds.length > 500 || questionIds.some((id) => typeof id !== 'string' || !id)) {
    return 'Choose between 1 and 500 questions.'
  }
  if (new Set(questionIds).size !== questionIds.length) return 'A question cannot be added more than once.'
  const menteeIds = input.menteeIds
  if (!Array.isArray(menteeIds) || menteeIds.length === 0 || menteeIds.length > 500 || menteeIds.some((id) => typeof id !== 'string' || !id)) {
    return 'Assign the assessment to between 1 and 500 mentees.'
  }
  if (new Set(menteeIds).size !== menteeIds.length) return 'A mentee cannot be assigned more than once.'
  const maxAttempts = input.maxAttempts ?? 3
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 3) {
    return 'Maximum attempts must be between 1 and 3.'
  }
  if (input.timeLimitMinutes !== undefined && input.timeLimitMinutes !== null && input.timeLimitMinutes !== '') {
    const minutes = Number(input.timeLimitMinutes)
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 300) {
      return 'Time limit must be between 1 and 300 minutes.'
    }
  }
  const availableFrom = parseOptionalIsoDate(input.availableFrom)
  const availableUntil = parseOptionalIsoDate(input.availableUntil)
  if (availableFrom === false || availableUntil === false) {
    return 'Availability dates must be valid timestamps.'
  }
  if (availableFrom && availableUntil && Date.parse(availableUntil) <= Date.parse(availableFrom)) {
    return 'Availability end date must be after the start date.'
  }
  const navigationMode = input.navigationMode ?? 'free'
  if (!NAVIGATION_MODES.includes(navigationMode)) {
    return 'Navigation mode must be free or sequential.'
  }
  const feedbackPolicy = input.feedbackPolicy ?? 'immediate'
  if (!FEEDBACK_POLICIES.includes(feedbackPolicy)) {
    return 'Feedback policy must be immediate, after_deadline, or manual.'
  }
  if (feedbackPolicy === 'after_deadline' && !availableUntil) {
    return 'Set an availability end date to release feedback after the deadline.'
  }
  return null
}

function normalizeAssessmentSettings(input) {
  const timeLimitMinutes =
    input.timeLimitMinutes === undefined || input.timeLimitMinutes === null || input.timeLimitMinutes === ''
      ? null
      : Number(input.timeLimitMinutes)
  return {
    title: input.title.trim(),
    description: (input.description || '').trim(),
    maxAttempts: input.maxAttempts ?? 3,
    timeLimitMinutes,
    availableFrom: parseOptionalIsoDate(input.availableFrom),
    availableUntil: parseOptionalIsoDate(input.availableUntil),
    shuffleQuestions: input.shuffleQuestions ? 1 : 0,
    shuffleOptions: input.shuffleOptions ? 1 : 0,
    navigationMode: input.navigationMode ?? 'free',
    feedbackPolicy: input.feedbackPolicy ?? 'immediate',
  }
}

const INVITABLE_ROLES = ['Admin', 'Mentor', 'Mentee']
const MEMBER_STATUSES = ['Active', 'Suspended']

function hashInvitationToken(token) {
  return createHash('sha256').update(String(token || '').trim()).digest('hex')
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function maskEmail(email) {
  if (!email) return null
  const [local, domain] = email.split('@')
  if (!local || !domain) return null
  return `${local[0]}${'*'.repeat(Math.min(4, Math.max(1, local.length - 1)))}@${domain}`
}

function validateInvitationCreate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Invitation details are required.'
  const type = input.type
  if (type !== 'code' && type !== 'email') return 'Invitation type must be code or email.'
  const role = input.role
  if (!INVITABLE_ROLES.includes(role)) return 'Role must be Admin, Mentor, or Mentee.'
  const days = Number(input.days ?? 7)
  if (!Number.isInteger(days) || days < 1 || days > 90) return 'Expiry must be between 1 and 90 days.'
  if (type === 'email') {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
    if (!isValidEmail(email)) return 'A valid recipient email address is required.'
  } else {
    const maxUses = Number(input.maxUses ?? 10)
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100) {
      return 'Maximum uses must be a whole number between 1 and 100.'
    }
  }
  return null
}

function validateInviteAccept(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Account details are required.'
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const password = typeof input.password === 'string' ? input.password : ''
  if (!name || name.length > 120) return 'Full name must contain 1 to 120 characters.'
  if (!isValidEmail(email)) return 'A valid email address is required.'
  if (password.length < 8) return 'Password must be at least 8 characters long.'
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password must be no more than 72 UTF-8 bytes.'
  return null
}

function validateMentee(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Mentee details are required.'
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (!name || name.length > 120) return 'Mentee name must contain 1 to 120 characters.'
  if (!email || email.length > 254 || !email.includes('@')) return 'A valid mentee email is required.'
  return null
}

function pagination(req, defaultLimit = 25) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || defaultLimit))
  return { page, limit, offset: (page - 1) * limit }
}

function addQuestion(db, input) {
  const id = `Q-${randomUUID().slice(0, 8).toUpperCase()}`
  const createdAt = new Date().toISOString()
  const normalized = normalizeQuestionInput(input)
  db.prepare(`
    INSERT INTO questions (
      id, type, prompt, options_json, correct_answer,
      points, difficulty, tags_json, config_json, rubric_json,
      status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Published', ?)
  `).run(
    id,
    normalized.type,
    normalized.prompt,
    JSON.stringify(normalized.options),
    normalized.correctAnswer,
    normalized.points,
    normalized.difficulty,
    JSON.stringify(normalized.tags),
    JSON.stringify(normalized.config),
    JSON.stringify(normalized.rubric),
    createdAt,
  )
  return questionFromRow(db.prepare('SELECT * FROM questions WHERE id = ?').get(id))
}

function getReviewHistory(db, entityType, entityId) {
  return db.prepare(`
    SELECT actor, decision, note, created_at AS createdAt
    FROM review_history
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY id DESC
  `).all(entityType, entityId)
}

export function createApp({
  db,
  setupCode,
  sessionSecret,
  production = false,
  trustProxyHops = 0,
  distPath,
  orgName = 'Muna Workspace',
  orgSlug = 'muna-workspace',
}) {
  const app = express()
  const router = express.Router()
  const workspace = ensureWorkspaceBootstrap(db, { orgName, orgSlug })
  const organisationId = workspace.organisation.id
  const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many authentication attempts. Try again in 15 minutes.' },
  })
  const inviteLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many invitation checks. Try again in 15 minutes.' },
  })

  app.disable('x-powered-by')
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops)
  app.use(helmet({
    contentSecurityPolicy: production ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    } : false,
    strictTransportSecurity: production ? undefined : false,
  }))
  app.use(express.json({ limit: '512kb' }))
  app.use(session({
    name: 'muna.sid',
    secret: sessionSecret,
    store: new SQLiteSessionStore(db),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: production,
      maxAge: SESSION_TTL_MS,
      path: '/',
    },
  }))

  router.use((req, res, next) => {
    res.set('Cache-Control', 'no-store')
    next()
  })

  router.get('/auth/csrf', (req, res) => {
    if (!req.session.csrfToken) {
      req.session.csrfToken = randomBytes(32).toString('hex')
    }
    res.json({ csrfToken: req.session.csrfToken })
  })

  router.get('/auth/status', (req, res) => {
    res.json({ setupRequired: !db.prepare('SELECT 1 FROM admin_account WHERE id = 1').get() })
  })

  function signAdminIn(req, res, next, admin) {
    req.session.regenerate((error) => {
      if (error) {
        next(error)
        return
      }
      req.session.admin = { email: admin.email, name: admin.name, role: 'admin' }
      req.session.csrfToken = randomBytes(32).toString('hex')
      req.session.save((saveError) => {
        if (saveError) {
          next(saveError)
          return
        }
        res.json({ user: req.session.admin, csrfToken: req.session.csrfToken })
      })
    })
  }

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
      if (!name || name.length > 120 || !email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
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
      ensureWorkspaceBootstrap(db, { adminEmail: email, adminName: name, passwordHash, orgName, orgSlug })
      signAdminIn(req, res, next, { email, name })
    } catch (error) {
      next(error)
    }
  })

  router.post('/auth/login', authLimiter, verifyCsrf, async (req, res, next) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
      const password = typeof req.body?.password === 'string' ? req.body.password : ''
      const admin = db.prepare('SELECT name, email, password_hash FROM admin_account WHERE id = 1').get()
      const passwordMatches = admin && await bcrypt.compare(password, admin.password_hash)
      if (!admin || !email || email !== admin.email || !passwordMatches) {
        res.status(401).json({ error: 'Invalid email or password.' })
        return
      }
      signAdminIn(req, res, next, admin)
    } catch (error) {
      next(error)
    }
  })

  router.get('/auth/me', requireAdmin, (req, res) => {
    res.json({
      user: req.session.admin,
      organisation: {
        id: workspace.organisation.id,
        slug: workspace.organisation.slug,
        name: workspace.organisation.name,
      },
    })
  })

  router.post('/auth/logout', requireAdmin, verifyCsrf, (req, res, next) => {
    req.session.destroy((error) => {
      if (error) {
        next(error)
        return
      }
      res.clearCookie('muna.sid', { httpOnly: true, sameSite: 'strict', secure: production, path: '/' })
      res.json({ ok: true })
    })
  })

  function findInvitationByToken(rawToken) {
    const token = typeof rawToken === 'string' ? rawToken.trim() : ''
    if (!token || token.length > 200) return null
    const tokenHash = hashInvitationToken(token)
    return db.prepare(`
      SELECT i.*, o.name AS organisation_name, o.slug AS organisation_slug
      FROM invitations i
      JOIN organisations o ON o.id = i.organisation_id
      WHERE i.token_hash = ?
    `).get(tokenHash)
  }

  function rejectUnusableInvitation(res, invitationRow) {
    if (!invitationRow) {
      res.status(404).json({ error: 'Invitation not found or invalid.', state: 'Invalid' })
      return true
    }
    const state = getInvitationState(invitationRow)
    if (state === 'Revoked') {
      res.status(410).json({ error: 'This invitation has been revoked.', state })
      return true
    }
    if (state === 'Expired') {
      res.status(410).json({ error: 'This invitation has expired.', state })
      return true
    }
    if (state === 'Exhausted') {
      res.status(410).json({ error: 'This invitation has reached its maximum number of uses.', state })
      return true
    }
    return false
  }

  router.get('/invitations/:token', inviteLimiter, (req, res) => {
    const invitation = findInvitationByToken(req.params.token)
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
      const invitation = findInvitationByToken(req.params.token)
      if (rejectUnusableInvitation(res, invitation)) return

      const name = req.body.name.trim()
      const email = req.body.email.trim().toLowerCase()
      const password = req.body.password

      if (invitation.type === 'email' && invitation.email !== email) {
        res.status(403).json({ error: 'This invitation was issued for a different email address.' })
        return
      }

      const existingUser = db.prepare('SELECT * FROM users WHERE lower(email) = ?').get(email)
      if (existingUser) {
        const storedAdmin = !existingUser.password_hash
          ? db.prepare('SELECT email, password_hash FROM admin_account WHERE id = 1').get()
          : null
        const expectedHash = existingUser.password_hash || (storedAdmin && email === storedAdmin.email ? storedAdmin.password_hash : null)
        if (expectedHash) {
          const matches = await bcrypt.compare(password, expectedHash)
          if (!matches) {
            res.status(401).json({ error: 'An account with this email already exists. Enter your existing password to accept this invitation.' })
            return
          }
        }
      }

      const newPasswordHash = existingUser?.password_hash ? null : await bcrypt.hash(password, 10)
      const acceptTx = db.transaction(() => {
        const freshInvite = db.prepare(`
          SELECT i.*, o.name AS organisation_name, o.slug AS organisation_slug
          FROM invitations i
          JOIN organisations o ON o.id = i.organisation_id
          WHERE i.id = ?
        `).get(invitation.id)
        const state = freshInvite ? getInvitationState(freshInvite) : 'Invalid'
        if (!freshInvite || state !== 'Active') {
          return { errorStatus: state === 'Invalid' ? 404 : 410, error: 'This invitation is no longer active.', state }
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
          const linkedMentee = db.prepare('SELECT id FROM mentees WHERE lower(email) = ?').get(email)
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
          const existingMentee = db.prepare('SELECT id FROM mentees WHERE lower(email) = ?').get(email)
          if (existingMentee) {
            menteeId = existingMentee.id
          } else {
            menteeId = `M-${randomUUID().slice(0, 8).toUpperCase()}`
            db.prepare('INSERT INTO mentees (id, name, email) VALUES (?, ?, ?)').run(menteeId, user.name, email)
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

  router.use(requireAdmin)

  function shuffleList(items) {
    const copy = [...items]
    for (let i = copy.length - 1; i > 0; i--) {
      const j = randomInt(0, i + 1)
      ;[copy[i], copy[j]] = [copy[j], copy[i]]
    }
    return copy
  }

  function getAvailabilityState(assessment, nowMs = Date.now()) {
    if (assessment.available_from && nowMs < Date.parse(assessment.available_from)) return 'upcoming'
    if (assessment.available_until && nowMs > Date.parse(assessment.available_until)) return 'closed'
    return 'open'
  }

  function resultsAreVisible(assessment, nowMs = Date.now()) {
    const policy = assessment.feedback_policy || 'immediate'
    if (policy === 'immediate') return true
    if (policy === 'after_deadline') {
      return Boolean(assessment.available_until && nowMs > Date.parse(assessment.available_until))
    }
    return Boolean(assessment.results_released)
  }

  function getAttemptAllowance(assessment, menteeId) {
    const extra = db.prepare(`
      SELECT COALESCE(SUM(extra_attempts), 0) AS total
      FROM extra_attempt_grants
      WHERE assessment_id = ? AND mentee_id = ?
    `).get(assessment.id, menteeId).total
    return {
      baseAttempts: assessment.max_attempts,
      extraAttempts: extra,
      allowedAttempts: assessment.max_attempts + extra,
    }
  }

  function getOrderedLearnerQuestions(assessmentId, activeAttempt = null) {
    const rows = db.prepare(`
      SELECT q.* FROM assessment_questions aq
      JOIN questions q ON q.id = aq.question_id
      WHERE aq.assessment_id = ? ORDER BY aq.position
    `).all(assessmentId)
    const byId = new Map(rows.map((row) => [row.id, sanitizeQuestionForLearner(questionFromRow(row))]))
    let orderedIds = rows.map((row) => row.id)
    let optionOrders = {}
    if (activeAttempt) {
      try {
        const parsedOrder = JSON.parse(activeAttempt.question_order_json || '[]')
        if (Array.isArray(parsedOrder) && parsedOrder.length > 0) {
          orderedIds = parsedOrder.filter((id) => byId.has(id))
        }
      } catch {
        // ignore malformed json
      }
      try {
        optionOrders = JSON.parse(activeAttempt.option_orders_json || '{}') || {}
      } catch {
        optionOrders = {}
      }
    }
    return orderedIds.map((id) => {
      const q = { ...byId.get(id) }
      if (Array.isArray(optionOrders[id]) && optionOrders[id].length === q.options.length) {
        q.options = optionOrders[id]
      }
      return q
    })
  }

  function finalizeAttemptRecord({
    assessment,
    mentee,
    submittedAnswers,
    existingAttempt = null,
    status = 'submitted',
    submittedAt = new Date().toISOString(),
    allowPartial = false,
  }) {
    const questionRows = db.prepare(`
      SELECT q.* FROM assessment_questions aq
      JOIN questions q ON q.id = aq.question_id
      WHERE aq.assessment_id = ? ORDER BY aq.position
    `).all(assessment.id)

    const gradedItems = []
    for (const row of questionRows) {
      const question = questionFromRow(row)
      const rawResponse = submittedAnswers?.[question.id]
      const graded = gradeQuestionResponse(question, rawResponse)
      if (graded.error) {
        if (!allowPartial) {
          return { error: graded.error }
        }
        const manualType = question.type === 'theory' || question.type === 'drawing' ||
          (question.type === 'short_answer' && (question.acceptedAnswers?.length ?? 0) === 0)
        gradedItems.push({
          questionId: question.id,
          type: question.type,
          prompt: question.prompt,
          maxPoints: Number(question.points ?? 1),
          rubric: question.rubric || [],
          response: rawResponse ?? null,
          summaryText: '(No answer saved)',
          earnedPoints: 0,
          autoGraded: !manualType,
          needsReview: manualType,
        })
      } else {
        gradedItems.push(graded)
      }
    }

    const earnedPoints = Math.round(gradedItems.reduce((sum, item) => sum + item.earnedPoints, 0) * 100) / 100
    const maxPoints = Math.round(gradedItems.reduce((sum, item) => sum + item.maxPoints, 0) * 100) / 100
    const needsManualGrading = gradedItems.some((item) => item.needsReview)
    const gradingStatus = needsManualGrading ? 'Needs manual grading' : 'Graded'
    const score = `${formatPoints(earnedPoints)} / ${formatPoints(maxPoints)}`
    const attemptId = existingAttempt?.id || `AT-${randomUUID().slice(0, 8).toUpperCase()}`
    const answerId = `A-${randomUUID().slice(0, 8).toUpperCase()}`
    const answerSummary = gradedItems.map((item) => `${item.prompt}: ${item.summaryText}`).join('\n')
    const storedAnswers = gradedItems.map((item) => ({
      questionId: item.questionId,
      type: item.type,
      response: item.response,
      earnedPoints: item.earnedPoints,
      maxPoints: item.maxPoints,
      needsReview: item.needsReview,
    }))

    if (existingAttempt) {
      db.prepare(`
        UPDATE assessment_attempts
        SET answers_json = ?, score = ?, grading_status = ?, earned_points = ?, max_points = ?,
            status = ?, submitted_at = ?
        WHERE id = ?
      `).run(JSON.stringify(storedAnswers), score, gradingStatus, earnedPoints, maxPoints, status, submittedAt, attemptId)
    } else {
      db.prepare(`
        INSERT INTO assessment_attempts (
          id, assessment_id, mentee_id, answers_json, score, grading_status, earned_points, max_points,
          status, started_at, submitted_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(attemptId, assessment.id, mentee.id, JSON.stringify(storedAnswers), score, gradingStatus, earnedPoints, maxPoints, status, submittedAt, submittedAt)
    }

    db.prepare(`
      INSERT INTO answers (
        id, attempt_id, student, initials, assessment, answer, score,
        earned_points, max_points, items_json, submitted_at, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Needs review')
    `).run(
      answerId,
      attemptId,
      mentee.name,
      initialsFor(mentee.name),
      assessment.title,
      answerSummary,
      score,
      earnedPoints,
      maxPoints,
      JSON.stringify(gradedItems),
      submittedAt,
    )

    return {
      attempt: {
        id: attemptId,
        status,
        score,
        earnedPoints,
        maxPoints,
        gradingStatus,
        needsManualGrading,
        submittedAt,
      },
    }
  }

  function expireOverdueAttemptIfNeeded(assessment, mentee, attempt) {
    if (!attempt || attempt.status !== 'in_progress' || !attempt.expires_at) return null
    if (Date.now() < Date.parse(attempt.expires_at)) return null
    let draftAnswers = {}
    try {
      draftAnswers = JSON.parse(attempt.draft_answers_json || '{}') || {}
    } catch {
      draftAnswers = {}
    }
    const tx = db.transaction(() => finalizeAttemptRecord({
      assessment,
      mentee,
      submittedAnswers: draftAnswers,
      existingAttempt: attempt,
      status: 'expired',
      submittedAt: attempt.expires_at,
      allowPartial: true,
    }))
    return tx.immediate()
  }

  router.get('/learner/assessments/:menteeId', (req, res) => {
    const mentee = db.prepare('SELECT * FROM mentees WHERE id = ?').get(req.params.menteeId)
    if (!mentee) {
      res.status(404).json({ error: 'Mentee not found.' })
      return
    }
    const rows = db.prepare(`
      SELECT a.* FROM assessments a
      JOIN assessment_assignments aa ON aa.assessment_id = a.id
      WHERE aa.mentee_id = ? AND a.status = 'Published'
      ORDER BY a.created_at DESC
    `).all(req.params.menteeId)
    res.json({
      assessments: rows.map((row) => {
        const inProgress = db.prepare(`
          SELECT * FROM assessment_attempts
          WHERE assessment_id = ? AND mentee_id = ? AND status = 'in_progress'
          ORDER BY started_at DESC LIMIT 1
        `).get(row.id, req.params.menteeId)
        if (inProgress) {
          expireOverdueAttemptIfNeeded(row, mentee, inProgress)
        }
        const activeAttemptRow = db.prepare(`
          SELECT * FROM assessment_attempts
          WHERE assessment_id = ? AND mentee_id = ? AND status = 'in_progress'
          ORDER BY started_at DESC LIMIT 1
        `).get(row.id, req.params.menteeId)
        const latestRow = db.prepare(`
          SELECT * FROM assessment_attempts
          WHERE assessment_id = ? AND mentee_id = ? AND status != 'in_progress'
          ORDER BY submitted_at DESC LIMIT 1
        `).get(row.id, req.params.menteeId)
        const attemptCount = db.prepare(`
          SELECT COUNT(*) AS count FROM assessment_attempts
          WHERE assessment_id = ? AND mentee_id = ?
        `).get(row.id, req.params.menteeId).count
        const allowance = getAttemptAllowance(row, req.params.menteeId)
        const showResults = resultsAreVisible(row)
        let draftAnswers = {}
        if (activeAttemptRow) {
          try {
            draftAnswers = JSON.parse(activeAttemptRow.draft_answers_json || '{}') || {}
          } catch {
            draftAnswers = {}
          }
        }
        return {
          id: row.id,
          title: row.title,
          description: row.description,
          maxAttempts: allowance.allowedAttempts,
          baseMaxAttempts: allowance.baseAttempts,
          extraAttempts: allowance.extraAttempts,
          attemptCount,
          timeLimitMinutes: row.time_limit_minutes ?? null,
          availableFrom: row.available_from || null,
          availableUntil: row.available_until || null,
          availabilityState: getAvailabilityState(row),
          shuffleQuestions: Boolean(row.shuffle_questions),
          shuffleOptions: Boolean(row.shuffle_options),
          navigationMode: row.navigation_mode || 'free',
          feedbackPolicy: row.feedback_policy || 'immediate',
          resultsVisible: showResults,
          activeAttempt: activeAttemptRow ? {
            id: activeAttemptRow.id,
            startedAt: activeAttemptRow.started_at,
            expiresAt: activeAttemptRow.expires_at || null,
            lastSavedAt: activeAttemptRow.last_saved_at || null,
            draftAnswers,
          } : null,
          latestSubmission: latestRow ? {
            id: latestRow.id,
            status: latestRow.status,
            submittedAt: latestRow.submitted_at,
            resultsVisible: showResults,
            score: showResults ? latestRow.score : null,
            needsManualGrading: latestRow.grading_status === 'Needs manual grading',
          } : null,
          questions: getOrderedLearnerQuestions(row.id, activeAttemptRow),
        }
      }),
    })
  })

  router.post('/learner/assessments/:id/start', (req, res) => {
    const menteeId = typeof req.body?.menteeId === 'string' ? req.body.menteeId : ''
    const startTx = db.transaction(() => {
      const assessment = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
      if (!assessment) return { statusCode: 404, error: 'Assessment not found.' }
      if (assessment.status !== 'Published') return { statusCode: 400, error: 'This assessment is not accepting attempts.' }
      const assignment = db.prepare(`
        SELECT 1 FROM assessment_assignments WHERE assessment_id = ? AND mentee_id = ?
      `).get(req.params.id, menteeId)
      const mentee = db.prepare('SELECT * FROM mentees WHERE id = ?').get(menteeId)
      if (!assignment || !mentee) return { statusCode: 403, error: 'This assessment is not assigned to the mentee.' }

      const availability = getAvailabilityState(assessment)
      if (availability === 'upcoming') {
        return { statusCode: 403, error: 'This assessment is not open yet.' }
      }
      if (availability === 'closed') {
        return { statusCode: 403, error: 'The availability window for this assessment has closed.' }
      }

      const existingActive = db.prepare(`
        SELECT * FROM assessment_attempts
        WHERE assessment_id = ? AND mentee_id = ? AND status = 'in_progress'
        ORDER BY started_at DESC LIMIT 1
      `).get(req.params.id, menteeId)
      if (existingActive) {
        let parsedDraft
        try {
          parsedDraft = JSON.parse(existingActive.draft_answers_json || '{}') || {}
        } catch {
          parsedDraft = {}
        }
        if (!existingActive.expires_at || Date.now() < Date.parse(existingActive.expires_at)) {
          return {
            statusCode: 200,
            resumed: true,
            attempt: {
              id: existingActive.id,
              startedAt: existingActive.started_at,
              expiresAt: existingActive.expires_at || null,
              lastSavedAt: existingActive.last_saved_at || null,
              draftAnswers: parsedDraft,
            },
            questions: getOrderedLearnerQuestions(assessment.id, existingActive),
          }
        }
        // Overdue: auto-finalize before checking remaining allowance
        finalizeAttemptRecord({
          assessment,
          mentee,
          submittedAnswers: parsedDraft,
          existingAttempt: existingActive,
          status: 'expired',
          submittedAt: existingActive.expires_at,
          allowPartial: true,
        })
      }

      const usedCount = db.prepare(`
        SELECT COUNT(*) AS count FROM assessment_attempts
        WHERE assessment_id = ? AND mentee_id = ?
      `).get(req.params.id, menteeId).count
      const allowance = getAttemptAllowance(assessment, menteeId)
      if (usedCount >= allowance.allowedAttempts) {
        return { statusCode: 409, error: 'The maximum number of attempts has been reached.' }
      }

      const questionRows = db.prepare(`
        SELECT q.* FROM assessment_questions aq
        JOIN questions q ON q.id = aq.question_id
        WHERE aq.assessment_id = ? ORDER BY aq.position
      `).all(assessment.id)
      const baseIds = questionRows.map((q) => q.id)
      const questionOrder = assessment.shuffle_questions ? shuffleList(baseIds) : baseIds
      const optionOrders = {}
      if (assessment.shuffle_options) {
        for (const row of questionRows) {
          const parsed = questionFromRow(row)
          if (parsed.type === 'mcq' || parsed.type === 'multi_select') {
            optionOrders[parsed.id] = shuffleList(parsed.options)
          }
        }
      }

      const nowMs = Date.now()
      const startedAt = new Date(nowMs).toISOString()
      let expiresAt = null
      if (assessment.time_limit_minutes) {
        let endMs = nowMs + assessment.time_limit_minutes * 60 * 1000
        if (assessment.available_until) {
          endMs = Math.min(endMs, Date.parse(assessment.available_until))
        }
        expiresAt = new Date(endMs).toISOString()
      } else if (assessment.available_until) {
        expiresAt = assessment.available_until
      }

      const attemptId = `AT-${randomUUID().slice(0, 8).toUpperCase()}`
      db.prepare(`
        INSERT INTO assessment_attempts (
          id, assessment_id, mentee_id, answers_json, score, grading_status, earned_points, max_points,
          status, started_at, expires_at, draft_answers_json, question_order_json, option_orders_json,
          last_saved_at, submitted_at
        )
        VALUES (?, ?, ?, '[]', '0 / 0', 'Graded', 0, 0, 'in_progress', ?, ?, '{}', ?, ?, ?, '')
      `).run(
        attemptId,
        assessment.id,
        menteeId,
        startedAt,
        expiresAt,
        JSON.stringify(questionOrder),
        JSON.stringify(optionOrders),
        startedAt,
      )

      const createdRow = db.prepare('SELECT * FROM assessment_attempts WHERE id = ?').get(attemptId)
      return {
        statusCode: 201,
        resumed: false,
        attempt: {
          id: attemptId,
          startedAt,
          expiresAt,
          lastSavedAt: startedAt,
          draftAnswers: {},
        },
        questions: getOrderedLearnerQuestions(assessment.id, createdRow),
      }
    })

    const outcome = startTx.immediate()
    if (outcome.error) {
      res.status(outcome.statusCode).json({ error: outcome.error })
      return
    }
    res.status(outcome.statusCode).json({
      attempt: outcome.attempt,
      questions: outcome.questions,
      resumed: outcome.resumed,
    })
  })

  router.put('/learner/attempts/:attemptId/responses', (req, res) => {
    const menteeId = typeof req.body?.menteeId === 'string' ? req.body.menteeId : ''
    const answers = req.body?.answers
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      res.status(400).json({ error: 'Answers object is required.' })
      return
    }
    const attempt = db.prepare('SELECT * FROM assessment_attempts WHERE id = ?').get(req.params.attemptId)
    if (!attempt || attempt.mentee_id !== menteeId) {
      res.status(404).json({ error: 'Active attempt not found.' })
      return
    }
    const assessment = db.prepare('SELECT * FROM assessments WHERE id = ?').get(attempt.assessment_id)
    const mentee = db.prepare('SELECT * FROM mentees WHERE id = ?').get(menteeId)
    if (!assessment || !mentee) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    const expired = expireOverdueAttemptIfNeeded(assessment, mentee, attempt)
    if (expired) {
      const showResults = resultsAreVisible(assessment)
      res.status(409).json({
        error: 'Time expired. Your last saved responses were automatically submitted.',
        expired: true,
        attempt: {
          ...expired.attempt,
          score: showResults ? expired.attempt.score : null,
          resultsVisible: showResults,
        },
      })
      return
    }
    if (attempt.status !== 'in_progress') {
      res.status(409).json({ error: 'This attempt has already been submitted.' })
      return
    }
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE assessment_attempts SET draft_answers_json = ?, last_saved_at = ?
      WHERE id = ? AND status = 'in_progress'
    `).run(JSON.stringify(answers), now, attempt.id)
    res.json({ ok: true, lastSavedAt: now })
  })

  router.post('/learner/assessments/:id/attempts', (req, res) => {
    const assessment = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    if (assessment.status !== 'Published') {
      res.status(400).json({ error: 'This assessment is not accepting attempts.' })
      return
    }
    const menteeId = typeof req.body?.menteeId === 'string' ? req.body.menteeId : ''
    const assignment = db.prepare(`
      SELECT 1 FROM assessment_assignments
      WHERE assessment_id = ? AND mentee_id = ?
    `).get(req.params.id, menteeId)
    const mentee = db.prepare('SELECT * FROM mentees WHERE id = ?').get(menteeId)
    if (!assignment || !mentee) {
      res.status(403).json({ error: 'This assessment is not assigned to the mentee.' })
      return
    }
    const submittedAnswers = req.body?.answers
    if (!submittedAnswers || typeof submittedAnswers !== 'object' || Array.isArray(submittedAnswers)) {
      res.status(400).json({ error: 'Submitted answers are required.' })
      return
    }
    const attemptIdParam = typeof req.body?.attemptId === 'string' ? req.body.attemptId : ''
    const allowAutoExpiry = Boolean(req.body?.autoExpired)

    const submitTx = db.transaction(() => {
      if (attemptIdParam) {
        const existingAttempt = db.prepare(`
          SELECT * FROM assessment_attempts WHERE id = ? AND assessment_id = ? AND mentee_id = ?
        `).get(attemptIdParam, assessment.id, menteeId)
        if (!existingAttempt) {
          return { statusCode: 404, error: 'Attempt not found.' }
        }
        if (existingAttempt.status !== 'in_progress') {
          return { statusCode: 409, error: 'This attempt has already been submitted.' }
        }
        const overdue = existingAttempt.expires_at && Date.now() > Date.parse(existingAttempt.expires_at) + 5000
        let finalAnswers = submittedAnswers
        if (overdue) {
          try {
            finalAnswers = JSON.parse(existingAttempt.draft_answers_json || '{}') || submittedAnswers
          } catch {
            finalAnswers = submittedAnswers
          }
        }
        const finalized = finalizeAttemptRecord({
          assessment,
          mentee,
          submittedAnswers: finalAnswers,
          existingAttempt,
          status: overdue || allowAutoExpiry ? 'expired' : 'submitted',
          submittedAt: new Date().toISOString(),
          allowPartial: overdue || allowAutoExpiry,
        })
        if (finalized.error) return { statusCode: 400, error: finalized.error }
        const attemptCount = db.prepare(`
          SELECT COUNT(*) AS count FROM assessment_attempts
          WHERE assessment_id = ? AND mentee_id = ?
        `).get(assessment.id, menteeId).count
        return { statusCode: 201, attempt: finalized.attempt, attemptCount }
      }

      const availability = getAvailabilityState(assessment)
      if (availability === 'upcoming') {
        return { statusCode: 403, error: 'This assessment is not open yet.' }
      }
      if (availability === 'closed') {
        return { statusCode: 403, error: 'The availability window for this assessment has closed.' }
      }
      const attemptCount = db.prepare(`
        SELECT COUNT(*) AS count FROM assessment_attempts
        WHERE assessment_id = ? AND mentee_id = ?
      `).get(req.params.id, menteeId).count
      const allowance = getAttemptAllowance(assessment, menteeId)
      if (attemptCount >= allowance.allowedAttempts) {
        return { statusCode: 409, error: 'The maximum number of attempts has been reached.' }
      }
      const finalized = finalizeAttemptRecord({
        assessment,
        mentee,
        submittedAnswers,
        status: 'submitted',
        submittedAt: new Date().toISOString(),
        allowPartial: false,
      })
      if (finalized.error) return { statusCode: 400, error: finalized.error }
      return { statusCode: 201, attempt: finalized.attempt, attemptCount: attemptCount + 1 }
    })

    const outcome = submitTx.immediate()
    if (outcome.error) {
      res.status(outcome.statusCode).json({ error: outcome.error })
      return
    }
    const showResults = resultsAreVisible(assessment)
    const allowance = getAttemptAllowance(assessment, menteeId)
    res.status(201).json({
      attempt: {
        id: outcome.attempt.id,
        status: outcome.attempt.status,
        score: showResults ? outcome.attempt.score : null,
        earnedPoints: showResults ? outcome.attempt.earnedPoints : null,
        maxPoints: showResults ? outcome.attempt.maxPoints : null,
        resultsVisible: showResults,
        gradingStatus: outcome.attempt.gradingStatus,
        needsManualGrading: outcome.attempt.needsManualGrading,
        submittedAt: outcome.attempt.submittedAt,
        attemptCount: outcome.attemptCount,
        maxAttempts: allowance.allowedAttempts,
      },
    })
  })

  router.use(requireAdmin)

  router.get('/questions', (req, res) => {
    const { page, limit, offset } = pagination(req)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const where = search ? 'WHERE lower(prompt) LIKE ? OR lower(id) LIKE ?' : ''
    const params = search ? [`%${search}%`, `%${search}%`] : []
    const total = db.prepare(`SELECT COUNT(*) AS count FROM questions ${where}`).get(...params).count
    const rows = db.prepare(`SELECT * FROM questions ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
    res.json({ questions: rows.map(questionFromRow), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } })
  })

  router.post('/questions', verifyCsrf, (req, res) => {
    const validationError = validateQuestion(req.body)
    if (validationError) {
      res.status(400).json({ error: validationError })
      return
    }
    res.status(201).json({ question: addQuestion(db, req.body) })
  })

  router.post('/questions/import', verifyCsrf, (req, res) => {
    const questions = req.body?.questions
    if (!Array.isArray(questions) || questions.length === 0 || questions.length > 500) {
      res.status(400).json({ error: 'Provide between 1 and 500 questions to import.' })
      return
    }
    const invalidIndex = questions.findIndex((question) => validateQuestion(question))
    if (invalidIndex !== -1) {
      res.status(400).json({ error: `Question ${invalidIndex + 1}: ${validateQuestion(questions[invalidIndex])}` })
      return
    }
    const insertQuestions = db.transaction((items) => items.map((item) => addQuestion(db, item)))
    const imported = insertQuestions(questions)
    res.status(201).json({ questions: imported })
  })

  router.patch('/questions/:id', verifyCsrf, (req, res) => {
    const validationError = validateQuestion(req.body)
    if (validationError) {
      res.status(400).json({ error: validationError })
      return
    }
    const existing = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id)
    if (!existing) {
      res.status(404).json({ error: 'Question not found.' })
      return
    }
    const normalized = normalizeQuestionInput(req.body)
    db.prepare(`
      UPDATE questions
      SET type = ?, prompt = ?, options_json = ?, correct_answer = ?,
          points = ?, difficulty = ?, tags_json = ?, config_json = ?, rubric_json = ?,
          status = 'Published'
      WHERE id = ?
    `).run(
      normalized.type,
      normalized.prompt,
      JSON.stringify(normalized.options),
      normalized.correctAnswer,
      normalized.points,
      normalized.difficulty,
      JSON.stringify(normalized.tags),
      JSON.stringify(normalized.config),
      JSON.stringify(normalized.rubric),
      req.params.id,
    )
    const row = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id)
    res.json({ question: questionFromRow(row) })
  })

  router.delete('/questions/:id', verifyCsrf, (req, res) => {
    const inUse = db.prepare('SELECT COUNT(*) AS count FROM assessment_questions WHERE question_id = ?').get(req.params.id).count
    if (inUse) {
      res.status(409).json({ error: 'This question is used by one or more assessments and cannot be deleted.' })
      return
    }
    const deleted = db.prepare('DELETE FROM questions WHERE id = ?').run(req.params.id)
    if (!deleted.changes) {
      res.status(404).json({ error: 'Question not found.' })
      return
    }
    res.json({ ok: true })
  })

  router.get('/mentees', (req, res) => {
    const { page, limit, offset } = pagination(req)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const where = search ? 'WHERE lower(name) LIKE ? OR lower(email) LIKE ?' : ''
    const params = search ? [`%${search}%`, `%${search}%`] : []
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
    const existing = db.prepare('SELECT id FROM mentees WHERE lower(email) = ?').get(email)
    if (existing) {
      res.status(409).json({ error: 'A mentee with this email already exists.' })
      return
    }
    const mentee = { id: `M-${randomUUID().slice(0, 8).toUpperCase()}`, name, email }
    db.prepare('INSERT INTO mentees (id, name, email) VALUES (?, ?, ?)').run(mentee.id, name, email)
    res.status(201).json({ mentee: menteeFromRow({ ...mentee }) })
  })

  router.patch('/mentees/:id', verifyCsrf, (req, res) => {
    const validationError = validateMentee(req.body)
    if (validationError) {
      res.status(400).json({ error: validationError })
      return
    }
    const existing = db.prepare('SELECT * FROM mentees WHERE id = ?').get(req.params.id)
    if (!existing) {
      res.status(404).json({ error: 'Mentee not found.' })
      return
    }
    const name = req.body.name.trim()
    const email = req.body.email.trim().toLowerCase()
    const duplicate = db.prepare('SELECT id FROM mentees WHERE lower(email) = ? AND id != ?').get(email, req.params.id)
    if (duplicate) {
      res.status(409).json({ error: 'A mentee with this email already exists.' })
      return
    }
    db.prepare('UPDATE mentees SET name = ?, email = ? WHERE id = ?').run(name, email, req.params.id)
    res.json({ mentee: menteeFromRow(db.prepare('SELECT * FROM mentees WHERE id = ?').get(req.params.id)) })
  })

  router.delete('/mentees/:id', verifyCsrf, (req, res) => {
    const deleted = db.prepare('DELETE FROM mentees WHERE id = ?').run(req.params.id)
    if (!deleted.changes) {
      res.status(404).json({ error: 'Mentee not found.' })
      return
    }
    res.json({ ok: true })
  })

  router.get('/assessments', (req, res) => {
    const { page, limit, offset } = pagination(req)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const where = search ? 'WHERE lower(title) LIKE ? OR lower(description) LIKE ?' : ''
    const params = search ? [`%${search}%`, `%${search}%`] : []
    const total = db.prepare(`SELECT COUNT(*) AS count FROM assessments ${where}`).get(...params).count
    const rows = db.prepare(`SELECT * FROM assessments ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
    res.json({ assessments: rows.map((row) => assessmentFromRow(db, row)), pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) } })
  })

  router.post('/assessments', verifyCsrf, (req, res) => {
    const validationError = validateAssessment(req.body)
    if (validationError) {
      res.status(400).json({ error: validationError })
      return
    }

    const questionIds = req.body.questionIds
    const menteeIds = req.body.menteeIds
    const questionPlaceholders = questionIds.map(() => '?').join(', ')
    const menteePlaceholders = menteeIds.map(() => '?').join(', ')
    const foundQuestions = db.prepare(`SELECT COUNT(*) AS count FROM questions WHERE id IN (${questionPlaceholders})`).get(...questionIds).count
    const foundMentees = db.prepare(`SELECT COUNT(*) AS count FROM mentees WHERE id IN (${menteePlaceholders})`).get(...menteeIds).count
    if (foundQuestions !== questionIds.length || foundMentees !== menteeIds.length) {
      res.status(400).json({ error: 'Choose existing questions and mentees from this workspace.' })
      return
    }

    const now = new Date().toISOString()
    const settings = normalizeAssessmentSettings(req.body)
    const assessmentId = `AS-${randomUUID().slice(0, 8).toUpperCase()}`
    const insertAssessment = db.transaction(() => {
      db.prepare(`
        INSERT INTO assessments (
          id, title, description, max_attempts, time_limit_minutes, available_from, available_until,
          shuffle_questions, shuffle_options, navigation_mode, feedback_policy, results_released,
          status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'Draft', ?, ?)
      `).run(
        assessmentId,
        settings.title,
        settings.description,
        settings.maxAttempts,
        settings.timeLimitMinutes,
        settings.availableFrom,
        settings.availableUntil,
        settings.shuffleQuestions,
        settings.shuffleOptions,
        settings.navigationMode,
        settings.feedbackPolicy,
        now,
        now,
      )
      const insertQuestion = db.prepare('INSERT INTO assessment_questions (assessment_id, question_id, position) VALUES (?, ?, ?)')
      questionIds.forEach((questionId, index) => insertQuestion.run(assessmentId, questionId, index))
      const insertAssignment = db.prepare('INSERT INTO assessment_assignments (assessment_id, mentee_id, assigned_at) VALUES (?, ?, ?)')
      menteeIds.forEach((menteeId) => insertAssignment.run(assessmentId, menteeId, now))
    })
    insertAssessment()
    const row = db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessmentId)
    res.status(201).json({ assessment: assessmentFromRow(db, row) })
  })

  router.patch('/assessments/:id/status', verifyCsrf, (req, res) => {
    const status = req.body?.status
    if (!['Published', 'Paused'].includes(status)) {
      res.status(400).json({ error: 'Choose Published or Paused.' })
      return
    }
    const existing = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    if (!existing) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    if (existing.status === 'Draft' && status === 'Paused') {
      res.status(400).json({ error: 'A draft must be published before it can be paused.' })
      return
    }
    const updatedAt = new Date().toISOString()
    db.prepare('UPDATE assessments SET status = ?, updated_at = ? WHERE id = ?').run(status, updatedAt, req.params.id)
    const row = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    res.json({ assessment: assessmentFromRow(db, row) })
  })

  router.post('/assessments/:id/release-results', verifyCsrf, (req, res) => {
    const existing = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    if (!existing) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    const updatedAt = new Date().toISOString()
    db.prepare('UPDATE assessments SET results_released = 1, updated_at = ? WHERE id = ?').run(updatedAt, req.params.id)
    const row = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    res.json({ assessment: assessmentFromRow(db, row) })
  })

  router.post('/assessments/:id/extra-attempts', verifyCsrf, (req, res) => {
    const assessment = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    const menteeId = typeof req.body?.menteeId === 'string' ? req.body.menteeId : ''
    const extraAttempts = Number(req.body?.extraAttempts ?? 1)
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : ''
    const assignment = db.prepare(`
      SELECT 1 FROM assessment_assignments WHERE assessment_id = ? AND mentee_id = ?
    `).get(req.params.id, menteeId)
    if (!assignment) {
      res.status(400).json({ error: 'Select a mentee assigned to this assessment.' })
      return
    }
    if (!Number.isInteger(extraAttempts) || extraAttempts < 1 || extraAttempts > 3) {
      res.status(400).json({ error: 'Extra attempts must be between 1 and 3.' })
      return
    }
    if (!reason || reason.length > 500) {
      res.status(400).json({ error: 'Provide a reason (1 to 500 characters) for granting extra attempts.' })
      return
    }
    const id = `EX-${randomUUID().slice(0, 8).toUpperCase()}`
    const createdAt = new Date().toISOString()
    db.prepare(`
      INSERT INTO extra_attempt_grants (id, assessment_id, mentee_id, extra_attempts, reason, granted_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.params.id, menteeId, extraAttempts, reason, req.session.admin.name, createdAt)
    const grant = db.prepare(`
      SELECT id, mentee_id AS menteeId, extra_attempts AS extraAttempts, reason, granted_by AS grantedBy, created_at AS createdAt
      FROM extra_attempt_grants WHERE id = ?
    `).get(id)
    const row = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    res.status(201).json({ grant, assessment: assessmentFromRow(db, row) })
  })

  router.patch('/assessments/:id', verifyCsrf, (req, res) => {
    const existing = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    if (!existing) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    if (existing.status !== 'Draft') {
      res.status(409).json({ error: 'Only draft assessments can be edited.' })
      return
    }
    const validationError = validateAssessment(req.body)
    if (validationError) {
      res.status(400).json({ error: validationError })
      return
    }
    const questionPlaceholders = req.body.questionIds.map(() => '?').join(', ')
    const menteePlaceholders = req.body.menteeIds.map(() => '?').join(', ')
    const foundQuestions = db.prepare(`SELECT COUNT(*) AS count FROM questions WHERE id IN (${questionPlaceholders})`).get(...req.body.questionIds).count
    const foundMentees = db.prepare(`SELECT COUNT(*) AS count FROM mentees WHERE id IN (${menteePlaceholders})`).get(...req.body.menteeIds).count
    if (foundQuestions !== req.body.questionIds.length || foundMentees !== req.body.menteeIds.length) {
      res.status(400).json({ error: 'Choose existing questions and mentees from this workspace.' })
      return
    }
    const now = new Date().toISOString()
    const settings = normalizeAssessmentSettings(req.body)
    const updateAssessment = db.transaction(() => {
      db.prepare(`
        UPDATE assessments
        SET title = ?, description = ?, max_attempts = ?, time_limit_minutes = ?,
            available_from = ?, available_until = ?, shuffle_questions = ?, shuffle_options = ?,
            navigation_mode = ?, feedback_policy = ?, updated_at = ?
        WHERE id = ?
      `).run(
        settings.title,
        settings.description,
        settings.maxAttempts,
        settings.timeLimitMinutes,
        settings.availableFrom,
        settings.availableUntil,
        settings.shuffleQuestions,
        settings.shuffleOptions,
        settings.navigationMode,
        settings.feedbackPolicy,
        now,
        req.params.id,
      )
      db.prepare('DELETE FROM assessment_questions WHERE assessment_id = ?').run(req.params.id)
      db.prepare('DELETE FROM assessment_assignments WHERE assessment_id = ?').run(req.params.id)
      const insertQuestion = db.prepare('INSERT INTO assessment_questions (assessment_id, question_id, position) VALUES (?, ?, ?)')
      req.body.questionIds.forEach((questionId, index) => insertQuestion.run(req.params.id, questionId, index))
      const insertAssignment = db.prepare('INSERT INTO assessment_assignments (assessment_id, mentee_id, assigned_at) VALUES (?, ?, ?)')
      req.body.menteeIds.forEach((menteeId) => insertAssignment.run(req.params.id, menteeId, now))
    })
    updateAssessment()
    const row = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    res.json({ assessment: assessmentFromRow(db, row) })
  })

  router.delete('/assessments/:id', verifyCsrf, (req, res) => {
    const existing = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    if (!existing) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    if (existing.status !== 'Draft') {
      res.status(409).json({ error: 'Only draft assessments can be deleted.' })
      return
    }
    db.prepare('DELETE FROM assessments WHERE id = ?').run(req.params.id)
    res.json({ ok: true })
  })

  router.get('/answers', (req, res) => {
    const { page, limit, offset } = pagination(req)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const status = typeof req.query.status === 'string' ? req.query.status : ''
    const clauses = []
    const params = []
    if (search) {
      clauses.push('(lower(student) LIKE ? OR lower(assessment) LIKE ? OR lower(answer) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    if (status) {
      clauses.push('(status = ? OR review_decision = ?)')
      params.push(status, status)
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const total = db.prepare(`SELECT COUNT(*) AS count FROM answers ${where}`).get(...params).count
    const rows = db.prepare(`SELECT * FROM answers ${where} ORDER BY submitted_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
    res.json({
      answers: rows.map((row) => ({ ...answerFromRow(row), reviewHistory: getReviewHistory(db, 'answer', row.id) })),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    })
  })

  router.patch('/answers/:id/review', verifyCsrf, (req, res) => {
    const { decision, feedback, itemGrades } = req.body || {}
    if (!['Approved', 'Revision requested'].includes(decision)) {
      res.status(400).json({ error: 'Choose Approved or Revision requested.' })
      return
    }
    if (typeof feedback !== 'string' || feedback.length > 5000 || (decision === 'Revision requested' && !feedback.trim())) {
      res.status(400).json({ error: 'Feedback is required for a revision request and must be 5000 characters or fewer.' })
      return
    }
    const existing = db.prepare('SELECT * FROM answers WHERE id = ?').get(req.params.id)
    if (!existing) {
      res.status(404).json({ error: 'Submission not found.' })
      return
    }

    let existingItems = []
    try {
      existingItems = JSON.parse(existing.items_json || '[]')
    } catch {
      existingItems = []
    }
    let nextScore = existing.score
    let nextEarned = existing.earned_points
    let nextMax = existing.max_points

    if (Array.isArray(itemGrades) && existingItems.length > 0) {
      const gradeMap = new Map()
      for (const grade of itemGrades) {
        if (!grade || typeof grade.questionId !== 'string') {
          res.status(400).json({ error: 'Each item grade must identify a question.' })
          return
        }
        gradeMap.set(grade.questionId, grade)
      }
      const updatedItems = []
      for (const item of existingItems) {
        const update = gradeMap.get(item.questionId)
        if (!update) {
          updatedItems.push(item)
          continue
        }
        const maxPoints = Number(item.maxPoints ?? 1)
        const earned = Number(update.earnedPoints)
        if (!Number.isFinite(earned) || earned < 0 || earned > maxPoints) {
          res.status(400).json({ error: `Score for "${item.prompt}" must be between 0 and ${maxPoints}.` })
          return
        }
        const comment = typeof update.comment === 'string' ? update.comment.trim().slice(0, 2000) : (item.comment || '')
        updatedItems.push({
          ...item,
          earnedPoints: Math.round(earned * 100) / 100,
          comment,
          needsReview: false,
        })
      }
      existingItems = updatedItems
      nextEarned = Math.round(existingItems.reduce((sum, item) => sum + Number(item.earnedPoints || 0), 0) * 100) / 100
      nextMax = Math.round(existingItems.reduce((sum, item) => sum + Number(item.maxPoints || 0), 0) * 100) / 100
      nextScore = `${formatPoints(nextEarned)} / ${formatPoints(nextMax)}`
    }

    const reviewedAt = new Date().toISOString()
    const updateReview = db.transaction(() => {
      db.prepare(`
        UPDATE answers
        SET status = 'Reviewed', review_decision = ?, feedback = ?, reviewed_by = ?, reviewed_at = ?,
            items_json = ?, score = ?, earned_points = ?, max_points = ?
        WHERE id = ?
      `).run(
        decision,
        feedback.trim(),
        req.session.admin.name,
        reviewedAt,
        JSON.stringify(existingItems),
        nextScore,
        nextEarned,
        nextMax,
        req.params.id,
      )
      if (existing.attempt_id) {
        db.prepare(`
          UPDATE assessment_attempts
          SET score = ?, grading_status = 'Graded', earned_points = ?, max_points = ?
          WHERE id = ?
        `).run(nextScore, nextEarned ?? 0, nextMax ?? 0, existing.attempt_id)
      }
      db.prepare(`
        INSERT INTO review_history (entity_type, entity_id, actor, decision, note, created_at)
        VALUES ('answer', ?, ?, ?, ?, ?)
      `).run(req.params.id, req.session.admin.name, decision, feedback.trim(), reviewedAt)
    })
    updateReview()
    const row = db.prepare('SELECT * FROM answers WHERE id = ?').get(req.params.id)
    res.json({
      answer: {
        ...answerFromRow(row),
        reviewHistory: getReviewHistory(db, 'answer', row.id),
      },
    })
  })

  router.get('/flags', (req, res) => {
    const { page, limit, offset } = pagination(req)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const where = search ? 'WHERE lower(student) LIKE ? OR lower(assessment) LIKE ? OR lower(signal) LIKE ?' : ''
    const params = search ? [`%${search}%`, `%${search}%`, `%${search}%`] : []
    const total = db.prepare(`SELECT COUNT(*) AS count FROM flags ${where}`).get(...params).count
    const rows = db.prepare(`SELECT * FROM flags ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limit, offset)
    res.json({
      flags: rows.map((row) => ({ ...flagFromRow(row), reviewHistory: getReviewHistory(db, 'flag', row.id) })),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    })
  })

  router.post('/flags', verifyCsrf, (req, res) => {
    const student = typeof req.body?.student === 'string' ? req.body.student.trim() : ''
    const assessment = typeof req.body?.assessment === 'string' ? req.body.assessment.trim() : ''
    const signal = typeof req.body?.signal === 'string' ? req.body.signal.trim() : ''
    const detail = typeof req.body?.detail === 'string' ? req.body.detail.trim() : ''
    if (!student || !assessment || !signal || !detail) {
      res.status(400).json({ error: 'Student, assessment, signal, and detail are required.' })
      return
    }
    const id = `F-${randomUUID().slice(0, 8).toUpperCase()}`
    db.prepare(`
      INSERT INTO flags (id, student, initials, assessment, signal, detail, level)
      VALUES (?, ?, ?, ?, ?, ?, 'Needs review')
    `).run(id, student, initialsFor(student), assessment, signal, detail)
    const row = db.prepare('SELECT * FROM flags WHERE id = ?').get(id)
    res.status(201).json({ flag: { ...flagFromRow(row), reviewHistory: [] } })
  })

  router.patch('/flags/:id/review', verifyCsrf, (req, res) => {
    const { decision, note } = req.body || {}
    if (!['Follow-up', 'Dismissed'].includes(decision)) {
      res.status(400).json({ error: 'Choose Follow-up or Dismissed.' })
      return
    }
    if (typeof note !== 'string' || !note.trim() || note.length > 5000) {
      res.status(400).json({ error: 'A review note of 1 to 5000 characters is required.' })
      return
    }
    const existing = db.prepare('SELECT id FROM flags WHERE id = ?').get(req.params.id)
    if (!existing) {
      res.status(404).json({ error: 'Integrity signal not found.' })
      return
    }
    const reviewedAt = new Date().toISOString()
    const updateReview = db.transaction(() => {
      db.prepare(`
        UPDATE flags SET level = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ?
      `).run(decision, note.trim(), req.session.admin.name, reviewedAt, req.params.id)
      db.prepare(`
        INSERT INTO review_history (entity_type, entity_id, actor, decision, note, created_at)
        VALUES ('flag', ?, ?, ?, ?, ?)
      `).run(req.params.id, req.session.admin.name, decision, note.trim(), reviewedAt)
    })
    updateReview()
    const row = db.prepare('SELECT * FROM flags WHERE id = ?').get(req.params.id)
    res.json({
      flag: {
        ...flagFromRow(row),
        reviewHistory: getReviewHistory(db, 'flag', row.id),
      },
    })
  })

  router.get('/dashboard/summary', (req, res) => {
    const totalStudents = db.prepare('SELECT COUNT(*) AS count FROM mentees').get().count
    const totalQuestions = db.prepare('SELECT COUNT(*) AS count FROM questions').get().count
    const pendingAnswers = db.prepare("SELECT COUNT(*) AS count FROM answers WHERE status = 'Needs review'").get().count
    const unresolvedFlags = db.prepare("SELECT COUNT(*) AS count FROM flags WHERE level != 'Dismissed'").get().count
    const activityRows = db.prepare(`
      SELECT date(submitted_at) AS date, COUNT(*) AS count
      FROM answers
      WHERE submitted_at >= datetime('now', '-6 days')
      GROUP BY date(submitted_at)
    `).all()
    const activityByDate = new Map(activityRows.map((row) => [row.date, row.count]))
    const weeklyActivity = Array.from({ length: 7 }, (_, index) => {
      const date = new Date()
      date.setUTCHours(0, 0, 0, 0)
      date.setUTCDate(date.getUTCDate() - 6 + index)
      return {
        day: date.toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' }),
        count: activityByDate.get(date.toISOString().slice(0, 10)) || 0,
      }
    })
    res.json({ totalStudents, totalQuestions, pendingAnswers, unresolvedFlags, weeklyActivity })
  })

  router.get('/review-history', (req, res) => {
    const { entityType, entityId } = req.query
    if (!['answer', 'flag'].includes(entityType) || typeof entityId !== 'string' || !entityId) {
      res.status(400).json({ error: 'An entity type and ID are required.' })
      return
    }
    const history = getReviewHistory(db, entityType, entityId)
    res.json({ history })
  })

  router.get('/members', (req, res) => {
    const { page, limit, offset } = pagination(req, 100)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const role = typeof req.query.role === 'string' ? req.query.role : ''
    const clauses = ['m.organisation_id = ?']
    const params = [organisationId]
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
        id: workspace.organisation.id,
        slug: workspace.organisation.slug,
        name: workspace.organisation.name,
      },
      members: rows.map(memberFromRow),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    })
  })

  router.patch('/members/:id', verifyCsrf, (req, res) => {
    const existing = db.prepare(`
      SELECT m.*, u.name, u.email
      FROM memberships m
      JOIN users u ON u.id = m.user_id
      WHERE m.id = ? AND m.organisation_id = ?
    `).get(req.params.id, organisationId)
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
      `).run(nextRole, nextStatus, req.params.id, organisationId)
      if (nextRole === 'Mentee') {
        const existingMentee = db.prepare('SELECT id FROM mentees WHERE lower(email) = ?').get(existing.email.toLowerCase())
        if (!existingMentee) {
          db.prepare('INSERT INTO mentees (id, name, email) VALUES (?, ?, ?)').run(
            `M-${randomUUID().slice(0, 8).toUpperCase()}`,
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
    `).get(req.params.id, organisationId)
    res.json({ member: memberFromRow(row) })
  })

  router.delete('/members/:id', verifyCsrf, (req, res) => {
    const existing = db.prepare(`
      SELECT * FROM memberships WHERE id = ? AND organisation_id = ?
    `).get(req.params.id, organisationId)
    if (!existing) {
      res.status(404).json({ error: 'Member not found.' })
      return
    }
    if (existing.role === 'Owner') {
      res.status(403).json({ error: 'The workspace owner cannot be removed.' })
      return
    }
    db.prepare('DELETE FROM memberships WHERE id = ? AND organisation_id = ?').run(req.params.id, organisationId)
    res.json({ ok: true })
  })

  router.get('/invitations', (req, res) => {
    const { page, limit, offset } = pagination(req, 100)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const clauses = ['organisation_id = ?']
    const params = [organisationId]
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
  })

  router.post('/invitations', verifyCsrf, (req, res) => {
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
    `).run(id, organisationId, type, email, role, tokenHash, req.session.admin.name, createdAt, expiresAt, maxUses)

    const row = db.prepare('SELECT * FROM invitations WHERE id = ?').get(id)
    res.status(201).json({
      invitation: {
        ...invitationFromRow(row),
        token,
        acceptPath: `/invite/${token}`,
      },
    })
  })

  router.delete('/invitations/:id', verifyCsrf, (req, res) => {
    const existing = db.prepare('SELECT * FROM invitations WHERE id = ? AND organisation_id = ?').get(req.params.id, organisationId)
    if (!existing) {
      res.status(404).json({ error: 'Invitation not found.' })
      return
    }
    db.prepare('UPDATE invitations SET revoked = 1 WHERE id = ? AND organisation_id = ?').run(req.params.id, organisationId)
    const row = db.prepare('SELECT * FROM invitations WHERE id = ? AND organisation_id = ?').get(req.params.id, organisationId)
    res.json({ ok: true, invitation: invitationFromRow(row) })
  })

  app.use('/api', router)

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'API route not found.' })
  })

  if (distPath && existsSync(path.join(distPath, 'index.html'))) {
    app.use(express.static(distPath, { index: false }))
    app.get(/.*/, (req, res) => res.sendFile(path.join(distPath, 'index.html')))
  }

  app.use((error, req, res, next) => {
    console.error('Request failed:', error)
    if (res.headersSent) {
      next(error)
      return
    }
    res.status(500).json({ error: 'An unexpected server error occurred.' })
  })

  return app
}

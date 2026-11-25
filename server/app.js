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
  auditLogFromRow,
  ensureWorkspaceBootstrap,
  flagFromRow,
  getInvitationState,
  initialsFor,
  invitationFromRow,
  memberFromRow,
  menteeFromRow,
  questionFromRow,
  securityEventFromRow,
  uniqueSlugForOrg,
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

function requireAuth(req, res, next) {
  if (!req.session?.user && !req.session?.admin) {
    res.status(401).json({ error: 'Sign-in is required.' })
    return
  }
  next()
}

const NAVIGATION_MODES = ['free', 'sequential']
const FEEDBACK_POLICIES = ['immediate', 'after_deadline', 'manual']
const SECURITY_MODES = ['standard', 'strict_web', 'seb']
const SEB_KEY_REGEX = /^[a-f0-9]{64}$/i
const SECURITY_EVENT_TYPES = [
  'fullscreen_entered',
  'fullscreen_exited',
  'visibility_hidden',
  'visibility_visible',
  'window_blur',
  'window_focus',
]

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function buildSebConfigPlist({ assessment, startUrl, quitUrl }) {
  const sendExamKey = assessment.seb_browser_exam_key || assessment.seb_config_key || ''
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>startURL</key>',
    `  <string>${escapeXml(startUrl)}</string>`,
    '  <key>sendBrowserExamKey</key>',
    '  <true/>',
    '  <key>allowQuit</key>',
    '  <true/>',
    '  <key>quitURL</key>',
    `  <string>${escapeXml(quitUrl)}</string>`,
    '  <key>browserViewMode</key>',
    '  <integer>1</integer>',
    '  <key>showTaskBar</key>',
    '  <true/>',
    '  <key>allowSwitchToApplications</key>',
    '  <false/>',
    '  <key>enableURLFilter</key>',
    '  <false/>',
    '  <key>examSessionClearCookiesOnEnd</key>',
    '  <false/>',
    '  <key>munaAssessmentId</key>',
    `  <string>${escapeXml(assessment.id)}</string>`,
    '  <key>munaConfigKey</key>',
    `  <string>${escapeXml(assessment.seb_config_key || '')}</string>`,
    ...(sendExamKey
      ? ['  <key>browserExamKey</key>', `  <string>${escapeXml(sendExamKey)}</string>`]
      : []),
    '</dict>',
    '</plist>',
  ].join('\n')
}

function requestCandidateUrls(req) {
  const host = req.get('host') || '127.0.0.1'
  const forwardedProto = typeof req.get('x-forwarded-proto') === 'string'
    ? req.get('x-forwarded-proto').split(',')[0].trim()
    : ''
  const protos = new Set([req.protocol || 'http', ...(forwardedProto ? [forwardedProto] : [])])
  const fullPath = req.originalUrl || req.url || '/'
  const cleanPath = fullPath.split('?')[0]
  const urls = new Set()
  for (const proto of protos) {
    urls.add(`${proto}://${host}${fullPath}`)
    urls.add(`${proto}://${host}${cleanPath}`)
  }
  return urls
}

function sebHashMatches(headerValue, candidateUrls, secretKey) {
  if (typeof headerValue !== 'string' || !secretKey) return false
  const received = headerValue.trim().toLowerCase()
  if (!SEB_KEY_REGEX.test(received)) return false
  const receivedBuf = Buffer.from(received, 'hex')
  for (const url of candidateUrls) {
    const expected = createHash('sha256').update(`${url}${secretKey}`).digest()
    if (expected.length === receivedBuf.length && timingSafeEqual(expected, receivedBuf)) {
      return true
    }
  }
  return false
}

function verifySebRequest(req, assessment) {
  if (assessment.security_mode !== 'seb') {
    return { ok: true, method: 'not_required' }
  }
  const urls = requestCandidateUrls(req)
  const configHash = req.get('x-safeexambrowser-configkeyhash')
  if (sebHashMatches(configHash, urls, assessment.seb_config_key)) {
    return { ok: true, method: 'config_key' }
  }
  const requestHash = req.get('x-safeexambrowser-requesthash')
  if (sebHashMatches(requestHash, urls, assessment.seb_browser_exam_key)) {
    return { ok: true, method: 'browser_exam_key' }
  }
  if (sebHashMatches(requestHash, urls, assessment.seb_config_key)) {
    return { ok: true, method: 'config_request_hash' }
  }
  return {
    ok: false,
    error: 'Safe Exam Browser is required for this assessment. Launch it using the downloaded Muna .seb configuration file.',
  }
}

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
  const securityMode = input.securityMode ?? 'standard'
  if (!SECURITY_MODES.includes(securityMode)) {
    return 'Security mode must be standard, strict_web, or seb.'
  }
  if (input.sebBrowserExamKey !== undefined && input.sebBrowserExamKey !== null && input.sebBrowserExamKey !== '') {
    if (typeof input.sebBrowserExamKey !== 'string' || !SEB_KEY_REGEX.test(input.sebBrowserExamKey.trim())) {
      return 'Browser Exam Key must be a 64-character SHA-256 hex string.'
    }
  }
  return null
}

function normalizeAssessmentSettings(input) {
  const timeLimitMinutes =
    input.timeLimitMinutes === undefined || input.timeLimitMinutes === null || input.timeLimitMinutes === ''
      ? null
      : Number(input.timeLimitMinutes)
  const securityMode = input.securityMode ?? 'standard'
  const sebBrowserExamKey =
    securityMode === 'seb' && typeof input.sebBrowserExamKey === 'string' && input.sebBrowserExamKey.trim()
      ? input.sebBrowserExamKey.trim().toLowerCase()
      : null
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
    securityMode,
    requireFullscreen: input.requireFullscreen ? 1 : 0,
    sebBrowserExamKey,
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

function logAudit(db, { organisationId = 'ORG-DEFAULT', actor, action, entityType, entityId, detail = {} }) {
  const id = `AUD-${randomUUID().slice(0, 8).toUpperCase()}`
  const createdAt = new Date().toISOString()
  db.prepare(`
    INSERT INTO audit_logs (id, organisation_id, actor, action, entity_type, entity_id, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, organisationId, actor, action, entityType, entityId, JSON.stringify(detail), createdAt)
}

function escapeCsvCell(value) {
  const raw = value === null || value === undefined ? '' : String(value)
  // Neutralize spreadsheet formula injection (=, +, -, @, tab, CR)
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`
  }
  return safe
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

function addQuestion(db, input, organisationId = 'ORG-DEFAULT') {
  const id = `Q-${randomUUID().slice(0, 8).toUpperCase()}`
  const createdAt = new Date().toISOString()
  const normalized = normalizeQuestionInput(input)
  db.prepare(`
    INSERT INTO questions (
      id, organisation_id, type, prompt, options_json, correct_answer,
      points, difficulty, tags_json, config_json, rubric_json,
      status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Published', ?)
  `).run(
    id,
    organisationId,
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
  onVerificationEmail,
}) {
  const app = express()
  const router = express.Router()
  ensureWorkspaceBootstrap(db, { orgName, orgSlug })
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

  function getUserOrganisations(userId, userEmail) {
    const rows = db.prepare(`
      SELECT o.id, o.slug, o.name, m.role, m.status, m.joined_at AS joinedAt
      FROM memberships m
      JOIN organisations o ON o.id = m.organisation_id
      WHERE m.user_id = ? AND m.status = 'Active'
      ORDER BY CASE m.role WHEN 'Owner' THEN 0 WHEN 'Admin' THEN 1 WHEN 'Mentor' THEN 2 ELSE 3 END, m.joined_at ASC
    `).all(userId)
    return rows.map((row) => {
      const mentee = userEmail
        ? db.prepare('SELECT id FROM mentees WHERE organisation_id = ? AND lower(email) = ?').get(row.id, userEmail.toLowerCase())
        : null
      return {
        ...row,
        menteeId: mentee?.id || null,
      }
    })
  }

  function createVerificationTokenForUser(userId) {
    const token = randomBytes(24).toString('base64url')
    const tokenHash = hashInvitationToken(token)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(userId)
    db.prepare(`
      INSERT INTO email_verification_tokens (token_hash, user_id, expires_at, created_at)
      VALUES (?, ?, ?, ?)
    `).run(tokenHash, userId, expiresAt, now.toISOString())
    return token
  }

  function signUserIn(req, res, next, user, preferredOrgId = null, { statusCode = 200, extra = {} } = {}) {
    const organisations = getUserOrganisations(user.id, user.email)
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

        const verificationToken = createVerificationTokenForUser(userId)
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
    const verificationToken = createVerificationTokenForUser(user.id)
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
    const organisations = getUserOrganisations(userRow.id, userRow.email)
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

  router.get('/learner/me', requireAuth, (req, res) => {
    const email = req.session.user.email.toLowerCase()
    const rows = db.prepare(`
      SELECT m.id, m.name, m.email, m.organisation_id AS organisationId, o.name AS organisationName, o.slug AS organisationSlug
      FROM mentees m
      JOIN organisations o ON o.id = m.organisation_id
      JOIN memberships mem ON mem.organisation_id = m.organisation_id AND mem.user_id = ?
      WHERE lower(m.email) = ? AND mem.status = 'Active'
      ORDER BY o.name ASC
    `).all(req.session.user.id, email)
    res.json({ user: req.session.user, mentees: rows })
  })

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
    terminationReason = null,
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
            status = ?, termination_reason = ?, submitted_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify(storedAnswers),
        score,
        gradingStatus,
        earnedPoints,
        maxPoints,
        status,
        terminationReason,
        submittedAt,
        attemptId,
      )
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
        id, organisation_id, attempt_id, student, initials, assessment, answer, score,
        earned_points, max_points, items_json, submitted_at, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Needs review')
    `).run(
      answerId,
      assessment.organisation_id || 'ORG-DEFAULT',
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
        terminationReason,
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

  router.get('/learner/assessments/:menteeId', requireAuth, (req, res) => {
    const mentee = db.prepare('SELECT * FROM mentees WHERE id = ?').get(req.params.menteeId)
    if (!mentee) {
      res.status(404).json({ error: 'Mentee not found.' })
      return
    }
    const access = checkLearnerAccess(req, mentee)
    if (!access.ok) {
      res.status(access.statusCode).json({ error: access.error })
      return
    }
    const rows = db.prepare(`
      SELECT a.* FROM assessments a
      JOIN assessment_assignments aa ON aa.assessment_id = a.id
      WHERE aa.mentee_id = ? AND a.organisation_id = ? AND a.status = 'Published'
      ORDER BY a.created_at DESC
    `).all(req.params.menteeId, mentee.organisation_id || 'ORG-DEFAULT')
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
          securityMode: row.security_mode || 'standard',
          requireFullscreen: Boolean(row.require_fullscreen),
          sebConfigReady: Boolean(row.seb_config_key),
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
            terminationReason: latestRow.termination_reason || null,
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

  router.get('/learner/assessments/:id/seb-check', requireAuth, (req, res) => {
    const menteeId = typeof req.query.menteeId === 'string' ? req.query.menteeId : ''
    const assessment = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    const mentee = menteeId ? db.prepare('SELECT * FROM mentees WHERE id = ?').get(menteeId) : null
    if (!assessment || !mentee || (mentee.organisation_id || 'ORG-DEFAULT') !== (assessment.organisation_id || 'ORG-DEFAULT')) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    const access = checkLearnerAccess(req, mentee)
    if (!access.ok) {
      res.status(access.statusCode).json({ error: access.error })
      return
    }
    const check = verifySebRequest(req, assessment)
    const userAgent = String(req.get('user-agent') || '')
    res.json({
      sebRequired: assessment.security_mode === 'seb',
      sebConfigReady: Boolean(assessment.seb_config_key),
      sebVerified: check.ok,
      verificationMethod: check.method || null,
      userAgentDetected: /\bSEB\//i.test(userAgent),
      message: check.ok
        ? 'Safe Exam Browser session verified.'
        : check.error,
    })
  })

  router.get('/learner/assessments/:id/seb-config', requireAuth, (req, res) => {
    const menteeId = typeof req.query.menteeId === 'string' ? req.query.menteeId : ''
    const assessment = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    const mentee = menteeId ? db.prepare('SELECT * FROM mentees WHERE id = ?').get(menteeId) : null
    if (!assessment || !mentee || (mentee.organisation_id || 'ORG-DEFAULT') !== (assessment.organisation_id || 'ORG-DEFAULT')) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    const access = checkLearnerAccess(req, mentee)
    if (!access.ok) {
      res.status(access.statusCode).json({ error: access.error })
      return
    }
    if (assessment.security_mode !== 'seb') {
      res.status(400).json({ error: 'Safe Exam Browser is not enabled for this assessment.' })
      return
    }
    if (assessment.status === 'Draft' || !assessment.seb_config_key) {
      res.status(409).json({ error: 'Safe Exam Browser configuration is available after the assessment is published.' })
      return
    }
    const host = req.get('host') || '127.0.0.1'
    const origin = `${req.protocol || 'http'}://${host}`
    const startUrl = `${origin}/#/learner/${encodeURIComponent(mentee.id)}?assessment=${encodeURIComponent(assessment.id)}`
    const quitUrl = `${origin}/#/learner/${encodeURIComponent(mentee.id)}`
    const plist = buildSebConfigPlist({ assessment, startUrl, quitUrl })
    res.set('Content-Type', 'application/seb; charset=utf-8')
    res.set('Content-Disposition', `attachment; filename="muna-${assessment.id}.seb"`)
    res.send(plist)
  })

  router.post('/learner/assessments/:id/start', requireAuth, (req, res) => {
    const menteeId = typeof req.body?.menteeId === 'string' ? req.body.menteeId : ''
    const startTx = db.transaction(() => {
      const assessment = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
      if (!assessment) return { statusCode: 404, error: 'Assessment not found.' }
      if (assessment.status !== 'Published') return { statusCode: 400, error: 'This assessment is not accepting attempts.' }
      const assignment = db.prepare(`
        SELECT 1 FROM assessment_assignments WHERE assessment_id = ? AND mentee_id = ?
      `).get(req.params.id, menteeId)
      const mentee = db.prepare('SELECT * FROM mentees WHERE id = ?').get(menteeId)
      if (!assignment || !mentee || (mentee.organisation_id || 'ORG-DEFAULT') !== (assessment.organisation_id || 'ORG-DEFAULT')) {
        return { statusCode: 403, error: 'This assessment is not assigned to the mentee.' }
      }
      const access = checkLearnerAccess(req, mentee)
      if (!access.ok) return { statusCode: access.statusCode, error: access.error }
      const sebCheck = verifySebRequest(req, assessment)
      if (!sebCheck.ok) {
        return { statusCode: 403, error: sebCheck.error, sebRequired: true }
      }

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
      res.status(outcome.statusCode).json({ error: outcome.error, ...(outcome.sebRequired ? { sebRequired: true } : {}) })
      return
    }
    res.status(outcome.statusCode).json({
      attempt: outcome.attempt,
      questions: outcome.questions,
      resumed: outcome.resumed,
    })
  })

  router.put('/learner/attempts/:attemptId/responses', requireAuth, (req, res) => {
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
    const access = checkLearnerAccess(req, mentee)
    if (!access.ok) {
      res.status(access.statusCode).json({ error: access.error })
      return
    }
    const sebCheck = verifySebRequest(req, assessment)
    if (!sebCheck.ok) {
      res.status(403).json({ error: sebCheck.error, sebRequired: true })
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

  router.post('/learner/attempts/:attemptId/security-events', requireAuth, (req, res) => {
    const menteeId = typeof req.body?.menteeId === 'string' ? req.body.menteeId : ''
    const eventType = req.body?.eventType
    const detail = typeof req.body?.detail === 'string' ? req.body.detail.trim().slice(0, 500) : ''
    const clientTimestamp = parseOptionalIsoDate(req.body?.clientTimestamp)
    if (!SECURITY_EVENT_TYPES.includes(eventType)) {
      res.status(400).json({ error: 'Unsupported security event type.' })
      return
    }
    if (clientTimestamp === false) {
      res.status(400).json({ error: 'Client timestamp must be valid ISO date if provided.' })
      return
    }

    const tx = db.transaction(() => {
      const attempt = db.prepare('SELECT * FROM assessment_attempts WHERE id = ?').get(req.params.attemptId)
      if (!attempt || attempt.mentee_id !== menteeId) {
        return { statusCode: 404, error: 'Attempt not found.' }
      }
      const assessment = db.prepare('SELECT * FROM assessments WHERE id = ?').get(attempt.assessment_id)
      const mentee = db.prepare('SELECT * FROM mentees WHERE id = ?').get(menteeId)
      if (!assessment || !mentee) {
        return { statusCode: 404, error: 'Assessment not found.' }
      }
      const access = checkLearnerAccess(req, mentee)
      if (!access.ok) {
        return { statusCode: access.statusCode, error: access.error }
      }
      if (attempt.status !== 'in_progress') {
        return {
          statusCode: 200,
          alreadyFinalized: true,
          terminated: attempt.status === 'terminated_focus_lost',
          status: attempt.status,
        }
      }

      const now = new Date().toISOString()
      const eventId = `SE-${randomUUID().slice(0, 8).toUpperCase()}`
      db.prepare(`
        INSERT INTO security_events (
          id, attempt_id, assessment_id, mentee_id, event_type, detail, client_timestamp, server_timestamp
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(eventId, attempt.id, assessment.id, menteeId, eventType, detail, clientTimestamp, now)

      const isStrictTermination = assessment.security_mode === 'strict_web' && eventType === 'visibility_hidden'
      if (eventType === 'visibility_hidden' || eventType === 'fullscreen_exited') {
        const hiddenCount = db.prepare(`
          SELECT COUNT(*) AS count FROM security_events
          WHERE attempt_id = ? AND event_type IN ('visibility_hidden', 'fullscreen_exited')
        `).get(attempt.id).count
        const existingFlag = db.prepare('SELECT * FROM flags WHERE attempt_id = ?').get(attempt.id)
        const signalTitle = isStrictTermination
          ? 'Attempt terminated — page focus lost in strict web mode'
          : 'Page focus or full-screen change during assessment'
        const signalDetail = isStrictTermination
          ? `Strict web mode locked attempt ${attempt.id} on visibility loss (${hiddenCount} signal${hiddenCount === 1 ? '' : 's'}).`
          : `${hiddenCount} focus/full-screen exit event${hiddenCount === 1 ? '' : 's'} recorded during attempt ${attempt.id}.`
        if (existingFlag) {
          db.prepare('UPDATE flags SET signal = ?, detail = ? WHERE id = ?').run(signalTitle, signalDetail, existingFlag.id)
        } else {
          const flagId = `F-${randomUUID().slice(0, 8).toUpperCase()}`
          db.prepare(`
            INSERT INTO flags (id, organisation_id, attempt_id, student, initials, assessment, signal, detail, level, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Needs review', ?)
          `).run(
            flagId,
            assessment.organisation_id || 'ORG-DEFAULT',
            attempt.id,
            mentee.name,
            initialsFor(mentee.name),
            assessment.title,
            signalTitle,
            signalDetail,
            now,
          )
        }
      }

      const eventRow = db.prepare('SELECT * FROM security_events WHERE id = ?').get(eventId)
      if (isStrictTermination) {
        let draftAnswers
        try {
          draftAnswers = JSON.parse(attempt.draft_answers_json || '{}') || {}
        } catch {
          draftAnswers = {}
        }
        const finalized = finalizeAttemptRecord({
          assessment,
          mentee,
          submittedAnswers: draftAnswers,
          existingAttempt: attempt,
          status: 'terminated_focus_lost',
          terminationReason: 'focus_lost',
          submittedAt: now,
          allowPartial: true,
        })
        const attemptCount = db.prepare(`
          SELECT COUNT(*) AS count FROM assessment_attempts
          WHERE assessment_id = ? AND mentee_id = ?
        `).get(assessment.id, menteeId).count
        const allowance = getAttemptAllowance(assessment, menteeId)
        const showResults = resultsAreVisible(assessment)
        return {
          statusCode: 200,
          recorded: true,
          terminated: true,
          reason: 'focus_lost',
          event: securityEventFromRow(eventRow),
          attempt: {
            ...finalized.attempt,
            score: showResults ? finalized.attempt.score : null,
            earnedPoints: showResults ? finalized.attempt.earnedPoints : null,
            maxPoints: showResults ? finalized.attempt.maxPoints : null,
            resultsVisible: showResults,
            attemptCount,
            maxAttempts: allowance.allowedAttempts,
          },
        }
      }

      return {
        statusCode: 201,
        recorded: true,
        terminated: false,
        event: securityEventFromRow(eventRow),
      }
    })

    const outcome = tx.immediate()
    if (outcome.error) {
      res.status(outcome.statusCode).json({ error: outcome.error })
      return
    }
    res.status(outcome.statusCode).json(outcome)
  })

  router.post('/learner/assessments/:id/attempts', requireAuth, (req, res) => {
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
    if (!assignment || !mentee || (mentee.organisation_id || 'ORG-DEFAULT') !== (assessment.organisation_id || 'ORG-DEFAULT')) {
      res.status(403).json({ error: 'This assessment is not assigned to the mentee.' })
      return
    }
    const access = checkLearnerAccess(req, mentee)
    if (!access.ok) {
      res.status(access.statusCode).json({ error: access.error })
      return
    }
    const sebCheck = verifySebRequest(req, assessment)
    if (!sebCheck.ok) {
      res.status(403).json({ error: sebCheck.error, sebRequired: true })
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

  router.get('/organisations', requireAuth, (req, res) => {
    const organisations = getUserOrganisations(req.session.user.id, req.session.user.email)
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
    const organisations = getUserOrganisations(req.session.user.id, req.session.user.email)
    const matched = organisations.find((org) => org.id === target || org.slug === target)
    if (!matched) {
      res.status(403).json({ error: 'You do not have access to this organisation.' })
      return
    }
    req.session.activeOrganisationId = matched.id
    res.json({ organisation: matched, organisations })
  })

  function handleListMembers(req, res) {
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

  function handleUpdateMember(req, res) {
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

  function handleDeleteMember(req, res) {
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

  function handleListInvitations(req, res) {
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

  function handleCreateInvitation(req, res) {
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

  function handleDeleteInvitation(req, res) {
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

  router.get('/organisations/:orgId/members', requireAuth, requireVerifiedEmail, resolveOrgContext, handleListMembers)
  router.patch('/organisations/:orgId/members/:id', requireAuth, requireVerifiedEmail, resolveOrgContext, requireOrgAdmin, verifyCsrf, handleUpdateMember)
  router.delete('/organisations/:orgId/members/:id', requireAuth, requireVerifiedEmail, resolveOrgContext, requireOrgAdmin, verifyCsrf, handleDeleteMember)
  router.get('/organisations/:orgId/invitations', requireAuth, requireVerifiedEmail, resolveOrgContext, handleListInvitations)
  router.post('/organisations/:orgId/invitations', requireAuth, requireVerifiedEmail, resolveOrgContext, requireOrgAdmin, verifyCsrf, handleCreateInvitation)
  router.delete('/organisations/:orgId/invitations/:id', requireAuth, requireVerifiedEmail, resolveOrgContext, requireOrgAdmin, verifyCsrf, handleDeleteInvitation)

  router.use(requireAuth, requireVerifiedEmail, resolveOrgContext)

  router.get('/questions', (req, res) => {
    const { page, limit, offset } = pagination(req)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const clauses = ['organisation_id = ?']
    const params = [req.org.id]
    if (search) {
      clauses.push('(lower(prompt) LIKE ? OR lower(id) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    const where = `WHERE ${clauses.join(' AND ')}`
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
    res.status(201).json({ question: addQuestion(db, req.body, req.org.id) })
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
    const insertQuestions = db.transaction((items) => items.map((item) => addQuestion(db, item, req.org.id)))
    const imported = insertQuestions(questions)
    res.status(201).json({ questions: imported })
  })

  router.patch('/questions/:id', verifyCsrf, (req, res) => {
    const validationError = validateQuestion(req.body)
    if (validationError) {
      res.status(400).json({ error: validationError })
      return
    }
    const existing = db.prepare('SELECT * FROM questions WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
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
      WHERE id = ? AND organisation_id = ?
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
      req.org.id,
    )
    const row = db.prepare('SELECT * FROM questions WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
    res.json({ question: questionFromRow(row) })
  })

  router.delete('/questions/:id', verifyCsrf, (req, res) => {
    const existing = db.prepare('SELECT id FROM questions WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
    if (!existing) {
      res.status(404).json({ error: 'Question not found.' })
      return
    }
    const inUse = db.prepare('SELECT COUNT(*) AS count FROM assessment_questions WHERE question_id = ?').get(req.params.id).count
    if (inUse) {
      res.status(409).json({ error: 'This question is used by one or more assessments and cannot be deleted.' })
      return
    }
    db.prepare('DELETE FROM questions WHERE id = ? AND organisation_id = ?').run(req.params.id, req.org.id)
    res.json({ ok: true })
  })

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

  router.get('/assessments', (req, res) => {
    const { page, limit, offset } = pagination(req)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const clauses = ['organisation_id = ?']
    const params = [req.org.id]
    if (search) {
      clauses.push('(lower(title) LIKE ? OR lower(description) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`)
    }
    const where = `WHERE ${clauses.join(' AND ')}`
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
    const foundQuestions = db.prepare(`SELECT COUNT(*) AS count FROM questions WHERE organisation_id = ? AND id IN (${questionPlaceholders})`).get(req.org.id, ...questionIds).count
    const foundMentees = db.prepare(`SELECT COUNT(*) AS count FROM mentees WHERE organisation_id = ? AND id IN (${menteePlaceholders})`).get(req.org.id, ...menteeIds).count
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
          id, organisation_id, title, description, max_attempts, time_limit_minutes, available_from, available_until,
          shuffle_questions, shuffle_options, navigation_mode, feedback_policy, results_released,
          security_mode, require_fullscreen, seb_browser_exam_key, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'Draft', ?, ?)
      `).run(
        assessmentId,
        req.org.id,
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
        settings.securityMode,
        settings.requireFullscreen,
        settings.sebBrowserExamKey,
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
    const existing = db.prepare('SELECT * FROM assessments WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
    if (!existing) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    if (existing.status === 'Draft' && status === 'Paused') {
      res.status(400).json({ error: 'A draft must be published before it can be paused.' })
      return
    }
    const updatedAt = new Date().toISOString()
    db.transaction(() => {
      let nextSebConfigKey = existing.seb_config_key || null
      if (status === 'Published' && existing.security_mode === 'seb' && !nextSebConfigKey) {
        nextSebConfigKey = randomBytes(32).toString('hex')
        logAudit(db, {
          organisationId: req.org.id,
          actor: req.session.user.name,
          action: 'generate_seb_config',
          entityType: 'assessment',
          entityId: req.params.id,
          detail: { title: existing.title },
        })
      }
      db.prepare('UPDATE assessments SET status = ?, seb_config_key = ?, updated_at = ? WHERE id = ? AND organisation_id = ?')
        .run(status, nextSebConfigKey, updatedAt, req.params.id, req.org.id)
    })()
    const row = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    res.json({ assessment: assessmentFromRow(db, row) })
  })

  router.get('/assessments/:id/seb-config', (req, res) => {
    const assessment = db.prepare('SELECT * FROM assessments WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    if (assessment.security_mode !== 'seb') {
      res.status(400).json({ error: 'Enable Safe Exam Browser mode on this assessment to generate a .seb file.' })
      return
    }
    if (assessment.status === 'Draft' || !assessment.seb_config_key) {
      res.status(409).json({ error: 'Publish the assessment before distributing its Safe Exam Browser configuration.' })
      return
    }
    const host = req.get('host') || '127.0.0.1'
    const origin = `${req.protocol || 'http'}://${host}`
    const startUrl = `${origin}/#/learner`
    const quitUrl = `${origin}/#/learner`
    logAudit(db, {
      organisationId: req.org.id,
      actor: req.session.user.name,
      action: 'download_seb_config',
      entityType: 'assessment',
      entityId: assessment.id,
      detail: { title: assessment.title, format: req.query.format === 'json' ? 'json' : 'seb' },
    })
    if (req.query.format === 'json') {
      res.json({
        assessmentId: assessment.id,
        sebConfigKey: assessment.seb_config_key,
        sebBrowserExamKey: assessment.seb_browser_exam_key || null,
        startUrl,
        quitUrl,
        downloadPath: `/api/assessments/${encodeURIComponent(assessment.id)}/seb-config`,
      })
      return
    }
    const plist = buildSebConfigPlist({ assessment, startUrl, quitUrl })
    res.set('Content-Type', 'application/seb; charset=utf-8')
    res.set('Content-Disposition', `attachment; filename="muna-${assessment.id}.seb"`)
    res.send(plist)
  })

  router.post('/assessments/:id/release-results', verifyCsrf, (req, res) => {
    const existing = db.prepare('SELECT * FROM assessments WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
    if (!existing) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    const updatedAt = new Date().toISOString()
    db.transaction(() => {
      db.prepare('UPDATE assessments SET results_released = 1, updated_at = ? WHERE id = ? AND organisation_id = ?').run(updatedAt, req.params.id, req.org.id)
      logAudit(db, {
        organisationId: req.org.id,
        actor: req.session.user.name,
        action: 'release_results',
        entityType: 'assessment',
        entityId: req.params.id,
        detail: { title: existing.title },
      })
    })()
    const row = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    res.json({ assessment: assessmentFromRow(db, row) })
  })

  router.post('/assessments/:id/extra-attempts', verifyCsrf, (req, res) => {
    const assessment = db.prepare('SELECT * FROM assessments WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
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
    db.transaction(() => {
      db.prepare(`
        INSERT INTO extra_attempt_grants (id, assessment_id, mentee_id, extra_attempts, reason, granted_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, req.params.id, menteeId, extraAttempts, reason, req.session.user.name, createdAt)
      logAudit(db, {
        organisationId: req.org.id,
        actor: req.session.user.name,
        action: 'grant_extra_attempts',
        entityType: 'assessment',
        entityId: req.params.id,
        detail: { menteeId, extraAttempts, reason },
      })
    })()
    const grant = db.prepare(`
      SELECT id, mentee_id AS menteeId, extra_attempts AS extraAttempts, reason, granted_by AS grantedBy, created_at AS createdAt
      FROM extra_attempt_grants WHERE id = ?
    `).get(id)
    const row = db.prepare('SELECT * FROM assessments WHERE id = ?').get(req.params.id)
    res.status(201).json({ grant, assessment: assessmentFromRow(db, row) })
  })

  router.patch('/assessments/:id', verifyCsrf, (req, res) => {
    const existing = db.prepare('SELECT * FROM assessments WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
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
    const foundQuestions = db.prepare(`SELECT COUNT(*) AS count FROM questions WHERE organisation_id = ? AND id IN (${questionPlaceholders})`).get(req.org.id, ...req.body.questionIds).count
    const foundMentees = db.prepare(`SELECT COUNT(*) AS count FROM mentees WHERE organisation_id = ? AND id IN (${menteePlaceholders})`).get(req.org.id, ...req.body.menteeIds).count
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
            navigation_mode = ?, feedback_policy = ?, security_mode = ?, require_fullscreen = ?,
            seb_browser_exam_key = ?, updated_at = ?
        WHERE id = ? AND organisation_id = ?
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
        settings.securityMode,
        settings.requireFullscreen,
        settings.sebBrowserExamKey,
        now,
        req.params.id,
        req.org.id,
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
    const existing = db.prepare('SELECT * FROM assessments WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
    if (!existing) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    if (existing.status !== 'Draft') {
      res.status(409).json({ error: 'Only draft assessments can be deleted.' })
      return
    }
    db.prepare('DELETE FROM assessments WHERE id = ? AND organisation_id = ?').run(req.params.id, req.org.id)
    res.json({ ok: true })
  })

  router.get('/answers', (req, res) => {
    const { page, limit, offset } = pagination(req)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const status = typeof req.query.status === 'string' ? req.query.status : ''
    const clauses = ['organisation_id = ?']
    const params = [req.org.id]
    if (search) {
      clauses.push('(lower(student) LIKE ? OR lower(assessment) LIKE ? OR lower(answer) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    if (status) {
      clauses.push('(status = ? OR review_decision = ?)')
      params.push(status, status)
    }
    const where = `WHERE ${clauses.join(' AND ')}`
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
    const existing = db.prepare('SELECT * FROM answers WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
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
        WHERE id = ? AND organisation_id = ?
      `).run(
        decision,
        feedback.trim(),
        req.session.user.name,
        reviewedAt,
        JSON.stringify(existingItems),
        nextScore,
        nextEarned,
        nextMax,
        req.params.id,
        req.org.id,
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
      `).run(req.params.id, req.session.user.name, decision, feedback.trim(), reviewedAt)
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

  router.get('/attempts/:attemptId/security-events', (req, res) => {
    const attempt = db.prepare(`
      SELECT aa.id, aa.status, aa.termination_reason AS terminationReason
      FROM assessment_attempts aa
      JOIN assessments a ON a.id = aa.assessment_id
      WHERE aa.id = ? AND a.organisation_id = ?
    `).get(req.params.attemptId, req.org.id)
    if (!attempt) {
      res.status(404).json({ error: 'Attempt not found.' })
      return
    }
    const rows = db.prepare(`
      SELECT * FROM security_events
      WHERE attempt_id = ?
      ORDER BY server_timestamp ASC, id ASC
    `).all(req.params.attemptId)
    res.json({ attempt, events: rows.map(securityEventFromRow) })
  })

  router.get('/flags', (req, res) => {
    const { page, limit, offset } = pagination(req)
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : ''
    const clauses = ['organisation_id = ?']
    const params = [req.org.id]
    if (search) {
      clauses.push('(lower(student) LIKE ? OR lower(assessment) LIKE ? OR lower(signal) LIKE ?)')
      params.push(`%${search}%`, `%${search}%`, `%${search}%`)
    }
    const where = `WHERE ${clauses.join(' AND ')}`
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
      INSERT INTO flags (id, organisation_id, student, initials, assessment, signal, detail, level)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Needs review')
    `).run(id, req.org.id, student, initialsFor(student), assessment, signal, detail)
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
    const existing = db.prepare('SELECT id FROM flags WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
    if (!existing) {
      res.status(404).json({ error: 'Integrity signal not found.' })
      return
    }
    const reviewedAt = new Date().toISOString()
    const updateReview = db.transaction(() => {
      db.prepare(`
        UPDATE flags SET level = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ? AND organisation_id = ?
      `).run(decision, note.trim(), req.session.user.name, reviewedAt, req.params.id, req.org.id)
      db.prepare(`
        INSERT INTO review_history (entity_type, entity_id, actor, decision, note, created_at)
        VALUES ('flag', ?, ?, ?, ?, ?)
      `).run(req.params.id, req.session.user.name, decision, note.trim(), reviewedAt)
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
    const totalStudents = db.prepare('SELECT COUNT(*) AS count FROM mentees WHERE organisation_id = ?').get(req.org.id).count
    const totalQuestions = db.prepare('SELECT COUNT(*) AS count FROM questions WHERE organisation_id = ?').get(req.org.id).count
    const pendingAnswers = db.prepare("SELECT COUNT(*) AS count FROM answers WHERE organisation_id = ? AND status = 'Needs review'").get(req.org.id).count
    const unresolvedFlags = db.prepare("SELECT COUNT(*) AS count FROM flags WHERE organisation_id = ? AND level != 'Dismissed'").get(req.org.id).count
    const activityRows = db.prepare(`
      SELECT date(submitted_at) AS date, COUNT(*) AS count
      FROM answers
      WHERE organisation_id = ? AND submitted_at >= datetime('now', '-6 days')
      GROUP BY date(submitted_at)
    `).all(req.org.id)
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
    const table = entityType === 'answer' ? 'answers' : 'flags'
    const owned = db.prepare(`SELECT 1 FROM ${table} WHERE id = ? AND organisation_id = ?`).get(entityId, req.org.id)
    if (!owned) {
      res.status(404).json({ error: 'Entity not found.' })
      return
    }
    const history = getReviewHistory(db, entityType, entityId)
    res.json({ history })
  })

  router.get('/assessments/:id/analytics', (req, res) => {
    const assessment = db.prepare('SELECT * FROM assessments WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    const assignedCount = db.prepare('SELECT COUNT(*) AS count FROM assessment_assignments WHERE assessment_id = ?').get(assessment.id).count
    const attempts = db.prepare(`
      SELECT * FROM assessment_attempts WHERE assessment_id = ? ORDER BY submitted_at DESC, started_at DESC
    `).all(assessment.id)
    const participatingMentees = new Set(attempts.map((a) => a.mentee_id))
    const finalizedAttempts = attempts.filter((a) => a.status !== 'in_progress')
    const completedMentees = new Set(finalizedAttempts.map((a) => a.mentee_id))

    const buckets = [
      { label: '0–49%', count: 0 },
      { label: '50–69%', count: 0 },
      { label: '70–84%', count: 0 },
      { label: '85–100%', count: 0 },
    ]
    let percentSum = 0
    let percentCount = 0
    for (const attempt of finalizedAttempts) {
      if (attempt.max_points > 0) {
        const pct = (attempt.earned_points / attempt.max_points) * 100
        percentSum += pct
        percentCount++
        if (pct < 50) buckets[0].count++
        else if (pct < 70) buckets[1].count++
        else if (pct < 85) buckets[2].count++
        else buckets[3].count++
      }
    }

    const questionRows = db.prepare(`
      SELECT q.* FROM assessment_questions aq
      JOIN questions q ON q.id = aq.question_id
      WHERE aq.assessment_id = ? ORDER BY aq.position
    `).all(assessment.id)
    const itemStats = new Map(questionRows.map((row) => {
      const q = questionFromRow(row)
      return [q.id, {
        questionId: q.id,
        type: q.type,
        prompt: q.prompt,
        maxPoints: Number(q.points ?? 1),
        responseCount: 0,
        earnedSum: 0,
        needsReviewCount: 0,
      }]
    }))

    for (const attempt of finalizedAttempts) {
      let items
      try {
        items = JSON.parse(attempt.answers_json || '[]') || []
      } catch {
        items = []
      }
      for (const item of items) {
        const stat = itemStats.get(item.questionId)
        if (!stat) continue
        stat.responseCount++
        stat.earnedSum += Number(item.earnedPoints || 0)
        if (item.needsReview) stat.needsReviewCount++
      }
    }

    const itemAnalysis = [...itemStats.values()].map((stat) => {
      const averageEarned = stat.responseCount > 0 ? Math.round((stat.earnedSum / stat.responseCount) * 100) / 100 : 0
      const averagePercent = stat.responseCount > 0 && stat.maxPoints > 0
        ? Math.round((averageEarned / stat.maxPoints) * 100)
        : 0
      return {
        questionId: stat.questionId,
        type: stat.type,
        prompt: stat.prompt,
        maxPoints: stat.maxPoints,
        responseCount: stat.responseCount,
        averageEarned,
        averagePercent,
        needsReviewCount: stat.needsReviewCount,
      }
    })

    const securityEventCount = db.prepare('SELECT COUNT(*) AS count FROM security_events WHERE assessment_id = ?').get(assessment.id).count

    res.json({
      assessment: assessmentFromRow(db, assessment),
      summary: {
        assignedCount,
        participatingCount: participatingMentees.size,
        completedCount: completedMentees.size,
        completionRate: assignedCount > 0 ? Math.round((completedMentees.size / assignedCount) * 100) : 0,
        totalAttempts: attempts.length,
        inProgressCount: attempts.filter((a) => a.status === 'in_progress').length,
        submittedCount: attempts.filter((a) => a.status === 'submitted').length,
        expiredCount: attempts.filter((a) => a.status === 'expired').length,
        terminatedCount: attempts.filter((a) => a.status === 'terminated_focus_lost').length,
        averageScorePercent: percentCount > 0 ? Math.round(percentSum / percentCount) : 0,
        securityEventCount,
      },
      scoreDistribution: buckets,
      itemAnalysis,
    })
  })

  router.get('/assessments/:id/export.csv', (req, res) => {
    const assessment = db.prepare('SELECT * FROM assessments WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
    if (!assessment) {
      res.status(404).json({ error: 'Assessment not found.' })
      return
    }
    const rows = db.prepare(`
      SELECT aa.*, m.name AS mentee_name, m.email AS mentee_email,
        (SELECT COUNT(*) FROM security_events se WHERE se.attempt_id = aa.id) AS security_event_count
      FROM assessment_attempts aa
      JOIN mentees m ON m.id = aa.mentee_id
      WHERE aa.assessment_id = ?
      ORDER BY lower(m.name) ASC, aa.started_at ASC, aa.submitted_at ASC
    `).all(assessment.id)

    const headers = [
      'Attempt ID',
      'Mentee Name',
      'Mentee Email',
      'Assessment',
      'Status',
      'Termination Reason',
      'Score',
      'Earned Points',
      'Max Points',
      'Grading Status',
      'Started At',
      'Submitted At',
      'Security Events',
    ]
    const lines = [
      headers.map(escapeCsvCell).join(','),
      ...rows.map((row) => [
        row.id,
        row.mentee_name,
        row.mentee_email,
        assessment.title,
        row.status,
        row.termination_reason || '',
        row.score,
        row.earned_points,
        row.max_points,
        row.grading_status,
        row.started_at || '',
        row.submitted_at || '',
        row.security_event_count,
      ].map(escapeCsvCell).join(',')),
    ]

    logAudit(db, {
      organisationId: req.org.id,
      actor: req.session.user.name,
      action: 'export_csv',
      entityType: 'assessment',
      entityId: assessment.id,
      detail: { title: assessment.title, rowCount: rows.length },
    })

    res.set('Content-Type', 'text/csv; charset=utf-8')
    res.set('Content-Disposition', `attachment; filename="assessment-${assessment.id}-results.csv"`)
    res.send(lines.join('\r\n'))
  })

  router.get('/mentees/:id/history', (req, res) => {
    const mentee = db.prepare('SELECT * FROM mentees WHERE id = ? AND organisation_id = ?').get(req.params.id, req.org.id)
    if (!mentee) {
      res.status(404).json({ error: 'Mentee not found.' })
      return
    }
    const assignments = db.prepare(`
      SELECT a.id, a.title, a.status, a.max_attempts AS maxAttempts, a.security_mode AS securityMode, aa.assigned_at AS assignedAt
      FROM assessment_assignments aa
      JOIN assessments a ON a.id = aa.assessment_id
      WHERE aa.mentee_id = ?
      ORDER BY aa.assigned_at DESC
    `).all(mentee.id)
    const attempts = db.prepare(`
      SELECT aa.*, a.title AS assessment_title
      FROM assessment_attempts aa
      JOIN assessments a ON a.id = aa.assessment_id
      WHERE aa.mentee_id = ?
      ORDER BY COALESCE(NULLIF(aa.submitted_at, ''), aa.started_at) DESC
    `).all(mentee.id).map((row) => ({
      id: row.id,
      assessmentId: row.assessment_id,
      assessmentTitle: row.assessment_title,
      status: row.status,
      terminationReason: row.termination_reason || null,
      score: row.score,
      earnedPoints: row.earned_points,
      maxPoints: row.max_points,
      gradingStatus: row.grading_status,
      startedAt: row.started_at || null,
      submittedAt: row.submitted_at || null,
    }))
    const securityEvents = db.prepare(`
      SELECT se.*, a.title AS assessment_title
      FROM security_events se
      JOIN assessments a ON a.id = se.assessment_id
      WHERE se.mentee_id = ?
      ORDER BY se.server_timestamp DESC
      LIMIT 100
    `).all(mentee.id).map((row) => ({
      ...securityEventFromRow(row),
      assessmentTitle: row.assessment_title,
    }))
    const extraAttemptGrants = db.prepare(`
      SELECT g.id, g.assessment_id AS assessmentId, a.title AS assessmentTitle,
             g.extra_attempts AS extraAttempts, g.reason, g.granted_by AS grantedBy, g.created_at AS createdAt
      FROM extra_attempt_grants g
      JOIN assessments a ON a.id = g.assessment_id
      WHERE g.mentee_id = ?
      ORDER BY g.created_at DESC
    `).all(mentee.id)

    res.json({
      mentee: menteeFromRow(mentee),
      assignments,
      attempts,
      securityEvents,
      extraAttemptGrants,
    })
  })

  router.get('/audit-logs', (req, res) => {
    const { page, limit, offset } = pagination(req, 25)
    const total = db.prepare('SELECT COUNT(*) AS count FROM audit_logs WHERE organisation_id = ?').get(req.org.id).count
    const rows = db.prepare('SELECT * FROM audit_logs WHERE organisation_id = ? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?').all(req.org.id, limit, offset)
    res.json({
      auditLogs: rows.map(auditLogFromRow),
      pagination: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) },
    })
  })

  router.get('/members', handleListMembers)
  router.patch('/members/:id', requireOrgAdmin, verifyCsrf, handleUpdateMember)
  router.delete('/members/:id', requireOrgAdmin, verifyCsrf, handleDeleteMember)

  router.get('/invitations', handleListInvitations)
  router.post('/invitations', requireOrgAdmin, verifyCsrf, handleCreateInvitation)
  router.delete('/invitations/:id', requireOrgAdmin, verifyCsrf, handleDeleteInvitation)

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

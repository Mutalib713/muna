import { Buffer } from 'node:buffer'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import path from 'node:path'
import bcrypt from 'bcryptjs'
import express from 'express'
import session from 'express-session'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { answerFromRow, assessmentFromRow, flagFromRow, menteeFromRow, questionFromRow } from './db.js'
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

function validateQuestion(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Each question must be an object.'
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  if (!prompt || prompt.length > 5000) return 'Question text must be between 1 and 5000 characters.'
  if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 8) {
    return 'Each question must have between 2 and 8 answer options.'
  }
  const options = input.options.map((option) => typeof option === 'string' ? option.trim() : option)
  if (options.some((option) => typeof option !== 'string' || !option || option.length > 1000)) {
    return 'Answer options must contain between 1 and 1000 characters.'
  }
  if (typeof input.correctAnswer !== 'string' || !options.includes(input.correctAnswer.trim())) {
    return 'The correct answer must match one of the question options.'
  }
  return null
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
  return null
}

function addQuestion(db, input) {
  const question = {
    id: `Q-${randomUUID().slice(0, 8).toUpperCase()}`,
    prompt: input.prompt.trim(),
    options: input.options.map((option) => option.trim()),
    correctAnswer: input.correctAnswer.trim(),
    status: 'Published',
    createdAt: new Date().toISOString(),
  }
  db.prepare(`
    INSERT INTO questions (id, prompt, options_json, correct_answer, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(question.id, question.prompt, JSON.stringify(question.options), question.correctAnswer, question.status, question.createdAt)
  return question
}

function getReviewHistory(db, entityType, entityId) {
  return db.prepare(`
    SELECT actor, decision, note, created_at AS createdAt
    FROM review_history
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY id DESC
  `).all(entityType, entityId)
}

export function createApp({ db, adminEmail, adminName = 'Administrator', passwordHash, sessionSecret, production = false, trustProxyHops = 0, distPath }) {
  const app = express()
  const router = express.Router()
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
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
  app.use(express.json({ limit: '100kb' }))
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

  router.post('/auth/login', loginLimiter, verifyCsrf, async (req, res, next) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
      const password = typeof req.body?.password === 'string' ? req.body.password : ''
      const passwordMatches = await bcrypt.compare(password, passwordHash)
      if (!email || email !== adminEmail.toLowerCase() || !passwordMatches) {
        res.status(401).json({ error: 'Invalid email or password.' })
        return
      }

      req.session.regenerate((error) => {
        if (error) {
          next(error)
          return
        }
        req.session.admin = { email: adminEmail, name: adminName, role: 'admin' }
        req.session.csrfToken = randomBytes(32).toString('hex')
        req.session.save((saveError) => {
          if (saveError) {
            next(saveError)
            return
          }
          res.json({ user: req.session.admin, csrfToken: req.session.csrfToken })
        })
      })
    } catch (error) {
      next(error)
    }
  })

  router.get('/auth/me', requireAdmin, (req, res) => {
    res.json({ user: req.session.admin })
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

  router.use(requireAdmin)

  router.get('/questions', (req, res) => {
    const rows = db.prepare('SELECT * FROM questions ORDER BY created_at DESC, id DESC').all()
    res.json({ questions: rows.map(questionFromRow) })
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

  router.get('/mentees', (req, res) => {
    const mentees = db.prepare('SELECT * FROM mentees ORDER BY name').all()
    res.json({ mentees: mentees.map(menteeFromRow) })
  })

  router.get('/assessments', (req, res) => {
    const rows = db.prepare('SELECT * FROM assessments ORDER BY created_at DESC, id DESC').all()
    res.json({ assessments: rows.map((row) => assessmentFromRow(db, row)) })
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
    const assessment = {
      id: `AS-${randomUUID().slice(0, 8).toUpperCase()}`,
      title: req.body.title.trim(),
      description: (req.body.description || '').trim(),
      maxAttempts: req.body.maxAttempts ?? 3,
      status: 'Draft',
      createdAt: now,
      updatedAt: now,
    }
    const insertAssessment = db.transaction(() => {
      db.prepare(`
        INSERT INTO assessments (id, title, description, max_attempts, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(assessment.id, assessment.title, assessment.description, assessment.maxAttempts, assessment.status, now, now)
      const insertQuestion = db.prepare('INSERT INTO assessment_questions (assessment_id, question_id, position) VALUES (?, ?, ?)')
      questionIds.forEach((questionId, index) => insertQuestion.run(assessment.id, questionId, index))
      const insertAssignment = db.prepare('INSERT INTO assessment_assignments (assessment_id, mentee_id, assigned_at) VALUES (?, ?, ?)')
      menteeIds.forEach((menteeId) => insertAssignment.run(assessment.id, menteeId, now))
    })
    insertAssessment()
    const row = db.prepare('SELECT * FROM assessments WHERE id = ?').get(assessment.id)
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

  router.get('/answers', (req, res) => {
    const rows = db.prepare('SELECT * FROM answers ORDER BY submitted_at DESC').all()
    res.json({ answers: rows.map((row) => ({
      ...answerFromRow(row),
      reviewHistory: getReviewHistory(db, 'answer', row.id),
    })) })
  })

  router.patch('/answers/:id/review', verifyCsrf, (req, res) => {
    const { decision, feedback } = req.body || {}
    if (!['Approved', 'Revision requested'].includes(decision)) {
      res.status(400).json({ error: 'Choose Approved or Revision requested.' })
      return
    }
    if (typeof feedback !== 'string' || feedback.length > 5000 || (decision === 'Revision requested' && !feedback.trim())) {
      res.status(400).json({ error: 'Feedback is required for a revision request and must be 5000 characters or fewer.' })
      return
    }
    const existing = db.prepare('SELECT id FROM answers WHERE id = ?').get(req.params.id)
    if (!existing) {
      res.status(404).json({ error: 'Submission not found.' })
      return
    }
    const reviewedAt = new Date().toISOString()
    const updateReview = db.transaction(() => {
      db.prepare(`
        UPDATE answers
        SET status = 'Reviewed', review_decision = ?, feedback = ?, reviewed_by = ?, reviewed_at = ?
        WHERE id = ?
      `).run(decision, feedback.trim(), req.session.admin.name, reviewedAt, req.params.id)
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
    const rows = db.prepare('SELECT * FROM flags ORDER BY id DESC').all()
    res.json({ flags: rows.map((row) => ({
      ...flagFromRow(row),
      reviewHistory: getReviewHistory(db, 'flag', row.id),
    })) })
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

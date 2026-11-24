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

function validateMentee(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Mentee details are required.'
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (!name || name.length > 120) return 'Mentee name must contain 1 to 120 characters.'
  if (!email || email.length > 254 || !email.includes('@')) return 'A valid mentee email is required.'
  return null
}

function initialsFor(name) {
  return name.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function pagination(req, defaultLimit = 25) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || defaultLimit))
  return { page, limit, offset: (page - 1) * limit }
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
        const questionIds = db.prepare(`
          SELECT question_id FROM assessment_questions
          WHERE assessment_id = ? ORDER BY position
        `).all(row.id).map((item) => item.question_id)
        const questions = questionIds.map((id) => {
          const question = db.prepare('SELECT * FROM questions WHERE id = ?').get(id)
          const publicQuestion = questionFromRow(question)
          delete publicQuestion.correctAnswer
          delete publicQuestion.status
          return publicQuestion
        })
        const attemptCount = db.prepare(`
          SELECT COUNT(*) AS count FROM assessment_attempts
          WHERE assessment_id = ? AND mentee_id = ?
        `).get(row.id, req.params.menteeId).count
        return {
          id: row.id,
          title: row.title,
          description: row.description,
          maxAttempts: row.max_attempts,
          attemptCount,
          questions,
        }
      }),
    })
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
    const attemptCount = db.prepare(`
      SELECT COUNT(*) AS count FROM assessment_attempts
      WHERE assessment_id = ? AND mentee_id = ?
    `).get(req.params.id, menteeId).count
    if (attemptCount >= assessment.max_attempts) {
      res.status(409).json({ error: 'The maximum number of attempts has been reached.' })
      return
    }
    const submittedAnswers = req.body?.answers
    if (!submittedAnswers || typeof submittedAnswers !== 'object' || Array.isArray(submittedAnswers)) {
      res.status(400).json({ error: 'Submitted answers are required.' })
      return
    }
    const questionRows = db.prepare(`
      SELECT q.* FROM assessment_questions aq
      JOIN questions q ON q.id = aq.question_id
      WHERE aq.assessment_id = ? ORDER BY aq.position
    `).all(req.params.id)
    let correctCount = 0
    const answerDetails = questionRows.map((question) => {
      const publicAnswer = typeof submittedAnswers[question.id] === 'string' ? submittedAnswers[question.id].trim() : ''
      if (publicAnswer === question.correct_answer) correctCount++
      return { questionId: question.id, answer: publicAnswer }
    })
    if (answerDetails.some((item) => !item.answer)) {
      res.status(400).json({ error: 'Answer every question before submitting.' })
      return
    }
    const score = `${correctCount} / ${questionRows.length}`
    const now = new Date().toISOString()
    const attemptId = `AT-${randomUUID().slice(0, 8).toUpperCase()}`
    const answerId = `A-${randomUUID().slice(0, 8).toUpperCase()}`
    const answerSummary = answerDetails.map((item) => {
      const question = questionRows.find((row) => row.id === item.questionId)
      return `${question.prompt}: ${item.answer}`
    }).join('\n')
    const submitAttempt = db.transaction(() => {
      db.prepare(`
        INSERT INTO assessment_attempts (id, assessment_id, mentee_id, answers_json, score, submitted_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(attemptId, req.params.id, menteeId, JSON.stringify(answerDetails), score, now)
      db.prepare(`
        INSERT INTO answers (id, student, initials, assessment, answer, score, submitted_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'Needs review')
      `).run(answerId, mentee.name, initialsFor(mentee.name), assessment.title, answerSummary, score, now)
    })
    submitAttempt()
    res.status(201).json({
      attempt: { id: attemptId, score, submittedAt: now, attemptCount: attemptCount + 1, maxAttempts: assessment.max_attempts },
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
    db.prepare(`
      UPDATE questions
      SET prompt = ?, options_json = ?, correct_answer = ?, status = 'Published'
      WHERE id = ?
    `).run(req.body.prompt.trim(), JSON.stringify(req.body.options.map((option) => option.trim())), req.body.correctAnswer.trim(), req.params.id)
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
    const updateAssessment = db.transaction(() => {
      db.prepare(`
        UPDATE assessments
        SET title = ?, description = ?, max_attempts = ?, updated_at = ?
        WHERE id = ?
      `).run(req.body.title.trim(), (req.body.description || '').trim(), req.body.maxAttempts ?? 3, now, req.params.id)
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

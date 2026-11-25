import { randomBytes, randomUUID } from 'node:crypto'
import { assessmentFromRow } from '../db.js'
import { verifyCsrf } from '../middleware/auth.js'
import { buildSebConfigPlist } from '../lib/seb.js'
import { normalizeAssessmentSettings, pagination, validateAssessment } from '../lib/validation.js'
import { logAudit } from '../lib/workspaceHelpers.js'

/** Register organisation-scoped assessment authoring, SEB, and publishing routes. */
export function registerAssessmentRoutes(router, db) {
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
}

import { randomUUID } from 'node:crypto'
import { initialsFor, questionFromRow, securityEventFromRow } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { buildSebConfigPlist, verifySebRequest } from '../lib/seb.js'
import { SECURITY_EVENT_TYPES, parseOptionalIsoDate } from '../lib/validation.js'
import {
  expireOverdueAttemptIfNeeded,
  finalizeAttemptRecord,
  getAttemptAllowance,
  getAvailabilityState,
  getOrderedLearnerQuestions,
  resultsAreVisible,
  shuffleList,
} from '../lib/assessmentDelivery.js'

/** Register authenticated learner assessment, autosave, SEB, and attempt routes. */
export function registerLearnerRoutes(router, { db, checkLearnerAccess }) {
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
          expireOverdueAttemptIfNeeded(db, row, mentee, inProgress)
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
        const allowance = getAttemptAllowance(db, row, req.params.menteeId)
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
          questions: getOrderedLearnerQuestions(db, row.id, activeAttemptRow),
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
            questions: getOrderedLearnerQuestions(db, assessment.id, existingActive),
          }
        }
        finalizeAttemptRecord(db, {
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
      const allowance = getAttemptAllowance(db, assessment, menteeId)
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
        questions: getOrderedLearnerQuestions(db, assessment.id, createdRow),
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
    const expired = expireOverdueAttemptIfNeeded(db, assessment, mentee, attempt)
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
        const finalized = finalizeAttemptRecord(db, {
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
        const allowance = getAttemptAllowance(db, assessment, menteeId)
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
        const finalized = finalizeAttemptRecord(db, {
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
      const allowance = getAttemptAllowance(db, assessment, menteeId)
      if (attemptCount >= allowance.allowedAttempts) {
        return { statusCode: 409, error: 'The maximum number of attempts has been reached.' }
      }
      const finalized = finalizeAttemptRecord(db, {
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
    const allowance = getAttemptAllowance(db, assessment, menteeId)
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
}

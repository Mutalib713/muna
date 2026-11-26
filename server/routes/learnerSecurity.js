import { randomUUID } from 'node:crypto'
import { initialsFor, securityEventFromRow } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { buildSebConfigPlist, verifySebRequest } from '../lib/seb.js'
import { SECURITY_EVENT_TYPES, parseOptionalIsoDate } from '../lib/validation.js'
import {
  finalizeAttemptRecord,
  getAttemptAllowance,
  resultsAreVisible,
} from '../lib/assessmentDelivery.js'

/** Register learner SEB verification/config download and focus/visibility telemetry routes. */
export function registerLearnerSecurityRoutes(router, { db, checkLearnerAccess }) {
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
}

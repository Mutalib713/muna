import { requireAuth } from '../middleware/auth.js'
import {
  expireOverdueAttemptIfNeeded,
  getAttemptAllowance,
  getAvailabilityState,
  getOrderedLearnerQuestions,
  resultsAreVisible,
} from '../lib/assessmentDelivery.js'
import { registerLearnerSecurityRoutes } from './learnerSecurity.js'
import { registerLearnerAttemptRoutes } from './learnerAttempts.js'

/** Register all authenticated learner routes (list, SEB checks/configs, attempts, security telemetry). */
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

  registerLearnerSecurityRoutes(router, { db, checkLearnerAccess })
  registerLearnerAttemptRoutes(router, { db, checkLearnerAccess })
}

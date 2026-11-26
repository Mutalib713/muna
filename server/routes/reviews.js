import { randomUUID } from 'node:crypto'
import { answerFromRow, flagFromRow, initialsFor, securityEventFromRow } from '../db.js'
import { verifyCsrf } from '../middleware/auth.js'
import { formatPoints } from '../question-utils.js'
import { pagination } from '../lib/validation.js'
import { getReviewHistory } from '../lib/workspaceHelpers.js'

/** Register organisation-scoped answer grading, integrity flag, and security-event review routes. */
export function registerReviewRoutes(router, db) {
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
}

import { randomInt, randomUUID } from 'node:crypto'
import { initialsFor, questionFromRow } from '../db.js'
import { formatPoints, gradeQuestionResponse, sanitizeQuestionForLearner } from '../question-utils.js'

export function shuffleList(items) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(0, i + 1)
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

export function getAvailabilityState(assessment, nowMs = Date.now()) {
  if (assessment.available_from && nowMs < Date.parse(assessment.available_from)) return 'upcoming'
  if (assessment.available_until && nowMs > Date.parse(assessment.available_until)) return 'closed'
  return 'open'
}

export function resultsAreVisible(assessment, nowMs = Date.now()) {
  const policy = assessment.feedback_policy || 'immediate'
  if (policy === 'immediate') return true
  if (policy === 'after_deadline') {
    return Boolean(assessment.available_until && nowMs > Date.parse(assessment.available_until))
  }
  return Boolean(assessment.results_released)
}

export function getAttemptAllowance(db, assessment, menteeId) {
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

export function getOrderedLearnerQuestions(db, assessmentId, activeAttempt = null) {
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

export function finalizeAttemptRecord(db, {
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

export function expireOverdueAttemptIfNeeded(db, assessment, mentee, attempt) {
  if (!attempt || attempt.status !== 'in_progress' || !attempt.expires_at) return null
  if (Date.now() < Date.parse(attempt.expires_at)) return null
  let draftAnswers = {}
  try {
    draftAnswers = JSON.parse(attempt.draft_answers_json || '{}') || {}
  } catch {
    draftAnswers = {}
  }
  const tx = db.transaction(() => finalizeAttemptRecord(db, {
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

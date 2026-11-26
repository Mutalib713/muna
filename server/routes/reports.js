import { assessmentFromRow, auditLogFromRow, menteeFromRow, questionFromRow, securityEventFromRow } from '../db.js'
import { escapeCsvCell, pagination } from '../lib/validation.js'
import { logAudit } from '../lib/workspaceHelpers.js'

/** Register organisation-scoped dashboard summary, analytics, CSV export, history, and audit log routes. */
export function registerReportRoutes(router, db) {
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
        terminatedCount: attempts.filter((a) => a.status === 'terminated_focus_lost').length,
        expiredCount: attempts.filter((a) => a.status === 'expired').length,
        averagePercent: percentCount > 0 ? Math.round(percentSum / percentCount) : 0,
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
}

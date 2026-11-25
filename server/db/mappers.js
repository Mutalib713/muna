function parseJson(value, fallback) {
  if (!value) return fallback
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

export function initialsFor(name) {
  return String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'MU'
}

export function questionFromRow(row) {
  const config = parseJson(row.config_json, {})
  return {
    id: row.id,
    organisationId: row.organisation_id || 'ORG-DEFAULT',
    type: row.type || 'mcq',
    prompt: row.prompt,
    options: parseJson(row.options_json, []),
    correctAnswer: row.correct_answer,
    correctAnswers: Array.isArray(config.correctAnswers) ? config.correctAnswers : [],
    partialCredit: Boolean(config.partialCredit),
    acceptedAnswers: Array.isArray(config.acceptedAnswers) ? config.acceptedAnswers : [],
    instructions: typeof config.instructions === 'string' ? config.instructions : '',
    points: Number(row.points ?? 1),
    difficulty: row.difficulty || 'Medium',
    tags: parseJson(row.tags_json, []),
    rubric: parseJson(row.rubric_json, []),
    status: row.status,
    createdAt: row.created_at,
  }
}

export function answerFromRow(row) {
  return {
    id: row.id,
    organisationId: row.organisation_id || 'ORG-DEFAULT',
    attemptId: row.attempt_id || null,
    student: row.student,
    initials: row.initials,
    question: row.assessment,
    answer: row.answer,
    score: row.score,
    earnedPoints: row.earned_points ?? null,
    maxPoints: row.max_points ?? null,
    items: parseJson(row.items_json, []),
    submitted: row.submitted_at,
    status: row.status,
    reviewDecision: row.review_decision,
    feedback: row.feedback,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
  }
}

export function flagFromRow(row) {
  return {
    id: row.id,
    organisationId: row.organisation_id || 'ORG-DEFAULT',
    attemptId: row.attempt_id || null,
    student: row.student,
    initials: row.initials,
    assessment: row.assessment,
    signal: row.signal,
    detail: row.detail,
    level: row.level,
    reviewNote: row.review_note,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at || null,
  }
}

export function securityEventFromRow(row) {
  return {
    id: row.id,
    attemptId: row.attempt_id,
    assessmentId: row.assessment_id,
    menteeId: row.mentee_id,
    eventType: row.event_type,
    detail: row.detail,
    clientTimestamp: row.client_timestamp || null,
    serverTimestamp: row.server_timestamp,
  }
}

export function auditLogFromRow(row) {
  return {
    id: row.id,
    actor: row.actor,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    detail: parseJson(row.detail_json, {}),
    createdAt: row.created_at,
  }
}

export function menteeFromRow(row) {
  return {
    id: row.id,
    organisationId: row.organisation_id || 'ORG-DEFAULT',
    name: row.name,
    email: row.email,
  }
}

export function slugifyOrgName(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'workspace'
}

export function uniqueSlugForOrg(db, name) {
  const base = slugifyOrgName(name)
  let candidate = base
  let suffix = 2
  while (db.prepare('SELECT 1 FROM organisations WHERE slug = ?').get(candidate)) {
    candidate = `${base}-${suffix}`
    suffix++
  }
  return candidate
}

export function assessmentFromRow(db, row) {
  const grants = db.prepare(`
    SELECT id, mentee_id AS menteeId, extra_attempts AS extraAttempts, reason, granted_by AS grantedBy, created_at AS createdAt
    FROM extra_attempt_grants
    WHERE assessment_id = ?
    ORDER BY created_at DESC
  `).all(row.id)
  return {
    id: row.id,
    organisationId: row.organisation_id || 'ORG-DEFAULT',
    title: row.title,
    description: row.description,
    maxAttempts: row.max_attempts,
    timeLimitMinutes: row.time_limit_minutes ?? null,
    availableFrom: row.available_from || null,
    availableUntil: row.available_until || null,
    shuffleQuestions: Boolean(row.shuffle_questions),
    shuffleOptions: Boolean(row.shuffle_options),
    navigationMode: row.navigation_mode || 'free',
    feedbackPolicy: row.feedback_policy || 'immediate',
    resultsReleased: Boolean(row.results_released),
    securityMode: row.security_mode || 'standard',
    requireFullscreen: Boolean(row.require_fullscreen),
    sebConfigReady: Boolean(row.seb_config_key),
    hasSebBrowserExamKey: Boolean(row.seb_browser_exam_key),
    sebBrowserExamKey: row.seb_browser_exam_key || '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    questionIds: db.prepare(`
      SELECT question_id FROM assessment_questions
      WHERE assessment_id = ? ORDER BY position
    `).all(row.id).map((question) => question.question_id),
    menteeIds: db.prepare(`
      SELECT mentee_id FROM assessment_assignments
      WHERE assessment_id = ? ORDER BY assigned_at, mentee_id
    `).all(row.id).map((assignment) => assignment.mentee_id),
    extraAttemptGrants: grants,
  }
}

export function memberFromRow(row) {
  return {
    id: row.id,
    userId: row.user_id,
    organisationId: row.organisation_id,
    name: row.name,
    initials: initialsFor(row.name),
    email: row.email,
    role: row.role,
    status: row.status,
    joined: row.joined_at,
    joinedAt: row.joined_at,
  }
}

export function getInvitationState(row) {
  if (row.revoked) return 'Revoked'
  if (new Date(row.expires_at ?? row.expires).getTime() <= Date.now()) return 'Expired'
  if (row.uses >= row.max_uses) return 'Exhausted'
  return 'Active'
}

export function invitationFromRow(row) {
  return {
    id: row.id,
    organisationId: row.organisation_id,
    type: row.type,
    email: row.email,
    role: row.role,
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    maxUses: row.max_uses,
    uses: row.uses,
    revoked: Boolean(row.revoked),
    state: getInvitationState(row),
  }
}

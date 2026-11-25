import { randomBytes, randomUUID } from 'node:crypto'
import { getInvitationState, questionFromRow } from '../db.js'
import { normalizeQuestionInput } from '../question-utils.js'
import { hashInvitationToken } from './validation.js'

export function logAudit(db, { organisationId = 'ORG-DEFAULT', actor, action, entityType, entityId, detail = {} }) {
  const id = `AUD-${randomUUID().slice(0, 8).toUpperCase()}`
  const createdAt = new Date().toISOString()
  db.prepare(`
    INSERT INTO audit_logs (id, organisation_id, actor, action, entity_type, entity_id, detail_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, organisationId, actor, action, entityType, entityId, JSON.stringify(detail), createdAt)
}

export function addQuestion(db, input, organisationId = 'ORG-DEFAULT') {
  const id = `Q-${randomUUID().slice(0, 8).toUpperCase()}`
  const createdAt = new Date().toISOString()
  const normalized = normalizeQuestionInput(input)
  db.prepare(`
    INSERT INTO questions (
      id, organisation_id, type, prompt, options_json, correct_answer,
      points, difficulty, tags_json, config_json, rubric_json,
      status, created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Published', ?)
  `).run(
    id,
    organisationId,
    normalized.type,
    normalized.prompt,
    JSON.stringify(normalized.options),
    normalized.correctAnswer,
    normalized.points,
    normalized.difficulty,
    JSON.stringify(normalized.tags),
    JSON.stringify(normalized.config),
    JSON.stringify(normalized.rubric),
    createdAt,
  )
  return questionFromRow(db.prepare('SELECT * FROM questions WHERE id = ?').get(id))
}

export function getReviewHistory(db, entityType, entityId) {
  return db.prepare(`
    SELECT actor, decision, note, created_at AS createdAt
    FROM review_history
    WHERE entity_type = ? AND entity_id = ?
    ORDER BY id DESC
  `).all(entityType, entityId)
}

export function getUserOrganisations(db, userId, userEmail) {
  const rows = db.prepare(`
    SELECT o.id, o.slug, o.name, m.role, m.status, m.joined_at AS joinedAt
    FROM memberships m
    JOIN organisations o ON o.id = m.organisation_id
    WHERE m.user_id = ? AND m.status = 'Active'
    ORDER BY CASE m.role WHEN 'Owner' THEN 0 WHEN 'Admin' THEN 1 WHEN 'Mentor' THEN 2 ELSE 3 END, m.joined_at ASC
  `).all(userId)
  return rows.map((row) => {
    const mentee = userEmail
      ? db.prepare('SELECT id FROM mentees WHERE organisation_id = ? AND lower(email) = ?').get(row.id, userEmail.toLowerCase())
      : null
    return {
      ...row,
      menteeId: mentee?.id || null,
    }
  })
}

export function createVerificationTokenForUser(db, userId) {
  const token = randomBytes(24).toString('base64url')
  const tokenHash = hashInvitationToken(token)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
  db.prepare('DELETE FROM email_verification_tokens WHERE user_id = ?').run(userId)
  db.prepare(`
    INSERT INTO email_verification_tokens (token_hash, user_id, expires_at, created_at)
    VALUES (?, ?, ?, ?)
  `).run(tokenHash, userId, expiresAt, now.toISOString())
  return token
}

export function findInvitationByToken(db, rawToken) {
  const token = typeof rawToken === 'string' ? rawToken.trim() : ''
  if (!token || token.length > 200) return null
  const tokenHash = hashInvitationToken(token)
  return db.prepare(`
    SELECT i.*, o.name AS organisation_name, o.slug AS organisation_slug
    FROM invitations i
    JOIN organisations o ON o.id = i.organisation_id
    WHERE i.token_hash = ?
  `).get(tokenHash)
}

export function rejectUnusableInvitation(res, invitationRow) {
  if (!invitationRow) {
    res.status(404).json({ error: 'Invitation not found or invalid.', state: 'Invalid' })
    return true
  }
  const state = getInvitationState(invitationRow)
  if (state === 'Revoked') {
    res.status(410).json({ error: 'This invitation has been revoked.', state })
    return true
  }
  if (state === 'Expired') {
    res.status(410).json({ error: 'This invitation has expired.', state })
    return true
  }
  if (state === 'Exhausted') {
    res.status(410).json({ error: 'This invitation has reached its maximum number of uses.', state })
    return true
  }
  return false
}

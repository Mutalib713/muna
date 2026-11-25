import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { SEB_KEY_REGEX } from './seb.js'

export const NAVIGATION_MODES = ['free', 'sequential']
export const FEEDBACK_POLICIES = ['immediate', 'after_deadline', 'manual']
export const SECURITY_MODES = ['standard', 'strict_web', 'seb']
export const SECURITY_EVENT_TYPES = [
  'fullscreen_entered',
  'fullscreen_exited',
  'visibility_hidden',
  'visibility_visible',
  'window_blur',
  'window_focus',
]
export const INVITABLE_ROLES = ['Admin', 'Mentor', 'Mentee']
export const MEMBER_STATUSES = ['Active', 'Suspended']

export function parseOptionalIsoDate(value) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') return false
  const ms = Date.parse(value)
  if (!Number.isFinite(ms)) return false
  return new Date(ms).toISOString()
}

export function validateAssessment(input) {
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
  if (input.timeLimitMinutes !== undefined && input.timeLimitMinutes !== null && input.timeLimitMinutes !== '') {
    const minutes = Number(input.timeLimitMinutes)
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 300) {
      return 'Time limit must be between 1 and 300 minutes.'
    }
  }
  const availableFrom = parseOptionalIsoDate(input.availableFrom)
  const availableUntil = parseOptionalIsoDate(input.availableUntil)
  if (availableFrom === false || availableUntil === false) {
    return 'Availability dates must be valid timestamps.'
  }
  if (availableFrom && availableUntil && Date.parse(availableUntil) <= Date.parse(availableFrom)) {
    return 'Availability end date must be after the start date.'
  }
  const navigationMode = input.navigationMode ?? 'free'
  if (!NAVIGATION_MODES.includes(navigationMode)) {
    return 'Navigation mode must be free or sequential.'
  }
  const feedbackPolicy = input.feedbackPolicy ?? 'immediate'
  if (!FEEDBACK_POLICIES.includes(feedbackPolicy)) {
    return 'Feedback policy must be immediate, after_deadline, or manual.'
  }
  if (feedbackPolicy === 'after_deadline' && !availableUntil) {
    return 'Set an availability end date to release feedback after the deadline.'
  }
  const securityMode = input.securityMode ?? 'standard'
  if (!SECURITY_MODES.includes(securityMode)) {
    return 'Security mode must be standard, strict_web, or seb.'
  }
  if (input.sebBrowserExamKey !== undefined && input.sebBrowserExamKey !== null && input.sebBrowserExamKey !== '') {
    if (typeof input.sebBrowserExamKey !== 'string' || !SEB_KEY_REGEX.test(input.sebBrowserExamKey.trim())) {
      return 'Browser Exam Key must be a 64-character SHA-256 hex string.'
    }
  }
  return null
}

export function normalizeAssessmentSettings(input) {
  const timeLimitMinutes =
    input.timeLimitMinutes === undefined || input.timeLimitMinutes === null || input.timeLimitMinutes === ''
      ? null
      : Number(input.timeLimitMinutes)
  const securityMode = input.securityMode ?? 'standard'
  const sebBrowserExamKey =
    securityMode === 'seb' && typeof input.sebBrowserExamKey === 'string' && input.sebBrowserExamKey.trim()
      ? input.sebBrowserExamKey.trim().toLowerCase()
      : null
  return {
    title: input.title.trim(),
    description: (input.description || '').trim(),
    maxAttempts: input.maxAttempts ?? 3,
    timeLimitMinutes,
    availableFrom: parseOptionalIsoDate(input.availableFrom),
    availableUntil: parseOptionalIsoDate(input.availableUntil),
    shuffleQuestions: input.shuffleQuestions ? 1 : 0,
    shuffleOptions: input.shuffleOptions ? 1 : 0,
    navigationMode: input.navigationMode ?? 'free',
    feedbackPolicy: input.feedbackPolicy ?? 'immediate',
    securityMode,
    requireFullscreen: input.requireFullscreen ? 1 : 0,
    sebBrowserExamKey,
  }
}

export function hashInvitationToken(token) {
  return createHash('sha256').update(String(token || '').trim()).digest('hex')
}

export function isValidEmail(email) {
  return typeof email === 'string' && email.length > 0 && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

export function maskEmail(email) {
  if (!email) return null
  const [local, domain] = email.split('@')
  if (!local || !domain) return null
  return `${local[0]}${'*'.repeat(Math.min(4, Math.max(1, local.length - 1)))}@${domain}`
}

export function escapeCsvCell(value) {
  const raw = value === null || value === undefined ? '' : String(value)
  const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`
  }
  return safe
}

export function validateInvitationCreate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Invitation details are required.'
  const type = input.type
  if (type !== 'code' && type !== 'email') return 'Invitation type must be code or email.'
  const role = input.role
  if (!INVITABLE_ROLES.includes(role)) return 'Role must be Admin, Mentor, or Mentee.'
  const days = Number(input.days ?? 7)
  if (!Number.isInteger(days) || days < 1 || days > 90) return 'Expiry must be between 1 and 90 days.'
  if (type === 'email') {
    const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
    if (!isValidEmail(email)) return 'A valid recipient email address is required.'
  } else {
    const maxUses = Number(input.maxUses ?? 10)
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 100) {
      return 'Maximum uses must be a whole number between 1 and 100.'
    }
  }
  return null
}

export function validateInviteAccept(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Account details are required.'
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  const password = typeof input.password === 'string' ? input.password : ''
  if (!name || name.length > 120) return 'Full name must contain 1 to 120 characters.'
  if (!isValidEmail(email)) return 'A valid email address is required.'
  if (password.length < 8) return 'Password must be at least 8 characters long.'
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Password must be no more than 72 UTF-8 bytes.'
  return null
}

export function validateMentee(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Mentee details are required.'
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : ''
  if (!name || name.length > 120) return 'Mentee name must contain 1 to 120 characters.'
  if (!email || email.length > 254 || !email.includes('@')) return 'A valid mentee email is required.'
  return null
}

export function pagination(req, defaultLimit = 25) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1)
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || defaultLimit))
  return { page, limit, offset: (page - 1) * limit }
}

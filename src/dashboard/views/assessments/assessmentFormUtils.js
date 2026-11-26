export const STATUS_CLASS = {
  Draft: 'assessment-status-draft',
  Published: 'assessment-status-published',
  Paused: 'assessment-status-paused',
}

export const FEEDBACK_LABELS = {
  immediate: 'Immediate feedback',
  after_deadline: 'Feedback after deadline',
  manual: 'Manual feedback release',
}

export const SECURITY_LABELS = {
  standard: 'Standard web mode',
  strict_web: 'Strict web mode',
  seb: 'Safe Exam Browser (SEB)',
}

/** Return up to two uppercase initials for a mentee display name. */
export function initialsFor(name) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function toDatetimeLocal(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDatetimeLocal(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** Build an empty assessment builder form state. */
export function newAssessmentForm() {
  return {
    title: '',
    description: '',
    questionIds: [],
    menteeIds: [],
    maxAttempts: '3',
    timeLimitMinutes: '',
    availableFrom: '',
    availableUntil: '',
    shuffleQuestions: false,
    shuffleOptions: false,
    navigationMode: 'free',
    feedbackPolicy: 'immediate',
    securityMode: 'standard',
    requireFullscreen: false,
    sebBrowserExamKey: '',
  }
}

/** Populate the builder form state from an existing assessment draft. */
export function assessmentToForm(assessment) {
  return {
    title: assessment.title,
    description: assessment.description,
    questionIds: [...assessment.questionIds],
    menteeIds: [...assessment.menteeIds],
    maxAttempts: String(assessment.maxAttempts),
    timeLimitMinutes: assessment.timeLimitMinutes ? String(assessment.timeLimitMinutes) : '',
    availableFrom: toDatetimeLocal(assessment.availableFrom),
    availableUntil: toDatetimeLocal(assessment.availableUntil),
    shuffleQuestions: Boolean(assessment.shuffleQuestions),
    shuffleOptions: Boolean(assessment.shuffleOptions),
    navigationMode: assessment.navigationMode || 'free',
    feedbackPolicy: assessment.feedbackPolicy || 'immediate',
    securityMode: assessment.securityMode || 'standard',
    requireFullscreen: Boolean(assessment.requireFullscreen),
    sebBrowserExamKey: assessment.sebBrowserExamKey || '',
  }
}

/** Convert assessment builder form state into the API request payload. */
export function formToPayload(form) {
  return {
    title: form.title.trim(),
    description: form.description.trim(),
    questionIds: [...form.questionIds],
    menteeIds: [...form.menteeIds],
    maxAttempts: Number(form.maxAttempts),
    timeLimitMinutes: form.timeLimitMinutes === '' ? null : Number(form.timeLimitMinutes),
    availableFrom: fromDatetimeLocal(form.availableFrom),
    availableUntil: fromDatetimeLocal(form.availableUntil),
    shuffleQuestions: Boolean(form.shuffleQuestions),
    shuffleOptions: Boolean(form.shuffleOptions),
    navigationMode: form.navigationMode,
    feedbackPolicy: form.feedbackPolicy,
    securityMode: form.securityMode,
    requireFullscreen: Boolean(form.requireFullscreen),
    sebBrowserExamKey: form.securityMode === 'seb' ? form.sebBrowserExamKey.trim() : '',
  }
}

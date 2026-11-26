export const FEEDBACK_POLICY_COPY = {
  immediate: 'Scores are shown immediately after submission.',
  after_deadline: 'Scores are released after the availability deadline.',
  manual: 'Scores are held until your mentor releases results.',
}

export function isQuestionAnswered(question, value) {
  const type = question.type || 'mcq'
  if (type === 'multi_select') return Array.isArray(value) && value.length > 0
  if (type === 'drawing') {
    return (Array.isArray(value?.strokes) && value.strokes.length > 0) ||
      (typeof value?.altText === 'string' && value.altText.trim().length > 0)
  }
  return typeof value === 'string' && value.trim().length > 0
}

export function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

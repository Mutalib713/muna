export const QUESTION_TYPES = [
  'mcq',
  'multi_select',
  'true_false',
  'short_answer',
  'theory',
  'drawing',
]

export const DIFFICULTIES = ['Easy', 'Medium', 'Hard']

export function formatPoints(value) {
  const num = Number(value) || 0
  return Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100)
}

function normalizeRubric(rubric) {
  if (rubric === undefined || rubric === null) return []
  if (!Array.isArray(rubric)) return null
  if (rubric.length > 20) return null
  const normalized = []
  for (const item of rubric) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const criterion = typeof item.criterion === 'string' ? item.criterion.trim() : ''
    const description = typeof item.description === 'string' ? item.description.trim() : ''
    const points = Number(item.points ?? 1)
    if (!criterion || criterion.length > 120) return null
    if (description.length > 500) return null
    if (!Number.isFinite(points) || points < 0 || points > 1000) return null
    normalized.push({
      criterion,
      points: Math.round(points * 100) / 100,
      description,
    })
  }
  return normalized
}

function normalizeTags(tags) {
  if (tags === undefined || tags === null) return []
  if (!Array.isArray(tags) || tags.length > 10) return null
  const cleaned = []
  for (const tag of tags) {
    if (typeof tag !== 'string') return null
    const trimmed = tag.trim()
    if (!trimmed || trimmed.length > 40) return null
    if (!cleaned.includes(trimmed)) cleaned.push(trimmed)
  }
  return cleaned
}

export function validateQuestion(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return 'Each question must be an object.'
  }
  const type = input.type ?? 'mcq'
  if (!QUESTION_TYPES.includes(type)) {
    return `Question type must be one of: ${QUESTION_TYPES.join(', ')}.`
  }
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  if (!prompt || prompt.length > 5000) {
    return 'Question text must be between 1 and 5000 characters.'
  }
  const points = Number(input.points ?? 1)
  if (!Number.isFinite(points) || points <= 0 || points > 1000) {
    return 'Question points must be greater than 0 and at most 1000.'
  }
  const difficulty = input.difficulty ?? 'Medium'
  if (!DIFFICULTIES.includes(difficulty)) {
    return 'Difficulty must be Easy, Medium, or Hard.'
  }
  if (input.instructions !== undefined && (typeof input.instructions !== 'string' || input.instructions.length > 1000)) {
    return 'Instructions must be 1000 characters or fewer.'
  }
  if (normalizeTags(input.tags) === null) {
    return 'Tags must be up to 10 short labels (1–40 characters each).'
  }
  if (normalizeRubric(input.rubric) === null) {
    return 'Rubric must contain valid criteria with non-negative points.'
  }

  if (type === 'mcq') {
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 8) {
      return 'Each question must have between 2 and 8 answer options.'
    }
    const options = input.options.map((option) => (typeof option === 'string' ? option.trim() : option))
    if (options.some((option) => typeof option !== 'string' || !option || option.length > 1000)) {
      return 'Answer options must contain between 1 and 1000 characters.'
    }
    if (new Set(options).size !== options.length) {
      return 'Answer options must be unique.'
    }
    if (typeof input.correctAnswer !== 'string' || !options.includes(input.correctAnswer.trim())) {
      return 'The correct answer must match one of the question options.'
    }
  } else if (type === 'multi_select') {
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 8) {
      return 'Multiple-select questions must have between 2 and 8 answer options.'
    }
    const options = input.options.map((option) => (typeof option === 'string' ? option.trim() : option))
    if (options.some((option) => typeof option !== 'string' || !option || option.length > 1000)) {
      return 'Answer options must contain between 1 and 1000 characters.'
    }
    if (new Set(options).size !== options.length) {
      return 'Answer options must be unique.'
    }
    if (!Array.isArray(input.correctAnswers) || input.correctAnswers.length === 0) {
      return 'Choose at least one correct answer for a multiple-select question.'
    }
    const correctAnswers = input.correctAnswers.map((ans) => (typeof ans === 'string' ? ans.trim() : ans))
    if (correctAnswers.some((ans) => typeof ans !== 'string' || !options.includes(ans))) {
      return 'All correct answers must match the question options.'
    }
  } else if (type === 'true_false') {
    const answer = typeof input.correctAnswer === 'string' ? input.correctAnswer.trim() : ''
    if (answer !== 'True' && answer !== 'False') {
      return 'True/False questions must have True or False as the correct answer.'
    }
  } else if (type === 'short_answer') {
    if (input.acceptedAnswers !== undefined) {
      if (!Array.isArray(input.acceptedAnswers) || input.acceptedAnswers.length > 20) {
        return 'Accepted answers must be a list of up to 20 items.'
      }
      if (input.acceptedAnswers.some((ans) => typeof ans !== 'string' || !ans.trim() || ans.trim().length > 200)) {
        return 'Each accepted answer must contain 1 to 200 characters.'
      }
    }
  }

  return null
}

export function normalizeQuestionInput(input) {
  const type = input.type ?? 'mcq'
  const prompt = input.prompt.trim()
  const points = Math.round(Number(input.points ?? 1) * 100) / 100
  const difficulty = input.difficulty ?? 'Medium'
  const tags = normalizeTags(input.tags) || []
  const rubric = normalizeRubric(input.rubric) || []
  const instructions = typeof input.instructions === 'string' ? input.instructions.trim() : ''

  let options = []
  let correctAnswer = ''
  const config = { instructions }

  if (type === 'mcq') {
    options = input.options.map((o) => o.trim())
    correctAnswer = input.correctAnswer.trim()
  } else if (type === 'multi_select') {
    options = input.options.map((o) => o.trim())
    const uniqueCorrect = [...new Set(input.correctAnswers.map((a) => a.trim()))]
    config.correctAnswers = uniqueCorrect
    config.partialCredit = Boolean(input.partialCredit)
    correctAnswer = uniqueCorrect.join(', ')
  } else if (type === 'true_false') {
    options = ['True', 'False']
    correctAnswer = input.correctAnswer.trim()
  } else if (type === 'short_answer') {
    const accepted = Array.isArray(input.acceptedAnswers)
      ? [...new Set(input.acceptedAnswers.map((a) => a.trim()).filter(Boolean))]
      : []
    config.acceptedAnswers = accepted
    correctAnswer = accepted[0] || ''
  }

  return {
    type,
    prompt,
    options,
    correctAnswer,
    points,
    difficulty,
    tags,
    config,
    rubric,
  }
}

export function sanitizeQuestionForLearner(question) {
  return {
    id: question.id,
    type: question.type,
    prompt: question.prompt,
    options: question.options,
    points: question.points,
    difficulty: question.difficulty,
    tags: question.tags,
    instructions: question.instructions,
    partialCredit: question.partialCredit,
    rubric: question.rubric,
    autoGradable:
      question.type === 'mcq' ||
      question.type === 'multi_select' ||
      question.type === 'true_false' ||
      (question.type === 'short_answer' && (question.acceptedAnswers?.length ?? 0) > 0),
  }
}

function validateDrawingPayload(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const strokesRaw = Array.isArray(raw.strokes) ? raw.strokes : []
  const altText = typeof raw.altText === 'string' ? raw.altText.trim().slice(0, 2000) : ''
  if (strokesRaw.length === 0 && !altText) return null
  if (strokesRaw.length > 500) return null

  const strokes = []
  for (const stroke of strokesRaw) {
    if (!stroke || typeof stroke !== 'object' || Array.isArray(stroke)) return null
    if (!Array.isArray(stroke.points) || stroke.points.length === 0 || stroke.points.length > 1000) return null
    const points = []
    for (const pt of stroke.points) {
      if (!pt || typeof pt !== 'object') return null
      const x = Number(pt.x)
      const y = Number(pt.y)
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) return null
      points.push({ x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 })
    }
    const width = Number(stroke.width ?? 2)
    strokes.push({
      color: typeof stroke.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(stroke.color) ? stroke.color : '#0F5C8C',
      width: Number.isFinite(width) && width >= 1 && width <= 24 ? width : 2,
      erase: Boolean(stroke.erase),
      points,
    })
  }
  return { strokes, altText }
}

export function gradeQuestionResponse(question, rawResponse) {
  const maxPoints = Number(question.points ?? 1)
  const base = {
    questionId: question.id,
    type: question.type,
    prompt: question.prompt,
    maxPoints,
    rubric: question.rubric || [],
  }

  if (question.type === 'mcq' || question.type === 'true_false') {
    const answer = typeof rawResponse === 'string' ? rawResponse.trim() : ''
    if (!answer) return { error: 'Answer every question before submitting.' }
    const isCorrect = answer === question.correctAnswer
    return {
      ...base,
      response: answer,
      summaryText: answer,
      earnedPoints: isCorrect ? maxPoints : 0,
      autoGraded: true,
      needsReview: false,
    }
  }

  if (question.type === 'multi_select') {
    if (!Array.isArray(rawResponse) || rawResponse.length === 0) {
      return { error: 'Answer every question before submitting.' }
    }
    const selected = [...new Set(rawResponse.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean))]
    if (selected.length === 0 || selected.some((item) => !question.options.includes(item))) {
      return { error: 'Select valid options for each multiple-select question.' }
    }
    const correctSet = new Set(question.correctAnswers || [])
    const hits = selected.filter((item) => correctSet.has(item)).length
    const misses = selected.filter((item) => !correctSet.has(item)).length
    let earnedPoints = 0
    if (question.partialCredit) {
      const ratio = correctSet.size > 0 ? Math.max(0, (hits - misses) / correctSet.size) : 0
      earnedPoints = Math.round(ratio * maxPoints * 100) / 100
    } else if (hits === correctSet.size && misses === 0) {
      earnedPoints = maxPoints
    }
    return {
      ...base,
      response: selected,
      summaryText: selected.join(', '),
      earnedPoints,
      autoGraded: true,
      needsReview: false,
    }
  }

  if (question.type === 'short_answer') {
    const answer = typeof rawResponse === 'string' ? rawResponse.trim() : ''
    if (!answer) return { error: 'Answer every question before submitting.' }
    if (answer.length > 1000) return { error: 'Short answers must be 1000 characters or fewer.' }
    const accepted = (question.acceptedAnswers || []).map((a) => a.toLowerCase())
    if (accepted.length > 0) {
      const isCorrect = accepted.includes(answer.toLowerCase())
      return {
        ...base,
        response: answer,
        summaryText: answer,
        earnedPoints: isCorrect ? maxPoints : 0,
        autoGraded: true,
        needsReview: false,
      }
    }
    return {
      ...base,
      response: answer,
      summaryText: answer,
      earnedPoints: 0,
      autoGraded: false,
      needsReview: true,
    }
  }

  if (question.type === 'theory') {
    const answer = typeof rawResponse === 'string' ? rawResponse.trim() : ''
    if (!answer) return { error: 'Answer every question before submitting.' }
    if (answer.length > 20000) return { error: 'Theory responses must be 20,000 characters or fewer.' }
    return {
      ...base,
      response: answer,
      summaryText: answer,
      earnedPoints: 0,
      autoGraded: false,
      needsReview: true,
    }
  }

  if (question.type === 'drawing') {
    const drawing = validateDrawingPayload(rawResponse)
    if (!drawing) {
      return { error: 'Draw on the canvas or provide a text description for drawing questions.' }
    }
    const parts = [`[Drawing: ${drawing.strokes.length} stroke${drawing.strokes.length === 1 ? '' : 's'}]`]
    if (drawing.altText) parts.push(drawing.altText)
    return {
      ...base,
      response: drawing,
      summaryText: parts.join(' — '),
      earnedPoints: 0,
      autoGraded: false,
      needsReview: true,
    }
  }

  return { error: 'Unsupported question type.' }
}

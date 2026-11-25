export const QUESTION_TYPE_LABELS = {
  mcq: 'Multiple choice',
  multi_select: 'Multiple select',
  true_false: 'True / False',
  short_answer: 'Short answer',
  theory: 'Theory',
  drawing: 'Drawing',
}

export const QUESTION_TYPE_OPTIONS = Object.entries(QUESTION_TYPE_LABELS).map(([value, label]) => ({
  value,
  label,
}))

export function newQuestionDraft(type = 'mcq') {
  return {
    type,
    prompt: '',
    options: type === 'true_false' ? ['True', 'False'] : ['', '', '', ''],
    correctAnswer: '',
    correctAnswers: [],
    partialCredit: true,
    acceptedAnswersText: '',
    instructions: '',
    points: '1',
    difficulty: 'Medium',
    tagsText: '',
    rubric: [],
  }
}

export function questionToDraft(question) {
  const type = question.type || 'mcq'
  return {
    type,
    prompt: question.prompt || '',
    options: type === 'true_false'
      ? ['True', 'False']
      : (question.options?.length ? [...question.options] : ['', '', '', '']),
    correctAnswer: question.correctAnswer || '',
    correctAnswers: Array.isArray(question.correctAnswers) ? [...question.correctAnswers] : [],
    partialCredit: Boolean(question.partialCredit),
    acceptedAnswersText: Array.isArray(question.acceptedAnswers) ? question.acceptedAnswers.join(', ') : '',
    instructions: question.instructions || '',
    points: String(question.points ?? 1),
    difficulty: question.difficulty || 'Medium',
    tagsText: Array.isArray(question.tags) ? question.tags.join(', ') : '',
    rubric: Array.isArray(question.rubric) ? question.rubric.map((item) => ({ ...item })) : [],
  }
}

export function draftToPayload(draft) {
  const type = draft.type || 'mcq'
  const tags = (draft.tagsText || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean)
  const payload = {
    type,
    prompt: draft.prompt.trim(),
    points: Number(draft.points) || 1,
    difficulty: draft.difficulty || 'Medium',
    instructions: (draft.instructions || '').trim(),
    tags,
    rubric: (draft.rubric || [])
      .filter((item) => item.criterion.trim())
      .map((item) => ({
        criterion: item.criterion.trim(),
        points: Number(item.points) || 0,
        description: (item.description || '').trim(),
      })),
  }

  if (type === 'mcq') {
    payload.options = draft.options.map((opt) => opt.trim())
    payload.correctAnswer = draft.correctAnswer.trim()
  } else if (type === 'multi_select') {
    payload.options = draft.options.map((opt) => opt.trim())
    payload.correctAnswers = [...draft.correctAnswers]
    payload.partialCredit = Boolean(draft.partialCredit)
  } else if (type === 'true_false') {
    payload.options = ['True', 'False']
    payload.correctAnswer = draft.correctAnswer
  } else if (type === 'short_answer') {
    payload.acceptedAnswers = (draft.acceptedAnswersText || '')
      .split(/[\n,]/)
      .map((ans) => ans.trim())
      .filter(Boolean)
  }

  return payload
}

export function summarizeAnswerKey(question) {
  const type = question.type || 'mcq'
  if (type === 'mcq' || type === 'true_false') return question.correctAnswer
  if (type === 'multi_select') {
    const list = question.correctAnswers?.length ? question.correctAnswers.join(', ') : question.correctAnswer
    return question.partialCredit ? `${list} (partial credit)` : list
  }
  if (type === 'short_answer') {
    return question.acceptedAnswers?.length
      ? `Auto: ${question.acceptedAnswers.join(' | ')}`
      : 'Manual grading'
  }
  if (type === 'theory' || type === 'drawing') {
    return question.rubric?.length
      ? `Rubric (${question.rubric.length} ${question.rubric.length === 1 ? 'criterion' : 'criteria'})`
      : 'Manual grading'
  }
  return question.correctAnswer || '—'
}

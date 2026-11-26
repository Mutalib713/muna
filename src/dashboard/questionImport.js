export function parseQuestionFile(text) {
  const parsed = JSON.parse(text)
  const items = Array.isArray(parsed) ? parsed : parsed.questions
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('The JSON file must contain a non-empty array of questions.')
  }

  return items.map((item, index) => {
    const prompt = item.question || item.prompt
    if (typeof prompt !== 'string' || !prompt.trim()) {
      throw new Error(`Question ${index + 1} needs a question or prompt field.`)
    }
    const type = item.type || 'mcq'
    if (type === 'mcq' || type === 'multi_select') {
      if (!Array.isArray(item.options) || item.options.length < 2 || item.options.some((option) => typeof option !== 'string' || !option.trim())) {
        throw new Error(`Question ${index + 1} needs at least two non-empty options.`)
      }
    }
    if (type === 'mcq' && (typeof item.correctAnswer !== 'string' || !item.correctAnswer.trim())) {
      throw new Error(`Question ${index + 1} needs a correctAnswer field.`)
    }
    return {
      ...item,
      type,
      prompt: prompt.trim(),
    }
  })
}

export function downloadQuestionTemplate() {
  const template = [
    { type: 'mcq', prompt: 'What is 2 + 2?', options: ['3', '4', '5', '6'], correctAnswer: '4', points: 2, difficulty: 'Easy' },
    { type: 'multi_select', prompt: 'Select the prime numbers.', options: ['2', '3', '4', '5'], correctAnswers: ['2', '3', '5'], partialCredit: true, points: 3 },
    { type: 'true_false', prompt: 'HTTP is stateless.', correctAnswer: 'True', points: 1 },
    { type: 'short_answer', prompt: 'Which browser kiosk app integrates with Muna?', acceptedAnswers: ['Safe Exam Browser', 'SEB'], points: 2 },
    { type: 'theory', prompt: 'Explain why grading must run server-side.', points: 10, rubric: [{ criterion: 'Security boundary', points: 5, description: 'Explains client code inspection.' }, { criterion: 'Server authority', points: 5, description: 'Explains authoritative grading.' }] },
    { type: 'drawing', prompt: 'Sketch the attempt lifecycle.', points: 5, rubric: [{ criterion: 'States', points: 5, description: 'Shows Active, Submitted, Terminated.' }] },
  ]
  const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'muna-questions-template.json'
  link.click()
  URL.revokeObjectURL(url)
}

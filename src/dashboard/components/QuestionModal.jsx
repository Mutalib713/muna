import Icon from '../DashboardIcon'
import { QUESTION_TYPE_OPTIONS } from '../questionTypes'

export default function QuestionModal({ question, editing = false, onQuestionChange, error, onClose, onSubmit }) {
  const type = question.type || 'mcq'

  const handleTypeChange = (nextType) => {
    const next = { ...question, type: nextType }
    if (nextType === 'true_false') {
      next.options = ['True', 'False']
      next.correctAnswer = next.correctAnswer === 'False' ? 'False' : 'True'
    } else if ((nextType === 'mcq' || nextType === 'multi_select') && question.options.length < 2) {
      next.options = ['', '', '', '']
    }
    onQuestionChange(next)
  }

  const changeOption = (index, value) => {
    const previousValue = question.options[index]
    const options = question.options.map((option, optionIndex) => (optionIndex === index ? value : option))
    const correctAnswer = question.correctAnswer === previousValue ? value : question.correctAnswer
    const correctAnswers = (question.correctAnswers || []).map((ans) => (ans === previousValue ? value : ans))
    onQuestionChange({ ...question, options, correctAnswer, correctAnswers })
  }

  const addOption = () => {
    if (question.options.length >= 8) return
    onQuestionChange({ ...question, options: [...question.options, ''] })
  }

  const removeOption = (index) => {
    if (question.options.length <= 2) return
    const removed = question.options[index]
    const options = question.options.filter((_, i) => i !== index)
    onQuestionChange({
      ...question,
      options,
      correctAnswer: question.correctAnswer === removed ? '' : question.correctAnswer,
      correctAnswers: (question.correctAnswers || []).filter((ans) => ans !== removed),
    })
  }

  const toggleMultiCorrect = (optionValue) => {
    const trimmed = optionValue.trim()
    if (!trimmed) return
    const current = question.correctAnswers || []
    const next = current.includes(trimmed)
      ? current.filter((item) => item !== trimmed)
      : [...current, trimmed]
    onQuestionChange({ ...question, correctAnswers: next })
  }

  const addRubricRow = () => {
    onQuestionChange({
      ...question,
      rubric: [...(question.rubric || []), { criterion: '', points: '1', description: '' }],
    })
  }

  const updateRubricRow = (index, field, value) => {
    const rubric = (question.rubric || []).map((item, i) => (i === index ? { ...item, [field]: value } : item))
    onQuestionChange({ ...question, rubric })
  }

  const removeRubricRow = (index) => {
    onQuestionChange({
      ...question,
      rubric: (question.rubric || []).filter((_, i) => i !== index),
    })
  }

  const supportsRubric = type === 'theory' || type === 'drawing' || type === 'short_answer'

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-card question-builder-modal" role="dialog" aria-modal="true" aria-labelledby="question-modal-title">
        <div className="modal-heading">
          <div><p className="eyebrow">QUESTION BANK</p><h2 id="question-modal-title">{editing ? 'Edit question' : 'Add a question'}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <form onSubmit={onSubmit}>
          <div className="question-meta-grid">
            <label className="form-label">Question type
              <select value={type} onChange={(event) => handleTypeChange(event.target.value)}>
                {QUESTION_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </label>
            <label className="form-label">Points
              <input
                type="number"
                min="0.5"
                max="1000"
                step="0.5"
                required
                value={question.points}
                onChange={(event) => onQuestionChange({ ...question, points: event.target.value })}
              />
            </label>
            <label className="form-label">Difficulty
              <select value={question.difficulty || 'Medium'} onChange={(event) => onQuestionChange({ ...question, difficulty: event.target.value })}>
                <option value="Easy">Easy</option>
                <option value="Medium">Medium</option>
                <option value="Hard">Hard</option>
              </select>
            </label>
          </div>

          <label className="form-label">Question prompt
            <textarea
              required
              rows="3"
              value={question.prompt}
              onChange={(event) => onQuestionChange({ ...question, prompt: event.target.value })}
              placeholder="Write your question..."
            />
          </label>

          <div className="form-row">
            <label className="form-label">Instructions <span className="assessment-optional">(optional)</span>
              <input
                value={question.instructions || ''}
                onChange={(event) => onQuestionChange({ ...question, instructions: event.target.value })}
                placeholder="Guidance shown to learners"
              />
            </label>
            <label className="form-label">Tags <span className="assessment-optional">(comma-separated)</span>
              <input
                value={question.tagsText || ''}
                onChange={(event) => onQuestionChange({ ...question, tagsText: event.target.value })}
                placeholder="e.g. algebra, security"
              />
            </label>
          </div>

          {(type === 'mcq' || type === 'multi_select') && (
            <div className="builder-section">
              <div className="builder-section-head">
                <strong>Answer options</strong>
                {question.options.length < 8 && (
                  <button type="button" className="small-button" onClick={addOption}>+ Add option</button>
                )}
              </div>
              <div className="option-grid">
                {question.options.map((option, index) => (
                  <div className="option-edit-row" key={index}>
                    <label className="form-label">Option {String.fromCharCode(65 + index)}
                      <input
                        required
                        value={option}
                        onChange={(event) => changeOption(index, event.target.value)}
                        placeholder={`Enter option ${String.fromCharCode(65 + index)}`}
                      />
                    </label>
                    {question.options.length > 2 && (
                      <button
                        type="button"
                        className="small-button small-button-danger"
                        onClick={() => removeOption(index)}
                        aria-label={`Remove option ${String.fromCharCode(65 + index)}`}
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {type === 'mcq' && (
            <label className="form-label">Correct answer
              <select
                required
                value={question.correctAnswer}
                onChange={(event) => onQuestionChange({ ...question, correctAnswer: event.target.value })}
              >
                <option value="" disabled>Select the correct option</option>
                {question.options.map((option, index) => (
                  <option key={index} value={option || ''} disabled={!option.trim()}>
                    {String.fromCharCode(65 + index)} — {option || 'Enter an option first'}
                  </option>
                ))}
              </select>
            </label>
          )}

          {type === 'multi_select' && (
            <div className="builder-section">
              <strong>Select all correct answers</strong>
              <div className="multi-correct-list">
                {question.options.map((option, index) => {
                  const trimmed = option.trim()
                  const checked = Boolean(trimmed) && (question.correctAnswers || []).includes(trimmed)
                  return (
                    <label className="assessment-choice" key={index}>
                      <input
                        type="checkbox"
                        disabled={!trimmed}
                        checked={checked}
                        onChange={() => toggleMultiCorrect(option)}
                      />
                      <span>{String.fromCharCode(65 + index)} — {option || 'Enter option text first'}</span>
                    </label>
                  )
                })}
              </div>
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={Boolean(question.partialCredit)}
                  onChange={(event) => onQuestionChange({ ...question, partialCredit: event.target.checked })}
                />
                <span>Award partial credit for partially correct selections</span>
              </label>
            </div>
          )}

          {type === 'true_false' && (
            <label className="form-label">Correct answer
              <select
                required
                value={question.correctAnswer || 'True'}
                onChange={(event) => onQuestionChange({ ...question, correctAnswer: event.target.value })}
              >
                <option value="True">True</option>
                <option value="False">False</option>
              </select>
            </label>
          )}

          {type === 'short_answer' && (
            <label className="form-label">Accepted answers for auto-grading <span className="assessment-optional">(optional, comma or line separated)</span>
              <textarea
                rows="2"
                value={question.acceptedAnswersText || ''}
                onChange={(event) => onQuestionChange({ ...question, acceptedAnswersText: event.target.value })}
                placeholder="Leave blank for manual grading, or enter e.g. SEB, Safe Exam Browser"
              />
            </label>
          )}

          {supportsRubric && (
            <div className="builder-section">
              <div className="builder-section-head">
                <strong>Grading rubric <span className="assessment-optional">(optional)</span></strong>
                <button type="button" className="small-button" onClick={addRubricRow}>+ Add criterion</button>
              </div>
              {(question.rubric || []).length === 0 ? (
                <p className="builder-empty-hint">Add rubric criteria to guide manual grading of theory or drawing responses.</p>
              ) : (
                <div className="rubric-editor-list">
                  {question.rubric.map((row, index) => (
                    <div className="rubric-editor-row" key={index}>
                      <input
                        placeholder="Criterion title"
                        value={row.criterion}
                        onChange={(event) => updateRubricRow(index, 'criterion', event.target.value)}
                      />
                      <input
                        type="number"
                        min="0"
                        max="1000"
                        step="0.5"
                        placeholder="Pts"
                        value={row.points}
                        onChange={(event) => updateRubricRow(index, 'points', event.target.value)}
                      />
                      <input
                        placeholder="Description / expectation"
                        value={row.description}
                        onChange={(event) => updateRubricRow(index, 'description', event.target.value)}
                      />
                      <button
                        type="button"
                        className="small-button small-button-danger"
                        onClick={() => removeRubricRow(index)}
                        aria-label={`Remove criterion ${index + 1}`}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && <p className="inline-message error-message" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button button-primary">{editing ? 'Save changes' : 'Add to question bank'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

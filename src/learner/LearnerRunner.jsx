import DrawingCanvas from '../components/DrawingCanvas'
import { QUESTION_TYPE_LABELS } from '../dashboard/questionTypes'
import { formatRemaining, isQuestionAnswered } from './learnerUtils'

export default function LearnerRunner({
  selected,
  activeAttempt,
  activeQuestions,
  displayedQuestions,
  currentIndex,
  answers,
  setAnswers,
  saveState,
  lastSavedAt,
  remainingMs,
  fullscreenSupported,
  isFullscreen,
  submitting,
  onSaveNow,
  onRequestFullscreen,
  onToggleMultiSelect,
  onNavigate,
  onSubmit,
}) {
  return (
    <form
      className="learner-runner"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div className="runner-status-bar">
        <div className="runner-timer" aria-live="polite">
          {remainingMs !== null
            ? <>Time remaining: <strong>{formatRemaining(remainingMs)}</strong></>
            : <span>Untimed attempt</span>}
        </div>
        <div className="runner-save-status" role="status">
          {saveState === 'saving' && 'Saving…'}
          {saveState === 'saved' && `Saved ${lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}`}
          {saveState === 'error' && 'Save pending — check connection'}
          {saveState === 'idle' && 'Autosave ready'}
          <button type="button" className="small-button" onClick={onSaveNow}>
            Save now
          </button>
        </div>
      </div>

      {(selected.requireFullscreen || selected.securityMode === 'strict_web') && fullscreenSupported && !isFullscreen && (
        <div className="runner-fullscreen-banner" role="note">
          <span>Full-screen mode is recommended for this assessment.</span>
          <button type="button" className="small-button" onClick={onRequestFullscreen}>Enter full-screen</button>
        </div>
      )}

      {selected.navigationMode === 'free' && activeQuestions.length > 1 && (
        <div className="runner-navigator" aria-label="Question navigator">
          {activeQuestions.map((q, idx) => {
            const answered = isQuestionAnswered(q, answers[q.id])
            return (
              <a
                key={q.id}
                href={`#question-${q.id}`}
                className={`nav-pill ${answered ? 'nav-pill-answered' : ''}`}
              >
                Q{idx + 1}
              </a>
            )
          })}
        </div>
      )}

      {selected.navigationMode === 'sequential' && (
        <p className="learner-attempts">
          Question {currentIndex + 1} of {activeQuestions.length} (sequential navigation)
        </p>
      )}

      {displayedQuestions.map(({ question, index }) => {
        const type = question.type || 'mcq'
        return (
          <fieldset className="learner-question" id={`question-${question.id}`} key={question.id}>
            <legend>
              {index + 1}. {question.prompt}
              <span className="learner-question-meta">
                {QUESTION_TYPE_LABELS[type] || type} · {question.points ?? 1} pts
                {type === 'multi_select' && question.partialCredit ? ' · Partial credit' : ''}
              </span>
            </legend>
            {question.instructions && <p className="learner-question-instructions">{question.instructions}</p>}

            {(type === 'mcq' || type === 'true_false') && question.options.map((option) => (
              <label key={option}>
                <input
                  type="radio"
                  name={question.id}
                  checked={answers[question.id] === option}
                  onChange={() => setAnswers((current) => ({ ...current, [question.id]: option }))}
                />
                {option}
              </label>
            ))}

            {type === 'multi_select' && question.options.map((option) => {
              const selectedList = Array.isArray(answers[question.id]) ? answers[question.id] : []
              return (
                <label key={option}>
                  <input
                    type="checkbox"
                    checked={selectedList.includes(option)}
                    onChange={() => onToggleMultiSelect(question.id, option)}
                  />
                  {option}
                </label>
              )
            })}

            {type === 'short_answer' && (
              <input
                type="text"
                className="learner-text-input"
                maxLength={1000}
                placeholder="Type your answer..."
                value={answers[question.id] || ''}
                onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
              />
            )}

            {type === 'theory' && (
              <div className="learner-theory-wrap">
                <textarea
                  rows={5}
                  maxLength={20000}
                  placeholder="Write your response..."
                  value={answers[question.id] || ''}
                  onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))}
                />
                <small className="learner-word-count">
                  {(answers[question.id] || '').trim() ? (answers[question.id] || '').trim().split(/\s+/).length : 0} words
                </small>
              </div>
            )}

            {type === 'drawing' && (
              <DrawingCanvas
                value={answers[question.id] || { strokes: [], altText: '' }}
                onChange={(nextDrawing) => setAnswers((current) => ({ ...current, [question.id]: nextDrawing }))}
                altTextId={`drawing-alt-${question.id}`}
              />
            )}

            {question.rubric?.length > 0 && (
              <div className="learner-rubric">
                <strong>Grading rubric</strong>
                <ul>
                  {question.rubric.map((item, rIndex) => (
                    <li key={rIndex}>
                      <strong>{item.criterion} ({item.points} pts)</strong>
                      {item.description ? ` — ${item.description}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </fieldset>
        )
      })}

      <div className="runner-actions">
        {selected.navigationMode === 'sequential' && currentIndex > 0 && (
          <button
            type="button"
            className="button button-secondary"
            onClick={() => onNavigate(currentIndex - 1)}
          >
            Previous
          </button>
        )}
        {selected.navigationMode === 'sequential' && currentIndex < activeQuestions.length - 1 ? (
          <button
            type="button"
            className="button button-primary"
            onClick={() => onNavigate(currentIndex + 1)}
          >
            Next question
          </button>
        ) : (
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit assessment'}
          </button>
        )}
      </div>
      {activeAttempt ? null : null}
    </form>
  )
}

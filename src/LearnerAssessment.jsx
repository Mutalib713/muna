import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import DrawingCanvas from './components/DrawingCanvas'
import { formatDateTime } from './dashboard/format'
import { QUESTION_TYPE_LABELS } from './dashboard/questionTypes'
import './dashboard/Dashboard.css'

const FEEDBACK_POLICY_COPY = {
  immediate: 'Scores are shown immediately after submission.',
  after_deadline: 'Scores are released after the availability deadline.',
  manual: 'Scores are held until your mentor releases results.',
}

function isQuestionAnswered(question, value) {
  const type = question.type || 'mcq'
  if (type === 'multi_select') return Array.isArray(value) && value.length > 0
  if (type === 'drawing') {
    return (Array.isArray(value?.strokes) && value.strokes.length > 0) ||
      (typeof value?.altText === 'string' && value.altText.trim().length > 0)
  }
  return typeof value === 'string' && value.trim().length > 0
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}

export default function LearnerAssessment({ hash }) {
  const initialMenteeId = decodeURIComponent(hash.split('/')[2] || '')
  const [menteeId, setMenteeId] = useState(initialMenteeId)
  const [assessments, setAssessments] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [activeAttempt, setActiveAttempt] = useState(null)
  const [activeQuestions, setActiveQuestions] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const [saveState, setSaveState] = useState('idle') // 'idle' | 'saving' | 'saved' | 'error'
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [starting, setStarting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const answersRef = useRef({})
  const autoSubmittedRef = useRef(false)

  useEffect(() => {
    answersRef.current = answers
  }, [answers])

  const selected = useMemo(
    () => assessments.find((assessment) => assessment.id === selectedId),
    [assessments, selectedId],
  )

  const syncSelectionState = useCallback((list, preferredId) => {
    const target = list.find((item) => item.id === preferredId) || list[0] || null
    setSelectedId(target?.id || '')
    if (target?.activeAttempt) {
      setActiveAttempt(target.activeAttempt)
      setActiveQuestions(target.questions || [])
      setAnswers(target.activeAttempt.draftAnswers || {})
      setLastSavedAt(target.activeAttempt.lastSavedAt || null)
      setSaveState(target.activeAttempt.lastSavedAt ? 'saved' : 'idle')
      setCurrentIndex(0)
      setNowMs(Date.now())
      autoSubmittedRef.current = false
    } else {
      setActiveAttempt(null)
      setActiveQuestions([])
      setAnswers({})
      setLastSavedAt(null)
      setSaveState('idle')
      setCurrentIndex(0)
    }
  }, [])

  const loadAssessments = useCallback(async (id = menteeId, preferredId = selectedId) => {
    setError('')
    try {
      const response = await fetch(`/api/learner/assessments/${encodeURIComponent(id.trim())}`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not load assessments.')
      setAssessments(payload.assessments)
      syncSelectionState(payload.assessments, preferredId)
    } catch (loadError) {
      setError(loadError.message)
      setAssessments([])
      setActiveAttempt(null)
    }
  }, [menteeId, selectedId, syncSelectionState])

  const persistDraft = useCallback(async (attemptId, nextAnswers) => {
    if (!attemptId) return
    setSaveState('saving')
    try {
      const response = await fetch(`/api/learner/attempts/${encodeURIComponent(attemptId)}/responses`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menteeId, answers: nextAnswers }),
      })
      const payload = await response.json()
      if (response.status === 409 && payload.expired) {
        setResult(payload.attempt)
        setActiveAttempt(null)
        await loadAssessments(menteeId, selectedId)
        return
      }
      if (!response.ok) throw new Error(payload.error || 'Autosave failed.')
      setLastSavedAt(payload.lastSavedAt)
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }, [menteeId, selectedId, loadAssessments])

  // Debounced autosave while an attempt is in progress.
  useEffect(() => {
    if (!activeAttempt?.id) return undefined
    const timer = window.setTimeout(() => {
      persistDraft(activeAttempt.id, answers)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [answers, activeAttempt?.id, persistDraft])

  const submitAttempt = useCallback(async ({ autoExpired = false } = {}) => {
    if (!selected || !activeAttempt) return
    if (!autoExpired) {
      for (const question of activeQuestions) {
        if (!isQuestionAnswered(question, answersRef.current[question.id])) {
          setError('Answer every question before submitting.')
          return
        }
      }
    }
    setError('')
    setSubmitting(true)
    try {
      const response = await fetch(`/api/learner/assessments/${encodeURIComponent(selected.id)}/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          menteeId,
          attemptId: activeAttempt.id,
          answers: answersRef.current,
          autoExpired,
        }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not submit the assessment.')
      setResult(payload.attempt)
      setActiveAttempt(null)
      await loadAssessments(menteeId, selected.id)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }, [selected, activeAttempt, activeQuestions, menteeId, loadAssessments])

  const remainingMs = activeAttempt?.expiresAt
    ? Math.max(0, Date.parse(activeAttempt.expiresAt) - nowMs)
    : null

  // Display-only countdown driven by server expiresAt; triggers auto-submit at 0.
  useEffect(() => {
    if (!activeAttempt?.expiresAt) return undefined
    const expiresMs = Date.parse(activeAttempt.expiresAt)
    const interval = window.setInterval(() => {
      const currentNow = Date.now()
      setNowMs(currentNow)
      if (expiresMs - currentNow <= 0 && !autoSubmittedRef.current) {
        autoSubmittedRef.current = true
        submitAttempt({ autoExpired: true })
      }
    }, 1000)
    return () => window.clearInterval(interval)
  }, [activeAttempt?.expiresAt, submitAttempt])

  async function startAttempt() {
    if (!selected) return
    setError('')
    setResult(null)
    setStarting(true)
    try {
      const response = await fetch(`/api/learner/assessments/${encodeURIComponent(selected.id)}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menteeId }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not start the assessment.')
      setActiveAttempt(payload.attempt)
      setActiveQuestions(payload.questions)
      setAnswers(payload.attempt.draftAnswers || {})
      setLastSavedAt(payload.attempt.lastSavedAt || null)
      setSaveState(payload.attempt.lastSavedAt ? 'saved' : 'idle')
      setCurrentIndex(0)
      setNowMs(Date.now())
      autoSubmittedRef.current = false
    } catch (startError) {
      setError(startError.message)
    } finally {
      setStarting(false)
    }
  }

  function handleSelectAssessment(nextId) {
    setResult(null)
    setError('')
    syncSelectionState(assessments, nextId)
  }

  function toggleMultiSelect(questionId, option) {
    setAnswers((current) => {
      const prev = Array.isArray(current[questionId]) ? current[questionId] : []
      const next = prev.includes(option) ? prev.filter((item) => item !== option) : [...prev, option]
      return { ...current, [questionId]: next }
    })
  }

  function navigateToQuestion(nextIndex) {
    if (!selected) return
    if (selected.navigationMode === 'sequential' && nextIndex > currentIndex) {
      const currentQ = activeQuestions[currentIndex]
      if (currentQ && !isQuestionAnswered(currentQ, answers[currentQ.id])) {
        setError('Answer the current question before moving to the next one.')
        return
      }
    }
    setError('')
    if (activeAttempt?.id) {
      persistDraft(activeAttempt.id, answers)
    }
    setCurrentIndex(nextIndex)
  }

  const displayedQuestions = useMemo(() => {
    if (!selected) return []
    if (selected.navigationMode === 'sequential') {
      const q = activeQuestions[currentIndex]
      return q ? [{ question: q, index: currentIndex }] : []
    }
    return activeQuestions.map((question, index) => ({ question, index }))
  }, [selected, activeQuestions, currentIndex])

  return (
    <main className="admin-auth-screen learner-screen">
      <section className="admin-auth-card learner-card learner-card-wide">
        <a className="brand admin-auth-brand" href="#/" aria-label="Muna home"><span className="brand-mark">m</span><span>muna<span className="brand-dot">.</span></span></a>
        <p className="eyebrow">MENTEE ASSESSMENT</p>
        <h1>Complete an assessment</h1>
        <form onSubmit={(event) => { event.preventDefault(); setResult(null); loadAssessments() }}>
          <label className="form-label">Mentee ID<input required value={menteeId} onChange={(event) => setMenteeId(event.target.value)} placeholder="Enter your workspace mentee ID" /></label>
          <button className="button button-primary" type="submit">Load assessments</button>
        </form>

        {error && <p className="inline-message error-message" role="alert">{error}</p>}

        {selected && (
          <div className="learner-assessment">
            <label className="form-label">Assessment
              <select value={selectedId} disabled={Boolean(activeAttempt)} onChange={(event) => handleSelectAssessment(event.target.value)}>
                {assessments.map((assessment) => (
                  <option key={assessment.id} value={assessment.id}>{assessment.title}</option>
                ))}
              </select>
            </label>

            {!activeAttempt ? (
              <div className="learner-briefing">
                {selected.description && <p className="assessment-description">{selected.description}</p>}
                <dl className="briefing-grid">
                  <div><dt>Questions</dt><dd>{selected.questions.length}</dd></div>
                  <div><dt>Time limit</dt><dd>{selected.timeLimitMinutes ? `${selected.timeLimitMinutes} minutes` : 'Untimed'}</dd></div>
                  <div>
                    <dt>Attempts</dt>
                    <dd>
                      {selected.attemptCount} of {selected.maxAttempts} used
                      {selected.extraAttempts > 0 ? ` (includes +${selected.extraAttempts} granted)` : ''}
                    </dd>
                  </div>
                  <div><dt>Navigation</dt><dd>{selected.navigationMode === 'sequential' ? 'Sequential (one by one)' : 'Free navigation'}</dd></div>
                  <div><dt>Availability</dt><dd>
                    {selected.availabilityState === 'upcoming' && `Opens ${formatDateTime(selected.availableFrom)}`}
                    {selected.availabilityState === 'closed' && `Closed ${formatDateTime(selected.availableUntil)}`}
                    {selected.availabilityState === 'open' && (selected.availableUntil ? `Open until ${formatDateTime(selected.availableUntil)}` : 'Open')}
                  </dd></div>
                  <div><dt>Feedback</dt><dd>{FEEDBACK_POLICY_COPY[selected.feedbackPolicy] || FEEDBACK_POLICY_COPY.immediate}</dd></div>
                </dl>

                <p className="assessment-draft-note">
                  Starting an assessment consumes <strong>1 attempt</strong>. Your answers autosave as you work, and refreshing resumes an active attempt.
                </p>

                {result && (
                  <div className="learner-receipt" role="status">
                    <strong>Attempt submitted</strong>
                    <span>Submitted: {formatDateTime(result.submittedAt)} · Attempt {result.attemptCount} of {result.maxAttempts}</span>
                    <span>
                      {result.resultsVisible
                        ? `Score: ${result.score}${result.needsManualGrading ? ' (pending mentor review for manual items)' : ''}`
                        : 'Results will be shown once released under the assessment feedback policy.'}
                    </span>
                  </div>
                )}

                {!result && selected.latestSubmission && (
                  <div className="learner-receipt">
                    <strong>Latest submission ({selected.latestSubmission.status})</strong>
                    <span>Submitted: {formatDateTime(selected.latestSubmission.submittedAt)}</span>
                    <span>
                      {selected.latestSubmission.resultsVisible
                        ? `Score: ${selected.latestSubmission.score}`
                        : 'Results hidden until released by your mentor.'}
                    </span>
                  </div>
                )}

                <button
                  type="button"
                  className="button button-primary"
                  disabled={starting || selected.availabilityState !== 'open' || selected.attemptCount >= selected.maxAttempts}
                  onClick={startAttempt}
                >
                  {starting ? 'Starting attempt…' : 'Start attempt (uses 1 attempt)'}
                </button>
              </div>
            ) : (
              <form
                className="learner-runner"
                onSubmit={(event) => {
                  event.preventDefault()
                  submitAttempt({ autoExpired: false })
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
                    <button
                      type="button"
                      className="small-button"
                      onClick={() => persistDraft(activeAttempt.id, answers)}
                    >
                      Save now
                    </button>
                  </div>
                </div>

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
                              onChange={() => toggleMultiSelect(question.id, option)}
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
                      onClick={() => navigateToQuestion(currentIndex - 1)}
                    >
                      Previous
                    </button>
                  )}
                  {selected.navigationMode === 'sequential' && currentIndex < activeQuestions.length - 1 ? (
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => navigateToQuestion(currentIndex + 1)}
                    >
                      Next question
                    </button>
                  ) : (
                    <button className="button button-primary" type="submit" disabled={submitting}>
                      {submitting ? 'Submitting…' : 'Submit assessment'}
                    </button>
                  )}
                </div>
              </form>
            )}
          </div>
        )}
      </section>
    </main>
  )
}

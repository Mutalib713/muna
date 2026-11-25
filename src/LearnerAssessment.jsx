import { useMemo, useState } from 'react'
import DrawingCanvas from './components/DrawingCanvas'
import { QUESTION_TYPE_LABELS } from './dashboard/questionTypes'
import './dashboard/Dashboard.css'

export default function LearnerAssessment({ hash }) {
  const initialMenteeId = decodeURIComponent(hash.split('/')[2] || '')
  const [menteeId, setMenteeId] = useState(initialMenteeId)
  const [assessments, setAssessments] = useState([])
  const [selectedId, setSelectedId] = useState('')
  const [answers, setAnswers] = useState({})
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  async function loadAssessments(id = menteeId) {
    setError('')
    setResult(null)
    try {
      const response = await fetch(`/api/learner/assessments/${encodeURIComponent(id.trim())}`)
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not load assessments.')
      setAssessments(payload.assessments)
      setSelectedId(payload.assessments[0]?.id || '')
      setAnswers({})
    } catch (loadError) {
      setError(loadError.message)
      setAssessments([])
    }
  }

  const selected = useMemo(
    () => assessments.find((assessment) => assessment.id === selectedId),
    [assessments, selectedId]
  )

  function toggleMultiSelect(questionId, option) {
    setAnswers((current) => {
      const prev = Array.isArray(current[questionId]) ? current[questionId] : []
      const next = prev.includes(option) ? prev.filter((item) => item !== option) : [...prev, option]
      return { ...current, [questionId]: next }
    })
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    setResult(null)
    for (const question of selected.questions) {
      const value = answers[question.id]
      if (question.type === 'multi_select') {
        if (!Array.isArray(value) || value.length === 0) {
          setError('Select at least one option for each multiple-select question.')
          return
        }
      } else if (question.type === 'drawing') {
        const hasStrokes = Array.isArray(value?.strokes) && value.strokes.length > 0
        const hasAltText = typeof value?.altText === 'string' && value.altText.trim().length > 0
        if (!hasStrokes && !hasAltText) {
          setError('Draw on the canvas or add a text description for each drawing question.')
          return
        }
      } else if (typeof value !== 'string' || !value.trim()) {
        setError('Answer every question before submitting.')
        return
      }
    }
    try {
      const response = await fetch(`/api/learner/assessments/${encodeURIComponent(selected.id)}/attempts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ menteeId, answers }),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Could not submit the assessment.')
      setResult(payload.attempt)
      await loadAssessments(menteeId)
    } catch (submitError) {
      setError(submitError.message)
    }
  }

  return (
    <main className="admin-auth-screen learner-screen">
      <section className="admin-auth-card learner-card learner-card-wide">
        <a className="brand admin-auth-brand" href="#/" aria-label="Muna home"><span className="brand-mark">m</span><span>muna<span className="brand-dot">.</span></span></a>
        <p className="eyebrow">MENTEE ASSESSMENT</p>
        <h1>Complete an assessment</h1>
        <form onSubmit={(event) => { event.preventDefault(); loadAssessments() }}>
          <label className="form-label">Mentee ID<input required value={menteeId} onChange={(event) => setMenteeId(event.target.value)} placeholder="Enter your workspace mentee ID" /></label>
          <button className="button button-primary" type="submit">Load assessments</button>
        </form>
        {error && <p className="inline-message error-message" role="alert">{error}</p>}
        {selected && <form className="learner-assessment" onSubmit={submit}>
          <label className="form-label">Assessment<select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setAnswers({}); setResult(null) }}>{assessments.map((assessment) => <option key={assessment.id} value={assessment.id}>{assessment.title}</option>)}</select></label>
          {selected.description && <p className="assessment-description">{selected.description}</p>}
          <p className="learner-attempts">{selected.attemptCount} of {selected.maxAttempts} attempts used</p>
          {selected.questions.map((question, index) => {
            const type = question.type || 'mcq'
            return (
              <fieldset className="learner-question" key={question.id}>
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
                      required
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
          {result ? (
            <p className="inline-message success-message" role="status">
              Submitted successfully. Score: {result.score}
              {result.needsManualGrading ? ' (awaiting mentor review for manual items).' : ''}
            </p>
          ) : (
            <button className="button button-primary" type="submit" disabled={selected.attemptCount >= selected.maxAttempts}>Submit assessment</button>
          )}
        </form>}
      </section>
    </main>
  )
}

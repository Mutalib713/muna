import { useMemo, useState } from 'react'
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

  async function submit(event) {
    event.preventDefault()
    setError('')
    setResult(null)
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
      <section className="admin-auth-card learner-card">
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
          {selected.questions.map((question, index) => <fieldset className="learner-question" key={question.id}><legend>{index + 1}. {question.prompt}</legend>{question.options.map((option) => <label key={option}><input type="radio" name={question.id} required checked={answers[question.id] === option} onChange={() => setAnswers((current) => ({ ...current, [question.id]: option }))} />{option}</label>)}</fieldset>)}
          {result ? <p className="inline-message success-message" role="status">Submitted successfully. Score: {result.score}</p> : <button className="button button-primary" type="submit" disabled={selected.attemptCount >= selected.maxAttempts}>Submit assessment</button>}
        </form>}
      </section>
    </main>
  )
}

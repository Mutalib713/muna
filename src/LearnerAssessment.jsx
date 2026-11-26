import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import LearnerBriefing from './learner/LearnerBriefing'
import LearnerRunner from './learner/LearnerRunner'
import './dashboard/Dashboard.css'

export default function LearnerAssessment({ hash }) {
  const [hashPath, hashQuery] = hash.split('?')
  const initialMenteeId = decodeURIComponent(hashPath.split('/')[2] || '')
  const initialAssessmentId = new URLSearchParams(hashQuery || '').get('assessment') || ''
  const [menteeId, setMenteeId] = useState(initialMenteeId)
  const [assessments, setAssessments] = useState([])
  const [selectedId, setSelectedId] = useState(initialAssessmentId)
  const [activeAttempt, setActiveAttempt] = useState(null)
  const [activeQuestions, setActiveQuestions] = useState([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState({})
  const [saveState, setSaveState] = useState('idle')
  const [lastSavedAt, setLastSavedAt] = useState(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [starting, setStarting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [sebStatus, setSebStatus] = useState(null)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const answersRef = useRef({})
  const autoSubmittedRef = useRef(false)
  const fullscreenSupported = typeof document !== 'undefined' && Boolean(document.documentElement?.requestFullscreen)

  useEffect(() => {
    answersRef.current = answers
  }, [answers])

  const selected = useMemo(
    () => assessments.find((assessment) => assessment.id === selectedId),
    [assessments, selectedId],
  )

  useEffect(() => {
    if (!selected || selected.securityMode !== 'seb' || !menteeId.trim()) return undefined
    let active = true
    async function checkSeb() {
      try {
        const response = await fetch(
          `/api/learner/assessments/${encodeURIComponent(selected.id)}/seb-check?menteeId=${encodeURIComponent(menteeId.trim())}`,
        )
        if (!response.ok) return
        const payload = await response.json()
        if (active) setSebStatus(payload)
      } catch {
        // Optional readiness probe; start endpoint enforces SEB server-side.
      }
    }
    checkSeb()
    return () => { active = false }
  }, [selected, menteeId])

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

  useEffect(() => {
    if (initialMenteeId) return undefined
    let active = true
    async function loadSignedInMentee() {
      try {
        const response = await fetch('/api/learner/me')
        if (!response.ok) return
        const payload = await response.json()
        const firstMenteeId = payload.mentees?.[0]?.id
        if (!active || !firstMenteeId) return
        setMenteeId(firstMenteeId)
        await loadAssessments(firstMenteeId)
      } catch {
        // Optional session lookup.
      }
    }
    loadSignedInMentee()
    return () => { active = false }
  }, [initialMenteeId, loadAssessments])

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

  useEffect(() => {
    if (!activeAttempt?.id) return undefined
    const timer = window.setTimeout(() => {
      persistDraft(activeAttempt.id, answers)
    }, 800)
    return () => window.clearTimeout(timer)
  }, [answers, activeAttempt?.id, persistDraft])

  const submitAttempt = useCallback(async ({ autoExpired = false } = {}) => {
    if (!selected || !activeAttempt) return
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
      if (!response.ok) throw new Error(payload.error || 'Could not submit answers.')
      setResult(payload.attempt)
      setActiveAttempt(null)
      await loadAssessments(menteeId, selected.id)
    } catch (submitError) {
      setError(submitError.message)
    } finally {
      setSubmitting(false)
    }
  }, [selected, activeAttempt, menteeId, loadAssessments])

  const remainingMs = activeAttempt?.expiresAt
    ? Math.max(0, Date.parse(activeAttempt.expiresAt) - nowMs)
    : null

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

  const recordSecurityEvent = useCallback(async (attemptId, eventType, detail = '') => {
    if (!attemptId) return
    try {
      const response = await fetch(`/api/learner/attempts/${encodeURIComponent(attemptId)}/security-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          menteeId,
          eventType,
          detail,
          clientTimestamp: new Date().toISOString(),
        }),
      })
      const payload = await response.json()
      if (response.ok && payload.terminated && payload.attempt) {
        setResult(payload.attempt)
        setActiveAttempt(null)
        await loadAssessments(menteeId, selectedId)
      }
    } catch {
      // Best-effort event telemetry; server state remains authoritative.
    }
  }, [menteeId, selectedId, loadAssessments])

  useEffect(() => {
    if (!activeAttempt?.id) return undefined
    const attemptId = activeAttempt.id
    const onVisibilityChange = () => {
      recordSecurityEvent(
        attemptId,
        document.visibilityState === 'hidden' ? 'visibility_hidden' : 'visibility_visible',
        document.visibilityState === 'hidden' ? 'Document visibility changed to hidden' : 'Document visibility restored',
      )
    }
    const onWindowBlur = () => recordSecurityEvent(attemptId, 'window_blur')
    const onWindowFocus = () => recordSecurityEvent(attemptId, 'window_focus')
    const onFullscreenChange = () => {
      const activeFs = Boolean(document.fullscreenElement)
      setIsFullscreen(activeFs)
      recordSecurityEvent(attemptId, activeFs ? 'fullscreen_entered' : 'fullscreen_exited')
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('blur', onWindowBlur)
    window.addEventListener('focus', onWindowFocus)
    document.addEventListener('fullscreenchange', onFullscreenChange)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('blur', onWindowBlur)
      window.removeEventListener('focus', onWindowFocus)
      document.removeEventListener('fullscreenchange', onFullscreenChange)
    }
  }, [activeAttempt?.id, recordSecurityEvent])

  async function requestFullscreenMode() {
    if (!fullscreenSupported || document.fullscreenElement) return
    try {
      await document.documentElement.requestFullscreen()
      setIsFullscreen(true)
    } catch {
      // Full-screen can be declined by the browser/OS; continue with visibility monitoring.
    }
  }

  async function startAttempt() {
    if (!selected) return
    setError('')
    setResult(null)
    setStarting(true)
    if (selected.requireFullscreen || selected.securityMode === 'strict_web') {
      requestFullscreenMode()
    }
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
    if (activeAttempt?.id) {
      persistDraft(activeAttempt.id, answersRef.current)
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

        {error && (
          <p className="inline-message error-message" role="alert">
            {error}{' '}
            {error.toLowerCase().includes('sign-in') && <a href="/login">Log in here</a>}
          </p>
        )}

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
              <LearnerBriefing
                selected={selected}
                menteeId={menteeId}
                sebStatus={sebStatus}
                fullscreenSupported={fullscreenSupported}
                result={result}
                starting={starting}
                onStart={startAttempt}
              />
            ) : (
              <LearnerRunner
                selected={selected}
                activeAttempt={activeAttempt}
                activeQuestions={activeQuestions}
                displayedQuestions={displayedQuestions}
                currentIndex={currentIndex}
                answers={answers}
                setAnswers={setAnswers}
                saveState={saveState}
                lastSavedAt={lastSavedAt}
                remainingMs={remainingMs}
                fullscreenSupported={fullscreenSupported}
                isFullscreen={isFullscreen}
                submitting={submitting}
                onSaveNow={() => persistDraft(activeAttempt.id, answers)}
                onRequestFullscreen={requestFullscreenMode}
                onToggleMultiSelect={toggleMultiSelect}
                onNavigate={navigateToQuestion}
                onSubmit={() => submitAttempt({ autoExpired: false })}
              />
            )}
          </div>
        )}
      </section>
    </main>
  )
}

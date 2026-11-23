import { useEffect, useState } from 'react'
import { Award } from '../../icons'

const STORAGE_KEY = 'muna-demo-theory-draft'

export default function TheoryQuestion() {
  const [theoryText, setTheoryText] = useState(() => {
    try {
      return window.localStorage.getItem(STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [savedAt, setSavedAt] = useState(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(STORAGE_KEY, theoryText)
        setSavedAt(new Date())
      } catch {
        // localStorage unavailable (private mode, blocked storage):
        // the demo keeps working in memory, just without persistence.
      }
    }, 500)
    return () => window.clearTimeout(timer)
  }, [theoryText])

  return (
    <div>
      <div className="studio-meta-bar">
        <div className="q-points-badge">Question 2 · 20 Points · Long-Form Theory</div>
        <span style={{ fontSize: '12px', color: 'var(--support)', fontWeight: 600 }} role="status">
          {savedAt
            ? `Autosaved · ${savedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
            : 'Autosave ready'}
        </span>
      </div>

      <div className="q-prompt">
        Explain why client-side deterrents (such as disabling right-click or DevTools blocking)
        cannot serve as true security boundaries in a web-based examination platform.
      </div>

      <div className="theory-layout">
        <div>
          <label htmlFor="theory-response" className="sr-only">
            Long-form theory response
          </label>
          <textarea
            id="theory-response"
            className="theory-textarea"
            placeholder="Write your explanation here..."
            value={theoryText}
            onChange={(e) => setTheoryText(e.target.value)}
          />
          <div style={{ marginTop: '8px', fontSize: '12px', color: 'var(--ink-muted)' }}>
            Word count: {theoryText.trim() ? theoryText.trim().split(/\s+/).length : 0} words
          </div>
        </div>

        <div className="rubric-box">
          <div className="rubric-title">
            <Award size={16} /> Mentor Grading Rubric
          </div>
          <div className="rubric-item">
            <strong>Client Memory &amp; Network Access (8 pts)</strong>
            <span>Explains that code executed in a user's browser is fully inspectable by the user.</span>
          </div>
          <div className="rubric-item">
            <strong>Server-Side Validation Authority (7 pts)</strong>
            <span>Highlights that all answers, time checks, and limits must be evaluated server-side.</span>
          </div>
          <div className="rubric-item">
            <strong>Clarity &amp; Concrete Examples (5 pts)</strong>
            <span>Provides clear, reasoned architectural arguments.</span>
          </div>
        </div>
      </div>
    </div>
  )
}

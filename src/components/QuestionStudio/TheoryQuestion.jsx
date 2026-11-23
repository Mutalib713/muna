import { useState } from 'react'
import { Award } from '../../icons'

export default function TheoryQuestion() {
  const [theoryText, setTheoryText] = useState('')

  return (
    <div>
      <div className="studio-meta-bar">
        <div className="q-points-badge">Question 2 · 20 Points · Long-Form Theory</div>
        <span style={{ fontSize: '12px', color: 'var(--support)', fontWeight: 600 }}>
          ● Continuous Autosave Active
        </span>
      </div>

      <div className="q-prompt">
        Explain why client-side deterrents (such as disabling right-click or DevTools blocking) 
        cannot serve as true security boundaries in a web-based examination platform.
      </div>

      <div className="theory-layout">
        <div>
          <textarea
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
            <strong>Client Memory & Network Access (8 pts)</strong>
            <span>Explains that code executed in a user's browser is fully inspectable by the user.</span>
          </div>
          <div className="rubric-item">
            <strong>Server-Side Validation Authority (7 pts)</strong>
            <span>Highlights that all answers, time checks, and limits must be evaluated server-side.</span>
          </div>
          <div className="rubric-item">
            <strong>Clarity & Concrete Examples (5 pts)</strong>
            <span>Provides clear, reasoned architectural arguments.</span>
          </div>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'

export default function ShortAnswerQuestion() {
  const [shortAnswer, setShortAnswer] = useState('')

  return (
    <div>
      <div className="studio-meta-bar">
        <div className="q-points-badge">Question 4 · 5 Points · Short Answer Pattern</div>
      </div>

      <div className="q-prompt">
        What dedicated kiosk application is supported by Muna for operating-system-level exam lockdown?
      </div>

      <div className="input-with-button">
        <input
          type="text"
          className="clean-input"
          placeholder="Type your answer here..."
          value={shortAnswer}
          onChange={(e) => setShortAnswer(e.target.value)}
        />
      </div>

      {shortAnswer.trim() && (
        <div style={{ marginTop: '14px', fontSize: '14px' }}>
          {shortAnswer.toLowerCase().includes('safe exam') || shortAnswer.toLowerCase() === 'seb' ? (
            <span style={{ color: 'var(--support)', fontWeight: 600 }}>
              ✓ Exact match recognized: Safe Exam Browser (SEB)
            </span>
          ) : (
            <span style={{ color: 'var(--ink2)' }}>
              Typing answer... (Pattern evaluator tests alternative aliases like "SEB")
            </span>
          )}
        </div>
      )}
    </div>
  )
}

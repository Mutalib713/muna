import { useState } from 'react'

export default function TrueFalseQuestion() {
  const [tfSelection, setTfSelection] = useState(null)

  return (
    <div>
      <div className="studio-meta-bar">
        <div className="q-points-badge">Question 5 · 5 Points · True or False</div>
      </div>

      <div className="q-prompt">
        Safe Exam Browser (SEB) operates merely as a standard browser extension and requires no local software installation.
      </div>

      <div className="options-list">
        {[
          { val: 'true', label: 'True' },
          { val: 'false', label: 'False (Correct: SEB is a dedicated kiosk desktop software)' }
        ].map((opt) => (
          <div
            key={opt.val}
            className={`option-item ${tfSelection === opt.val ? 'selected' : ''}`}
            onClick={() => setTfSelection(opt.val)}
          >
            <div className="option-marker">
              {tfSelection === opt.val ? '✓' : ''}
            </div>
            <div>{opt.label}</div>
          </div>
        ))}
      </div>

      {tfSelection && (
        <div style={{ marginTop: '14px', fontSize: '14px' }}>
          {tfSelection === 'false' ? (
            <span style={{ color: 'var(--support)', fontWeight: 600 }}>
              ✓ Correct! Safe Exam Browser is an OS-level kiosk software application, not a browser plugin.
            </span>
          ) : (
            <span style={{ color: 'var(--accent2)' }}>
              Review: Web-only extensions cannot control system shortcuts or display kiosk windows.
            </span>
          )}
        </div>
      )}
    </div>
  )
}

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

      <div className="options-list" role="group" aria-label="True or False options">
        {[
          { val: 'true', label: 'True' },
          { val: 'false', label: 'False (Correct: SEB is a dedicated kiosk desktop software)' }
        ].map((opt) => {
          const isSelected = tfSelection === opt.val
          return (
            <button
              key={opt.val}
              type="button"
              className={`option-item ${isSelected ? 'selected' : ''}`}
              aria-pressed={isSelected}
              onClick={() => setTfSelection(opt.val)}
            >
              <span className="option-marker" aria-hidden="true">
                {isSelected ? '✓' : ''}
              </span>
              <span>{opt.label}</span>
            </button>
          )
        })}
      </div>

      <div style={{ marginTop: '14px', fontSize: '14px' }} aria-live="polite">
        {tfSelection ? (
          tfSelection === 'false' ? (
            <span style={{ color: 'var(--support)', fontWeight: 600 }}>
              ✓ Correct! Safe Exam Browser is an OS-level kiosk software application, not a browser plugin.
            </span>
          ) : (
            <span style={{ color: 'var(--accent2-text)' }}>
              Review: Web-only extensions cannot control system shortcuts or display kiosk windows.
            </span>
          )
        ) : null}
      </div>
    </div>
  )
}

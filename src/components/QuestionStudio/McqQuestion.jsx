import { useState } from 'react'

export default function McqQuestion() {
  const [selectedMcq, setSelectedMcq] = useState([])

  const toggleMcq = (id) => {
    setSelectedMcq((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  return (
    <div>
      <div className="studio-meta-bar">
        <div className="q-points-badge">Question 3 · 10 Points · Multiple Select (Partial Credit)</div>
      </div>

      <div className="q-prompt">
        Which events are reliably captured by the standard W3C Page Visibility API? (Select all that apply)
      </div>

      <div className="options-list">
        {[
          { id: 'tab', text: 'Switching to another browser tab' },
          { id: 'min', text: 'Minimizing the browser window' },
          { id: 'mobile', text: 'Switching applications on a mobile device' },
          { id: 'eye', text: 'Looking away from the physical webcam' }
        ].map((opt) => (
          <div
            key={opt.id}
            className={`option-item ${selectedMcq.includes(opt.id) ? 'selected' : ''}`}
            onClick={() => toggleMcq(opt.id)}
          >
            <div className="option-marker">
              {selectedMcq.includes(opt.id) ? '✓' : ''}
            </div>
            <div>{opt.text}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: '16px', fontSize: '13px', color: 'var(--ink2)' }}>
        Selected: {selectedMcq.length} of 4 options.
        {selectedMcq.includes('eye') && (
          <span style={{ color: 'var(--accent2)', marginLeft: '8px' }}>
            (Note: Webcam eye tracking is outside MVP scope and not handled by Page Visibility).
          </span>
        )}
      </div>
    </div>
  )
}

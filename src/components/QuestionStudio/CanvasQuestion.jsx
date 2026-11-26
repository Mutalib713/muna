import { useState } from 'react'
import DrawingCanvas from '../DrawingCanvas'

export default function CanvasQuestion() {
  const [drawing, setDrawing] = useState({ strokes: [], altText: '' })

  return (
    <div>
      <div className="studio-meta-bar">
        <div>
          <div className="q-points-badge">Question 1 · 15 Points · Drawing Response</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
            Vector strokes captured: <strong>{drawing.strokes.length}</strong>
          </span>
        </div>
      </div>

      <div className="q-prompt">
        Draw an architectural state machine diagram showing an assessment attempt moving from
        <strong> Active</strong> to <strong> Submitted</strong> or <strong> Terminated</strong>.
      </div>

      <DrawingCanvas value={drawing} onChange={setDrawing} showAltText={false} />
    </div>
  )
}

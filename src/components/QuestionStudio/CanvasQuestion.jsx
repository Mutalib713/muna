import { useState, useRef, useEffect } from 'react'
import { Eraser, RotateCcw } from '../../icons'

export default function CanvasQuestion() {
  const canvasRef = useRef(null)
  const [isDrawing, setIsDrawing] = useState(false)
  const [penColor, setPenColor] = useState('#0F5C8C')
  const [lineWidth, setLineWidth] = useState(3)
  const [isEraser, setIsEraser] = useState(false)
  const [strokeCount, setStrokeCount] = useState(0)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * 2
    canvas.height = rect.height * 2
    ctx.scale(2, 2)
    ctx.strokeStyle = isEraser ? '#FFFFFF' : penColor
    ctx.lineWidth = isEraser ? 16 : lineWidth
  }, [penColor, lineWidth, isEraser])

  const startDrawing = (e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    const clientX = e.clientX || (e.touches && e.touches[0].clientX)
    const clientY = e.clientY || (e.touches && e.touches[0].clientY)

    const x = clientX - rect.left
    const y = clientY - rect.top

    ctx.beginPath()
    ctx.moveTo(x, y)
    setIsDrawing(true)
  }

  const draw = (e) => {
    if (!isDrawing) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()
    const clientX = e.clientX || (e.touches && e.touches[0].clientX)
    const clientY = e.clientY || (e.touches && e.touches[0].clientY)

    const x = clientX - rect.left
    const y = clientY - rect.top

    ctx.strokeStyle = isEraser ? '#FFFFFF' : penColor
    ctx.lineWidth = isEraser ? 16 : lineWidth
    ctx.lineTo(x, y)
    ctx.stroke()
  }

  const stopDrawing = () => {
    if (isDrawing) {
      setIsDrawing(false)
      setStrokeCount((prev) => prev + 1)
    }
  }

  const clearCanvas = () => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setStrokeCount(0)
  }

  return (
    <div>
      <div className="studio-meta-bar">
        <div>
          <div className="q-points-badge">Question 1 · 15 Points · Drawing Response</div>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <span style={{ fontSize: '12px', color: 'var(--ink-muted)' }}>
            Vector strokes captured: <strong>{strokeCount}</strong>
          </span>
        </div>
      </div>

      <div className="q-prompt">
        Draw an architectural state machine diagram showing an assessment attempt moving from 
        <strong> Active</strong> to <strong> Submitted</strong> or <strong> Terminated</strong>.
      </div>

      <div className="canvas-wrapper">
        <div className="canvas-toolbar">
          <div className="tool-group">
            <button
              type="button"
              className={`tool-btn ${!isEraser && penColor === '#0F5C8C' ? 'active' : ''}`}
              onClick={() => {
                setIsEraser(false)
                setPenColor('#0F5C8C')
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#0F5C8C' }}></span> Blue Pen
            </button>
            <button
              type="button"
              className={`tool-btn ${!isEraser && penColor === '#D2601A' ? 'active' : ''}`}
              onClick={() => {
                setIsEraser(false)
                setPenColor('#D2601A')
              }}
            >
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#D2601A' }}></span> Accent Pen
            </button>
            <button
              type="button"
              className={`tool-btn ${isEraser ? 'active' : ''}`}
              onClick={() => setIsEraser(true)}
            >
              <Eraser size={14} /> Eraser
            </button>
          </div>

          <div className="tool-group">
            <button
              type="button"
              className={`tool-btn ${!isEraser && lineWidth === 2 ? 'active' : ''}`}
              onClick={() => {
                setIsEraser(false)
                setLineWidth(2)
              }}
            >
              Fine
            </button>
            <button
              type="button"
              className={`tool-btn ${!isEraser && lineWidth === 4 ? 'active' : ''}`}
              onClick={() => {
                setIsEraser(false)
                setLineWidth(4)
              }}
            >
              Medium
            </button>
          </div>

          <div className="tool-group">
            <button type="button" className="tool-btn" onClick={clearCanvas}>
              <RotateCcw size={14} /> Clear Canvas
            </button>
          </div>
        </div>

        <canvas
          ref={canvasRef}
          className="canvas-area"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />

        <div className="canvas-hint">
          <span>Draw on the canvas above using touch or mouse.</span>
          <span>Muna records strokes as vector data for mentor annotations.</span>
        </div>
      </div>
    </div>
  )
}

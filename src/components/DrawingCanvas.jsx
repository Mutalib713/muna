import { useCallback, useEffect, useRef, useState } from 'react'
import { Eraser, RotateCcw } from '../icons'

const PEN_BLUE = '#0F5C8C'
const PEN_ACCENT = '#D2601A'
const ERASER_WIDTH = 16
const DPR_CAP = 2

// Stroke = { color, width, erase, points: [{ x, y }] } with points
// normalized to 0..1 of the canvas box, so strokes survive resizes.
function paintStroke(ctx, stroke, w, h) {
  if (!stroke?.points?.length) return
  ctx.strokeStyle = stroke.erase ? '#FFFFFF' : stroke.color
  ctx.lineWidth = stroke.erase ? ERASER_WIDTH : stroke.width
  ctx.beginPath()
  const first = stroke.points[0]
  ctx.moveTo(first.x * w, first.y * h)
  if (stroke.points.length === 1) {
    ctx.lineTo(first.x * w + 0.01, first.y * h + 0.01)
  } else {
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x * w, stroke.points[i].y * h)
    }
  }
  ctx.stroke()
}

export default function DrawingCanvas({
  value,
  onChange,
  showAltText = true,
  altTextId = 'drawing-alt-text',
  disabled = false,
}) {
  const canvasRef = useRef(null)
  const strokesRef = useRef(value?.strokes || [])
  const currentStrokeRef = useRef(null)
  const metricsRef = useRef({ w: 0, h: 0 })
  const [strokeCount, setStrokeCount] = useState(value?.strokes?.length || 0)
  const [penColor, setPenColor] = useState(PEN_BLUE)
  const [lineWidth, setLineWidth] = useState(2)
  const [isEraser, setIsEraser] = useState(false)

  const altText = value?.altText || ''

  const redraw = useCallback(() => {
    const canvas = canvasRef.current
    const { w, h } = metricsRef.current
    if (!canvas || w === 0 || h === 0) return
    const ctx = canvas.getContext('2d')
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
    for (const stroke of strokesRef.current) {
      paintStroke(ctx, stroke, w, h)
    }
    if (currentStrokeRef.current) {
      paintStroke(ctx, currentStrokeRef.current, w, h)
    }
  }, [])

  useEffect(() => {
    const incoming = value?.strokes || []
    if (incoming !== strokesRef.current) {
      strokesRef.current = incoming
      setStrokeCount(incoming.length)
      redraw()
    }
  }, [value?.strokes, redraw])

  const sizeCanvas = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    if (rect.width < 10 || rect.height < 10) return
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP)
    metricsRef.current = { w: rect.width, h: rect.height }
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    const ctx = canvas.getContext('2d')
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    redraw()
  }, [redraw])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return undefined
    sizeCanvas()
    const observer = new ResizeObserver(sizeCanvas)
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [sizeCanvas])

  const commitStrokes = (nextStrokes) => {
    strokesRef.current = nextStrokes
    setStrokeCount(nextStrokes.length)
    onChange?.({ strokes: nextStrokes, altText })
  }

  const getPoint = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const clamp = (n) => Math.max(0, Math.min(1, n))
    return {
      x: clamp((e.clientX - rect.left) / rect.width),
      y: clamp((e.clientY - rect.top) / rect.height),
    }
  }

  const handlePointerDown = (e) => {
    if (disabled) return
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const canvas = canvasRef.current
    try {
      canvas.setPointerCapture(e.pointerId)
    } catch {
      // Pointer capture is best-effort.
    }
    currentStrokeRef.current = {
      color: penColor,
      width: lineWidth,
      erase: isEraser,
      points: [getPoint(e)],
    }
    const { w, h } = metricsRef.current
    paintStroke(canvas.getContext('2d'), currentStrokeRef.current, w, h)
  }

  const handlePointerMove = (e) => {
    const stroke = currentStrokeRef.current
    if (!stroke || disabled) return
    const point = getPoint(e)
    const prev = stroke.points[stroke.points.length - 1]
    if (Math.abs(point.x - prev.x) < 0.001 && Math.abs(point.y - prev.y) < 0.001) return
    stroke.points.push(point)
    const { w, h } = metricsRef.current
    const ctx = canvasRef.current.getContext('2d')
    ctx.strokeStyle = stroke.erase ? '#FFFFFF' : stroke.color
    ctx.lineWidth = stroke.erase ? ERASER_WIDTH : stroke.width
    ctx.beginPath()
    ctx.moveTo(prev.x * w, prev.y * h)
    ctx.lineTo(point.x * w, point.y * h)
    ctx.stroke()
  }

  const endStroke = () => {
    const stroke = currentStrokeRef.current
    if (!stroke) return
    currentStrokeRef.current = null
    commitStrokes([...strokesRef.current, stroke])
  }

  const undoStroke = () => {
    if (disabled || strokesRef.current.length === 0) return
    commitStrokes(strokesRef.current.slice(0, -1))
    redraw()
  }

  const clearCanvas = () => {
    if (disabled) return
    currentStrokeRef.current = null
    commitStrokes([])
    redraw()
  }

  return (
    <div className="canvas-wrapper">
      <div className="canvas-toolbar">
        <div className="tool-group">
          <button
            type="button"
            disabled={disabled}
            className={`tool-btn ${!isEraser && penColor === PEN_BLUE ? 'active' : ''}`}
            aria-pressed={!isEraser && penColor === PEN_BLUE}
            onClick={() => {
              setIsEraser(false)
              setPenColor(PEN_BLUE)
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: PEN_BLUE, display: 'inline-block' }} aria-hidden="true" /> Blue Pen
          </button>
          <button
            type="button"
            disabled={disabled}
            className={`tool-btn ${!isEraser && penColor === PEN_ACCENT ? 'active' : ''}`}
            aria-pressed={!isEraser && penColor === PEN_ACCENT}
            onClick={() => {
              setIsEraser(false)
              setPenColor(PEN_ACCENT)
            }}
          >
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: PEN_ACCENT, display: 'inline-block' }} aria-hidden="true" /> Accent Pen
          </button>
          <button
            type="button"
            disabled={disabled}
            className={`tool-btn ${isEraser ? 'active' : ''}`}
            aria-pressed={isEraser}
            onClick={() => setIsEraser(true)}
          >
            <Eraser size={14} /> Eraser
          </button>
        </div>

        <div className="tool-group">
          <button
            type="button"
            disabled={disabled}
            className={`tool-btn ${!isEraser && lineWidth === 2 ? 'active' : ''}`}
            aria-pressed={!isEraser && lineWidth === 2}
            onClick={() => {
              setIsEraser(false)
              setLineWidth(2)
            }}
          >
            Fine
          </button>
          <button
            type="button"
            disabled={disabled}
            className={`tool-btn ${!isEraser && lineWidth === 4 ? 'active' : ''}`}
            aria-pressed={!isEraser && lineWidth === 4}
            onClick={() => {
              setIsEraser(false)
              setLineWidth(4)
            }}
          >
            Medium
          </button>
        </div>

        <div className="tool-group">
          <button type="button" className="tool-btn" disabled={disabled || strokeCount === 0} onClick={undoStroke}>
            Undo
          </button>
          <button type="button" className="tool-btn" disabled={disabled || strokeCount === 0} onClick={clearCanvas}>
            <RotateCcw size={14} /> Clear Canvas
          </button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="canvas-area"
        role="img"
        aria-label="Freehand drawing canvas, draw with mouse, touch or stylus"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
      />

      <div className="canvas-hint">
        <span>Draw using touch, stylus, or mouse ({strokeCount} stroke{strokeCount === 1 ? '' : 's'}).</span>
        <span>Strokes are saved as compact vector data.</span>
      </div>

      {showAltText && (
        <div className="canvas-alt-wrap">
          <label htmlFor={altTextId} className="canvas-alt-label">
            Text description / diagram alternative <span className="assessment-optional">(optional if drawn; accessible alternative)</span>
          </label>
          <textarea
            id={altTextId}
            rows={2}
            disabled={disabled}
            className="canvas-alt-input"
            placeholder="Describe your diagram or reasoning in text..."
            value={altText}
            onChange={(event) => onChange?.({ strokes: strokesRef.current, altText: event.target.value })}
          />
        </div>
      )}
    </div>
  )
}

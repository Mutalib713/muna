export default function DrawingPreview({ drawing }) {
  const strokes = Array.isArray(drawing?.strokes) ? drawing.strokes : []
  const altText = typeof drawing?.altText === 'string' ? drawing.altText : ''

  return (
    <div className="drawing-preview-card">
      {strokes.length > 0 ? (
        <svg
          className="drawing-preview-svg"
          viewBox="0 0 100 60"
          preserveAspectRatio="none"
          role="img"
          aria-label={altText || `Submitted drawing with ${strokes.length} strokes`}
        >
          <rect x="0" y="0" width="100" height="60" fill="#ffffff" />
          {strokes.map((stroke, index) => {
            const color = stroke.erase ? '#ffffff' : (stroke.color || '#0F5C8C')
            const strokeWidth = stroke.erase ? 3.5 : Math.max(0.5, (stroke.width || 2) * 0.35)
            if (!stroke.points?.length) return null
            if (stroke.points.length === 1) {
              const p = stroke.points[0]
              return <circle key={index} cx={p.x * 100} cy={p.y * 60} r={strokeWidth / 2} fill={color} />
            }
            const pointsAttr = stroke.points.map((p) => `${(p.x * 100).toFixed(2)},${(p.y * 60).toFixed(2)}`).join(' ')
            return (
              <polyline
                key={index}
                fill="none"
                stroke={color}
                strokeWidth={strokeWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
                points={pointsAttr}
              />
            )
          })}
        </svg>
      ) : (
        <p className="drawing-preview-empty">No strokes drawn (text description provided below).</p>
      )}
      {altText && (
        <p className="drawing-preview-alt">
          <strong>Description:</strong> {altText}
        </p>
      )}
    </div>
  )
}

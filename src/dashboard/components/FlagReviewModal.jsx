import Icon from '../DashboardIcon'
import StudentCell from './StudentCell'

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function FlagReviewModal({ flag, note, error, onNoteChange, onClose, onReview }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-card answer-modal" role="dialog" aria-modal="true" aria-labelledby="flag-modal-title">
        <div className="modal-heading"><div><p className="eyebrow">INTEGRITY SIGNAL {flag.id}</p><h2 id="flag-modal-title">Review activity signal</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        <StudentCell name={flag.student} initials={flag.initials} id={flag.assessment} />
        <div className="integrity-notice modal-integrity-notice"><span className="notice-icon"><Icon name="alert" size={19} /></span><p><strong>A signal is not proof of misconduct.</strong> Consider context and document the reason for your decision.</p></div>
        <div className="answer-detail"><span>ACTIVITY SIGNAL</span><strong>{flag.signal}</strong><p>{flag.detail}</p></div>
        {flag.reviewHistory?.length > 0 && <div className="history-list"><strong>Review history</strong>{flag.reviewHistory.map((entry, index) => <div className="review-record" key={`${entry.createdAt}-${index}`}><strong>{entry.decision}</strong><span>{entry.actor} · {formatDateTime(entry.createdAt)}</span><p>{entry.note}</p></div>)}</div>}
        <label className="form-label review-feedback">Review notes<textarea rows="3" value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="Record the context or reason for your decision..." /></label>
        {error && <p className="inline-message error-message" role="alert">{error}</p>}
        <div className="modal-actions"><button className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-secondary" onClick={() => onReview('Follow-up')}><Icon name="clock" size={16} /> Keep for follow-up</button><button className="button button-primary" onClick={() => onReview('Dismissed')}><Icon name="check" size={16} /> Dismiss signal</button></div>
      </section>
    </div>
  )
}

import Icon from '../DashboardIcon'
import StudentCell from './StudentCell'

function formatDateTime(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function AnswerReviewModal({ answer, feedback, error, onFeedbackChange, onClose, onReview }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-card answer-modal" role="dialog" aria-modal="true" aria-labelledby="answer-modal-title">
        <div className="modal-heading"><div><p className="eyebrow">SUBMISSION {answer.id}</p><h2 id="answer-modal-title">Review answer</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        <StudentCell name={answer.student} initials={answer.initials} id={formatDateTime(answer.submitted)} />
        <div className="answer-detail"><span>ASSESSMENT</span><strong>{answer.question}</strong></div>
        <div className="answer-detail"><span>STUDENT&apos;S ANSWER</span><p>{answer.answer}</p></div>
        <div className="answer-detail answer-score"><span>SCORE</span><strong>{answer.score}</strong></div>
        {answer.status === 'Needs review' ? <>
          <label className="form-label review-feedback">Feedback for student<textarea rows="3" value={feedback} onChange={(event) => onFeedbackChange(event.target.value)} placeholder="Add feedback to explain your decision..." /></label>
          {error && <p className="inline-message error-message" role="alert">{error}</p>}
          <div className="modal-actions"><button className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-secondary" onClick={() => onReview('Revision requested')}><Icon name="file" size={16} /> Request revision</button><button className="button button-primary" onClick={() => onReview('Approved')}><Icon name="check" size={16} /> Approve answer</button></div>
        </> : <>
          <div className="review-record"><strong>{answer.reviewDecision || 'Reviewed'}</strong>{answer.reviewedBy ? <span>Reviewed by {answer.reviewedBy}{answer.reviewedAt ? ` · ${formatDateTime(answer.reviewedAt)}` : ''}</span> : <span>No review details were recorded for this seeded submission.</span>}{answer.feedback && <p>{answer.feedback}</p>}</div>
          {answer.reviewHistory?.length > 0 && <div className="history-list"><strong>Review history</strong>{answer.reviewHistory.map((entry, index) => <div className="review-record" key={`${entry.createdAt}-${index}`}><strong>{entry.decision}</strong><span>{entry.actor} · {formatDateTime(entry.createdAt)}</span>{entry.note && <p>{entry.note}</p>}</div>)}</div>}
          <div className="modal-actions"><button className="button button-secondary" onClick={onClose}>Close</button></div>
        </>}
      </section>
    </div>
  )
}

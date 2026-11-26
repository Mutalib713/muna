import { useMemo, useState } from 'react'
import DrawingPreview from '../../components/DrawingPreview'
import Icon from '../DashboardIcon'
import { formatDateTime } from '../format'
import { QUESTION_TYPE_LABELS } from '../questionTypes'
import StudentCell from './StudentCell'

function formatResponse(item) {
  if (Array.isArray(item.response)) return item.response.join(', ')
  if (typeof item.response === 'string') return item.response
  return item.summaryText || '—'
}

export default function AnswerReviewModal({ answer, feedback, error, onFeedbackChange, onClose, onReview }) {
  const items = useMemo(() => (Array.isArray(answer.items) ? answer.items : []), [answer.items])
  const [gradesById, setGradesById] = useState(() => {
    const initial = {}
    for (const item of items) {
      initial[item.questionId] = {
        earnedPoints: String(item.earnedPoints ?? 0),
        comment: item.comment || '',
      }
    }
    return initial
  })

  const computedTotal = useMemo(() => {
    if (items.length === 0) return null
    const earned = items.reduce((sum, item) => sum + (Number(gradesById[item.questionId]?.earnedPoints) || 0), 0)
    const max = items.reduce((sum, item) => sum + Number(item.maxPoints || 0), 0)
    const formatNum = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100))
    return `${formatNum(Math.round(earned * 100) / 100)} / ${formatNum(Math.round(max * 100) / 100)}`
  }, [items, gradesById])

  const updateItemGrade = (questionId, field, value) => {
    setGradesById((current) => ({
      ...current,
      [questionId]: {
        ...(current[questionId] || { earnedPoints: '0', comment: '' }),
        [field]: value,
      },
    }))
  }

  const submitReview = (decision) => {
    const itemGrades = items.map((item) => ({
      questionId: item.questionId,
      earnedPoints: Number(gradesById[item.questionId]?.earnedPoints ?? item.earnedPoints ?? 0),
      comment: gradesById[item.questionId]?.comment ?? '',
    }))
    onReview(decision, itemGrades)
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-card answer-modal answer-modal-wide" role="dialog" aria-modal="true" aria-labelledby="answer-modal-title">
        <div className="modal-heading"><div><p className="eyebrow">SUBMISSION {answer.id}</p><h2 id="answer-modal-title">Review answer</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        <StudentCell name={answer.student} initials={answer.initials} id={formatDateTime(answer.submitted)} />
        <div className="answer-detail"><span>ASSESSMENT</span><strong>{answer.question}</strong></div>

        {items.length > 0 ? (
          <div className="review-items-list">
            {items.map((item, index) => {
              const grade = gradesById[item.questionId] || { earnedPoints: String(item.earnedPoints ?? 0), comment: '' }
              return (
                <div className="review-item-card" key={item.questionId}>
                  <div className="review-item-head">
                    <span className="status-pill status-published">{QUESTION_TYPE_LABELS[item.type] || item.type}</span>
                    <strong>{index + 1}. {item.prompt}</strong>
                    <span className="review-item-points">Max {item.maxPoints} pts</span>
                  </div>

                  {item.type === 'drawing' ? (
                    <DrawingPreview drawing={item.response} />
                  ) : (
                    <div className="answer-detail">
                      <span>STUDENT RESPONSE</span>
                      <p>{formatResponse(item)}</p>
                    </div>
                  )}

                  {item.rubric?.length > 0 && (
                    <div className="review-rubric-box">
                      <strong>Grading rubric</strong>
                      <ul>
                        {item.rubric.map((criterion, cIndex) => (
                          <li key={cIndex}>
                            <strong>{criterion.criterion} ({criterion.points} pts)</strong>
                            {criterion.description ? ` — ${criterion.description}` : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {answer.status === 'Needs review' ? (
                    <div className="review-item-grading">
                      <label className="form-label">Score (0–{item.maxPoints})
                        <input
                          type="number"
                          min="0"
                          max={item.maxPoints}
                          step="0.5"
                          value={grade.earnedPoints}
                          onChange={(event) => updateItemGrade(item.questionId, 'earnedPoints', event.target.value)}
                        />
                      </label>
                      <label className="form-label">Question comment <span className="assessment-optional">(optional)</span>
                        <input
                          value={grade.comment}
                          onChange={(event) => updateItemGrade(item.questionId, 'comment', event.target.value)}
                          placeholder="Rubric feedback for this item..."
                        />
                      </label>
                    </div>
                  ) : (
                    <div className="review-item-summary">
                      <span>Scored: <strong>{item.earnedPoints} / {item.maxPoints} pts</strong></span>
                      {item.comment && <p>{item.comment}</p>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <div className="answer-detail"><span>STUDENT&apos;S ANSWER</span><p>{answer.answer}</p></div>
        )}

        <div className="answer-detail answer-score">
          <span>SCORE</span>
          <strong>{answer.status === 'Needs review' && computedTotal ? computedTotal : answer.score}</strong>
        </div>

        {answer.status === 'Needs review' ? <>
          <label className="form-label review-feedback">Feedback for student<textarea rows="3" value={feedback} onChange={(event) => onFeedbackChange(event.target.value)} placeholder="Add feedback to explain your decision..." /></label>
          {error && <p className="inline-message error-message" role="alert">{error}</p>}
          <div className="modal-actions"><button className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-secondary" onClick={() => submitReview('Revision requested')}><Icon name="file" size={16} /> Request revision</button><button className="button button-primary" onClick={() => submitReview('Approved')}><Icon name="check" size={16} /> Approve answer</button></div>
        </> : <>
          <div className="review-record"><strong>{answer.reviewDecision || 'Reviewed'}</strong>{answer.reviewedBy ? <span>Reviewed by {answer.reviewedBy}{answer.reviewedAt ? ` · ${formatDateTime(answer.reviewedAt)}` : ''}</span> : <span>No review details were recorded for this seeded submission.</span>}{answer.feedback && <p>{answer.feedback}</p>}</div>
          {answer.reviewHistory?.length > 0 && <div className="history-list"><strong>Review history</strong>{answer.reviewHistory.map((entry, index) => <div className="review-record" key={`${entry.createdAt}-${index}`}><strong>{entry.decision}</strong><span>{entry.actor} · {formatDateTime(entry.createdAt)}</span>{entry.note && <p>{entry.note}</p>}</div>)}</div>}
          <div className="modal-actions"><button className="button button-secondary" onClick={onClose}>Close</button></div>
        </>}
      </section>
    </div>
  )
}

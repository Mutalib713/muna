import { useEffect, useState } from 'react'
import Icon from '../DashboardIcon'
import { formatDateTime } from '../format'
import apiRequest from '../services/adminApi'
import StudentCell from './StudentCell'

const EVENT_LABELS = {
  fullscreen_entered: 'Entered full-screen',
  fullscreen_exited: 'Exited full-screen',
  visibility_hidden: 'Page hidden (tab/app switch or minimized)',
  visibility_visible: 'Returned to assessment page',
  window_blur: 'Window lost focus',
  window_focus: 'Window regained focus',
}

export default function FlagReviewModal({ flag, note, error, onNoteChange, onClose, onReview }) {
  const [timeline, setTimeline] = useState([])
  const [attemptInfo, setAttemptInfo] = useState(null)

  useEffect(() => {
    if (!flag?.attemptId) return undefined
    let active = true
    apiRequest(`/attempts/${encodeURIComponent(flag.attemptId)}/security-events`)
      .then((payload) => {
        if (!active) return
        setAttemptInfo(payload.attempt || null)
        setTimeline(payload.events || [])
      })
      .catch(() => {
        if (!active) return
        setTimeline([])
      })
    return () => { active = false }
  }, [flag?.attemptId])

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-card answer-modal" role="dialog" aria-modal="true" aria-labelledby="flag-modal-title">
        <div className="modal-heading"><div><p className="eyebrow">INTEGRITY SIGNAL {flag.id}</p><h2 id="flag-modal-title">Review activity signal</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button></div>
        <StudentCell name={flag.student} initials={flag.initials} id={flag.assessment} />
        <div className="integrity-notice modal-integrity-notice"><span className="notice-icon"><Icon name="alert" size={19} /></span><p><strong>A signal is not proof of misconduct.</strong> Consider context and document the reason for your decision.</p></div>
        <div className="answer-detail"><span>ACTIVITY SIGNAL</span><strong>{flag.signal}</strong><p>{flag.detail}</p></div>

        {flag.attemptId && (
          <div className="history-list">
            <strong>Security event timeline ({flag.attemptId}{attemptInfo?.status ? ` · ${attemptInfo.status}` : ''})</strong>
            {timeline.length > 0 ? timeline.map((ev) => (
              <div className="review-record" key={ev.id}>
                <strong>{EVENT_LABELS[ev.eventType] || ev.eventType}</strong>
                <span>Server time: {formatDateTime(ev.serverTimestamp)}</span>
                {ev.detail && <p>{ev.detail}</p>}
              </div>
            )) : <p className="builder-empty-hint">No individual browser events recorded for this attempt.</p>}
          </div>
        )}

        {flag.reviewHistory?.length > 0 && <div className="history-list"><strong>Review history</strong>{flag.reviewHistory.map((entry, index) => <div className="review-record" key={`${entry.createdAt}-${index}`}><strong>{entry.decision}</strong><span>{entry.actor} · {formatDateTime(entry.createdAt)}</span><p>{entry.note}</p></div>)}</div>}
        <label className="form-label review-feedback">Review notes<textarea rows="3" value={note} onChange={(event) => onNoteChange(event.target.value)} placeholder="Record the context or reason for your decision..." /></label>
        {error && <p className="inline-message error-message" role="alert">{error}</p>}
        <div className="modal-actions"><button className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-secondary" onClick={() => onReview('Follow-up')}><Icon name="clock" size={16} /> Keep for follow-up</button><button className="button button-primary" onClick={() => onReview('Dismissed')}><Icon name="check" size={16} /> Dismiss signal</button></div>
      </section>
    </div>
  )
}

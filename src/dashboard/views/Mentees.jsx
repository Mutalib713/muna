import { useMemo, useState } from 'react'
import PaginationBar from '../components/PaginationBar'
import { formatDateTime } from '../format'
import apiRequest from '../services/adminApi'

const emptyForm = { name: '', email: '' }

export default function Mentees({ dashboard }) {
  const { mentees, pagination, goToPage, search, createMentee, updateMentee, deleteMentee } = dashboard
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')
  const [historyData, setHistoryData] = useState(null)
  const [historyLoading, setHistoryLoading] = useState(false)

  const filtered = useMemo(
    () => mentees.filter((mentee) => `${mentee.name} ${mentee.email}`.toLowerCase().includes(search.toLowerCase())),
    [mentees, search]
  )

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setError('')
    setModalOpen(true)
  }

  function openEdit(mentee) {
    setEditingId(mentee.id)
    setForm({ name: mentee.name, email: mentee.email })
    setError('')
    setModalOpen(true)
  }

  async function openHistory(mentee) {
    setError('')
    setHistoryLoading(true)
    setHistoryData({ mentee, assignments: [], attempts: [], securityEvents: [], extraAttemptGrants: [] })
    try {
      const data = await apiRequest(`/mentees/${encodeURIComponent(mentee.id)}/history`)
      setHistoryData(data)
    } catch (err) {
      setError(err.message)
      setHistoryData(null)
    } finally {
      setHistoryLoading(false)
    }
  }

  async function save(event) {
    event.preventDefault()
    setError('')
    try {
      if (editingId) await updateMentee(editingId, form)
      else await createMentee(form)
      setModalOpen(false)
      setEditingId(null)
      setForm(emptyForm)
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  async function remove(mentee) {
    if (!window.confirm(`Remove ${mentee.name}? Their assignments and attempts will be removed.`)) return
    setError('')
    try {
      await deleteMentee(mentee.id)
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  return (
    <>
      <div className="welcome-row">
        <div><p className="eyebrow">WORKSPACE</p><h1>Mentees</h1><p className="subheading">Manage students assigned to assessments and inspect per-mentee history.</p></div>
        <button className="button button-primary" onClick={openCreate}>+ Add mentee</button>
      </div>
      {error && <p className="inline-message error-message" role="alert">{error}</p>}
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Student roster</h2><p>{pagination?.mentees?.total ?? mentees.length} mentees in this workspace</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>MENTEE</th><th>EMAIL</th><th>ID</th><th></th></tr></thead><tbody>
          {filtered.map((mentee) => <tr key={mentee.id}><td><strong>{mentee.name}</strong></td><td>{mentee.email}</td><td>{mentee.id}</td><td><div className="mentee-actions"><button className="small-button" onClick={() => openHistory(mentee)}>History</button><button className="small-button" onClick={() => openEdit(mentee)}>Edit</button><button className="small-button" onClick={() => remove(mentee)}>Remove</button></div></td></tr>)}
          {filtered.length === 0 && <tr><td className="empty-row" colSpan="4">No mentees match your search.</td></tr>}
        </tbody></table></div>
        <PaginationBar pagination={pagination?.mentees} onPageChange={(page) => goToPage('mentees', page)} />
      </section>

      {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false) }}>
        <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="mentee-modal-title">
          <div className="modal-heading"><div><p className="eyebrow">MENTEE DIRECTORY</p><h2 id="mentee-modal-title">{editingId ? 'Edit mentee' : 'Add mentee'}</h2></div><button className="icon-button" onClick={() => setModalOpen(false)} aria-label="Close">×</button></div>
          <form onSubmit={save}>
            <label className="form-label">Full name<input autoFocus required maxLength="120" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Student name" /></label>
            <label className="form-label">Email address<input type="email" required maxLength="254" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="student@example.com" /></label>
            {error && <p className="inline-message error-message" role="alert">{error}</p>}
            <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setModalOpen(false)}>Cancel</button><button type="submit" className="button button-primary">{editingId ? 'Save changes' : 'Add mentee'}</button></div>
          </form>
        </section>
      </div>}

      {historyData && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setHistoryData(null) }}>
        <section className="modal-card answer-modal answer-modal-wide" role="dialog" aria-modal="true" aria-labelledby="mentee-history-title">
          <div className="modal-heading">
            <div><p className="eyebrow">MENTEE HISTORY · {historyData.mentee.id}</p><h2 id="mentee-history-title">{historyData.mentee.name}</h2></div>
            <button className="icon-button" onClick={() => setHistoryData(null)} aria-label="Close">×</button>
          </div>
          {historyLoading ? (
            <p className="builder-empty-hint">Loading mentee history…</p>
          ) : (
            <div className="mentee-history-sections">
              <div className="history-list">
                <strong>Attempts ({historyData.attempts.length})</strong>
                {historyData.attempts.length > 0 ? historyData.attempts.map((attempt) => (
                  <div className="review-record" key={attempt.id}>
                    <strong>{attempt.assessmentTitle} — {attempt.status}</strong>
                    <span>Score: {attempt.score} ({attempt.gradingStatus})</span>
                    <span>
                      {attempt.startedAt ? `Started ${formatDateTime(attempt.startedAt)}` : ''}
                      {attempt.submittedAt ? ` · Submitted ${formatDateTime(attempt.submittedAt)}` : ''}
                    </span>
                    {attempt.terminationReason && <p>Termination reason: {attempt.terminationReason}</p>}
                  </div>
                )) : <p className="builder-empty-hint">No attempts recorded yet.</p>}
              </div>

              {historyData.extraAttemptGrants.length > 0 && (
                <div className="history-list">
                  <strong>Extra attempt grants ({historyData.extraAttemptGrants.length})</strong>
                  {historyData.extraAttemptGrants.map((grant) => (
                    <div className="review-record" key={grant.id}>
                      <strong>{grant.assessmentTitle} (+{grant.extraAttempts})</strong>
                      <span>Granted by {grant.grantedBy} · {formatDateTime(grant.createdAt)}</span>
                      <p>{grant.reason}</p>
                    </div>
                  ))}
                </div>
              )}

              <div className="history-list">
                <strong>Security events ({historyData.securityEvents.length})</strong>
                {historyData.securityEvents.length > 0 ? historyData.securityEvents.map((ev) => (
                  <div className="review-record" key={ev.id}>
                    <strong>{ev.assessmentTitle}: {ev.eventType}</strong>
                    <span>{formatDateTime(ev.serverTimestamp)} (Attempt {ev.attemptId})</span>
                    {ev.detail && <p>{ev.detail}</p>}
                  </div>
                )) : <p className="builder-empty-hint">No security events recorded.</p>}
              </div>
            </div>
          )}
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setHistoryData(null)}>Close</button></div>
        </section>
      </div>}
    </>
  )
}

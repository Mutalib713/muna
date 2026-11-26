/** Modal dialog for granting audited extra attempts to a mentee on a published assessment. */
export default function ExtraAttemptModal({ assessment, mentees, form, setForm, error, busy, onSubmit, onClose }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="extra-attempt-title">
        <div className="modal-heading">
          <div><p className="eyebrow">ATTEMPT OVERRIDE</p><h2 id="extra-attempt-title">Grant extra attempt</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={onSubmit}>
          <p className="assessment-draft-note">Granting extra attempts for <strong>{assessment.title}</strong> is audit-logged with your name and reason.</p>
          <label className="form-label">Mentee
            <select value={form.menteeId} onChange={(event) => setForm({ ...form, menteeId: event.target.value })}>
              {assessment.menteeIds.map((id) => {
                const mentee = mentees.find((m) => m.id === id)
                return <option key={id} value={id}>{mentee ? `${mentee.name} (${mentee.email})` : id}</option>
              })}
            </select>
          </label>
          <label className="form-label">Additional attempts
            <select value={form.extraAttempts} onChange={(event) => setForm({ ...form, extraAttempts: event.target.value })}>
              <option value="1">+1 attempt</option>
              <option value="2">+2 attempts</option>
              <option value="3">+3 attempts</option>
            </select>
          </label>
          <label className="form-label">Reason (required)
            <textarea required rows="2" maxLength="500" value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} placeholder="e.g. Network disconnect during attempt 3" />
          </label>
          {assessment.extraAttemptGrants?.length > 0 && (
            <div className="extra-grants-history">
              <strong>Previous grants</strong>
              {assessment.extraAttemptGrants.map((grant) => {
                const mentee = mentees.find((m) => m.id === grant.menteeId)
                return <small key={grant.id}>{mentee?.name || grant.menteeId}: +{grant.extraAttempts} by {grant.grantedBy} — &ldquo;{grant.reason}&rdquo;</small>
              })}
            </div>
          )}
          {error && <p className="inline-message error-message" role="alert">{error}</p>}
          <div className="modal-actions">
            <button type="button" className="button button-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Granting…' : 'Grant extra attempt'}</button>
          </div>
        </form>
      </section>
    </div>
  )
}

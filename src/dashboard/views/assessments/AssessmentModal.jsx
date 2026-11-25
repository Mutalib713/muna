import { QUESTION_TYPE_LABELS } from '../../questionTypes'

/** Modal dialog for creating or editing a draft assessment and its delivery rules. */
export default function AssessmentModal({
  editing,
  form,
  setForm,
  formError,
  questions,
  mentees,
  onToggleSelection,
  onSubmit,
  onClose,
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-card assessment-modal" role="dialog" aria-modal="true" aria-labelledby="create-assessment-title">
        <div className="modal-heading">
          <div><p className="eyebrow">ASSESSMENT BUILDER</p><h2 id="create-assessment-title">{editing ? 'Edit draft' : 'Create assessment'}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={onSubmit}>
          <label className="form-label">Assessment title<input autoFocus maxLength="120" required value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} placeholder="e.g. Algebra foundations" /></label>
          <label className="form-label">Instructions <span className="assessment-optional">(optional)</span><textarea rows="2" maxLength="1000" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} placeholder="Tell mentees what to expect..." /></label>

          <div className="assessment-rules-grid">
            <label className="form-label">Maximum attempts per mentee
              <select value={form.maxAttempts} onChange={(event) => setForm({ ...form, maxAttempts: event.target.value })}>
                <option value="3">3 attempts — default</option>
                <option value="2">2 attempts</option>
                <option value="1">1 attempt</option>
              </select>
            </label>
            <label className="form-label">Time limit (minutes) <span className="assessment-optional">(blank = untimed)</span>
              <input
                type="number"
                min="1"
                max="300"
                placeholder="e.g. 30"
                value={form.timeLimitMinutes}
                onChange={(event) => setForm({ ...form, timeLimitMinutes: event.target.value })}
              />
            </label>
            <label className="form-label">Available from <span className="assessment-optional">(optional)</span>
              <input type="datetime-local" value={form.availableFrom} onChange={(event) => setForm({ ...form, availableFrom: event.target.value })} />
            </label>
            <label className="form-label">Available until <span className="assessment-optional">(optional)</span>
              <input type="datetime-local" value={form.availableUntil} onChange={(event) => setForm({ ...form, availableUntil: event.target.value })} />
            </label>
            <label className="form-label">Navigation policy
              <select value={form.navigationMode} onChange={(event) => setForm({ ...form, navigationMode: event.target.value })}>
                <option value="free">Free navigation</option>
                <option value="sequential">Sequential (in order)</option>
              </select>
            </label>
            <label className="form-label">Feedback release
              <select value={form.feedbackPolicy} onChange={(event) => setForm({ ...form, feedbackPolicy: event.target.value })}>
                <option value="immediate">Immediately after submit</option>
                <option value="after_deadline">After availability end date</option>
                <option value="manual">Manual mentor release</option>
              </select>
            </label>
            <label className="form-label">Security profile
              <select value={form.securityMode} onChange={(event) => setForm({ ...form, securityMode: event.target.value })}>
                <option value="standard">Standard web mode (log focus events)</option>
                <option value="strict_web">Strict web mode (lock &amp; submit on tab switch)</option>
                <option value="seb">Safe Exam Browser (SEB required)</option>
              </select>
            </label>
            {form.securityMode === 'seb' && (
              <label className="form-label">
                Browser Exam Key <span className="assessment-optional">(optional 64-hex SHA-256)</span>
                <input
                  maxLength="64"
                  placeholder="Auto-generates Config Key on publish if blank"
                  value={form.sebBrowserExamKey}
                  onChange={(event) => setForm({ ...form, sebBrowserExamKey: event.target.value })}
                />
              </label>
            )}
          </div>

          <div className="assessment-toggles">
            <label className="checkbox-inline">
              <input type="checkbox" checked={form.shuffleQuestions} onChange={(event) => setForm({ ...form, shuffleQuestions: event.target.checked })} />
              <span>Shuffle question order per attempt</span>
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" checked={form.shuffleOptions} onChange={(event) => setForm({ ...form, shuffleOptions: event.target.checked })} />
              <span>Shuffle MCQ option order per attempt</span>
            </label>
            <label className="checkbox-inline">
              <input type="checkbox" checked={form.requireFullscreen} onChange={(event) => setForm({ ...form, requireFullscreen: event.target.checked })} />
              <span>Prompt for full-screen mode on start</span>
            </label>
          </div>
          <p className="assessment-choice-empty">Secure assessment mode logs visibility changes and enforces strict termination server-side, but browser-only controls cannot prevent external devices or OS capture.</p>

          <fieldset className="assessment-choice-group">
            <legend>Choose questions <span>{form.questionIds.length} selected</span></legend>
            {questions.length ? questions.map((question) => (
              <label className={`assessment-choice ${form.questionIds.includes(question.id) ? 'assessment-choice-selected' : ''}`} key={question.id}>
                <input type="checkbox" checked={form.questionIds.includes(question.id)} onChange={() => onToggleSelection('questionIds', question.id)} />
                <span><strong>{question.prompt}</strong><small>{question.id} · {QUESTION_TYPE_LABELS[question.type || 'mcq']} · {question.points ?? 1} pts</small></span>
              </label>
            )) : <p className="assessment-choice-empty">Add questions to the question bank before creating an assessment.</p>}
          </fieldset>
          <fieldset className="assessment-choice-group">
            <legend>Assign to mentees <span>{form.menteeIds.length} selected</span></legend>
            {mentees.map((mentee) => (
              <label className={`assessment-choice ${form.menteeIds.includes(mentee.id) ? 'assessment-choice-selected' : ''}`} key={mentee.id}>
                <input type="checkbox" checked={form.menteeIds.includes(mentee.id)} onChange={() => onToggleSelection('menteeIds', mentee.id)} />
                <span><strong>{mentee.name}</strong><small>{mentee.email}</small></span>
              </label>
            ))}
          </fieldset>
          <p className="assessment-draft-note">This creates a draft. Review the selected questions, delivery rules, and mentees, then publish it to make it available.</p>
          {formError && <p className="inline-message error-message" role="alert">{formError}</p>}
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary">{editing ? 'Save draft' : 'Create draft'}</button></div>
        </form>
      </section>
    </div>
  )
}

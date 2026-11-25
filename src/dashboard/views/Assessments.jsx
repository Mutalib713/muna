import { useMemo, useState } from 'react'
import PaginationBar from '../components/PaginationBar'
import { formatDateTime } from '../format'
import { QUESTION_TYPE_LABELS } from '../questionTypes'
import { getActiveOrganisationId } from '../services/adminApi'
import './Assessments.css'

const statusClass = {
  Draft: 'assessment-status-draft',
  Published: 'assessment-status-published',
  Paused: 'assessment-status-paused',
}

const FEEDBACK_LABELS = {
  immediate: 'Immediate feedback',
  after_deadline: 'Feedback after deadline',
  manual: 'Manual feedback release',
}

const SECURITY_LABELS = {
  standard: 'Standard web mode',
  strict_web: 'Strict web mode',
  seb: 'Safe Exam Browser (SEB)',
}

function initialsFor(name) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function toDatetimeLocal(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromDatetimeLocal(value) {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function newAssessmentForm() {
  return {
    title: '',
    description: '',
    questionIds: [],
    menteeIds: [],
    maxAttempts: '3',
    timeLimitMinutes: '',
    availableFrom: '',
    availableUntil: '',
    shuffleQuestions: false,
    shuffleOptions: false,
    navigationMode: 'free',
    feedbackPolicy: 'immediate',
    securityMode: 'standard',
    requireFullscreen: false,
    sebBrowserExamKey: '',
  }
}

export default function Assessments({ dashboard }) {
  const {
    questions,
    assessments,
    mentees,
    pagination,
    goToPage,
    search,
    createAssessment: saveAssessment,
    updateAssessment: saveAssessmentChanges,
    deleteAssessment,
    updateAssessmentStatus,
    releaseAssessmentResults,
    grantExtraAttempts,
  } = dashboard
  const [modalOpen, setModalOpen] = useState(false)
  const [form, setForm] = useState(newAssessmentForm)
  const [formError, setFormError] = useState('')
  const [viewError, setViewError] = useState('')
  const [editingAssessmentId, setEditingAssessmentId] = useState(null)
  const [extraModalAssessment, setExtraModalAssessment] = useState(null)
  const [extraForm, setExtraForm] = useState({ menteeId: '', extraAttempts: '1', reason: '' })
  const [extraError, setExtraError] = useState('')
  const [extraBusy, setExtraBusy] = useState(false)

  const filteredAssessments = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return assessments
    return assessments.filter((assessment) => {
      const assignedNames = assessment.menteeIds
        .map((menteeId) => mentees.find((mentee) => mentee.id === menteeId)?.name || '')
        .join(' ')
      return `${assessment.title} ${assessment.description} ${assignedNames}`.toLowerCase().includes(query)
    })
  }, [assessments, mentees, search])

  const publishedCount = assessments.filter((assessment) => assessment.status === 'Published').length
  const draftCount = assessments.filter((assessment) => assessment.status === 'Draft').length

  function toggleSelection(field, id) {
    setForm((current) => ({
      ...current,
      [field]: current[field].includes(id)
        ? current[field].filter((selectedId) => selectedId !== id)
        : [...current[field], id],
    }))
    setFormError('')
  }

  async function createAssessment(event) {
    event.preventDefault()
    if (!form.title.trim()) {
      setFormError('Add an assessment title.')
      return
    }
    if (form.questionIds.length === 0) {
      setFormError('Choose at least one question from the question bank.')
      return
    }
    if (form.menteeIds.length === 0) {
      setFormError('Assign the assessment to at least one mentee.')
      return
    }

    try {
      const input = {
        title: form.title.trim(),
        description: form.description.trim(),
        questionIds: [...form.questionIds],
        menteeIds: [...form.menteeIds],
        maxAttempts: Number(form.maxAttempts),
        timeLimitMinutes: form.timeLimitMinutes === '' ? null : Number(form.timeLimitMinutes),
        availableFrom: fromDatetimeLocal(form.availableFrom),
        availableUntil: fromDatetimeLocal(form.availableUntil),
        shuffleQuestions: Boolean(form.shuffleQuestions),
        shuffleOptions: Boolean(form.shuffleOptions),
        navigationMode: form.navigationMode,
        feedbackPolicy: form.feedbackPolicy,
        securityMode: form.securityMode,
        requireFullscreen: Boolean(form.requireFullscreen),
        sebBrowserExamKey: form.securityMode === 'seb' ? form.sebBrowserExamKey.trim() : '',
      }
      if (editingAssessmentId) await saveAssessmentChanges(editingAssessmentId, input)
      else await saveAssessment(input)
      setForm(newAssessmentForm())
      setFormError('')
      setEditingAssessmentId(null)
      setModalOpen(false)
    } catch (error) {
      setFormError(error.message)
    }
  }

  async function togglePublishedState(assessment) {
    const status = assessment.status === 'Published' ? 'Paused' : 'Published'
    setViewError('')
    try {
      await updateAssessmentStatus(assessment.id, status)
    } catch (error) {
      setViewError(error.message)
    }
  }

  async function handleReleaseResults(assessment) {
    setViewError('')
    try {
      await releaseAssessmentResults(assessment.id)
    } catch (error) {
      setViewError(error.message)
    }
  }

  function openExtraAttemptModal(assessment) {
    setExtraModalAssessment(assessment)
    setExtraForm({
      menteeId: assessment.menteeIds[0] || '',
      extraAttempts: '1',
      reason: '',
    })
    setExtraError('')
  }

  async function submitExtraAttempt(event) {
    event.preventDefault()
    if (!extraModalAssessment) return
    setExtraError('')
    setExtraBusy(true)
    try {
      await grantExtraAttempts(extraModalAssessment.id, {
        menteeId: extraForm.menteeId,
        extraAttempts: Number(extraForm.extraAttempts),
        reason: extraForm.reason,
      })
      setExtraModalAssessment(null)
    } catch (error) {
      setExtraError(error.message)
    } finally {
      setExtraBusy(false)
    }
  }

  function closeModal() {
    setModalOpen(false)
    setForm(newAssessmentForm())
    setFormError('')
    setEditingAssessmentId(null)
  }

  function editAssessment(assessment) {
    setEditingAssessmentId(assessment.id)
    setForm({
      title: assessment.title,
      description: assessment.description,
      questionIds: [...assessment.questionIds],
      menteeIds: [...assessment.menteeIds],
      maxAttempts: String(assessment.maxAttempts),
      timeLimitMinutes: assessment.timeLimitMinutes ? String(assessment.timeLimitMinutes) : '',
      availableFrom: toDatetimeLocal(assessment.availableFrom),
      availableUntil: toDatetimeLocal(assessment.availableUntil),
      shuffleQuestions: Boolean(assessment.shuffleQuestions),
      shuffleOptions: Boolean(assessment.shuffleOptions),
      navigationMode: assessment.navigationMode || 'free',
      feedbackPolicy: assessment.feedbackPolicy || 'immediate',
      securityMode: assessment.securityMode || 'standard',
      requireFullscreen: Boolean(assessment.requireFullscreen),
      sebBrowserExamKey: assessment.sebBrowserExamKey || '',
    })
    setFormError('')
    setModalOpen(true)
  }

  async function removeAssessment(assessment) {
    if (!window.confirm(`Delete draft "${assessment.title}"?`)) return
    setViewError('')
    try {
      await deleteAssessment(assessment.id)
    } catch (error) {
      setViewError(error.message)
    }
  }

  async function downloadSebConfig(assessment) {
    setViewError('')
    try {
      const headers = {}
      const orgId = getActiveOrganisationId()
      if (orgId) headers['X-Organisation-Id'] = orgId
      const response = await fetch(`/api/assessments/${encodeURIComponent(assessment.id)}/seb-config`, {
        credentials: 'same-origin',
        headers,
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Could not download Safe Exam Browser configuration.')
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `muna-${assessment.id}.seb`
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      setViewError(error.message)
    }
  }

  return (
    <div className="assessments-view">
      <div className="welcome-row">
        <div>
          <p className="eyebrow">ASSESSMENT DELIVERY</p>
          <h1>Assessments</h1>
          <p className="subheading">Build from your question bank, configure timing and feedback rules, and assign mentees.</p>
        </div>
        <button className="button button-primary" onClick={() => setModalOpen(true)}>+ Create assessment</button>
      </div>

      <div className="assessment-stats">
        <section className="panel assessment-stat"><span>All assessments</span><strong>{assessments.length}</strong></section>
        <section className="panel assessment-stat"><span>Published</span><strong>{publishedCount}</strong></section>
        <section className="panel assessment-stat"><span>Drafts</span><strong>{draftCount}</strong></section>
      </div>

      <div className="assessment-attempt-note" role="note">
        <strong>Attempt limit:</strong> New assessments allow up to <strong>3 attempts per mentee</strong> by default. Mentors can also grant audited extra attempts for technical incidents or accommodations.
      </div>
      {viewError && <p className="inline-message error-message" role="alert">{viewError}</p>}

      <section className="panel assessment-list-panel">
        <div className="panel-heading">
          <div><h2>Your assessments</h2><p>Publishing makes an assessment available to its assigned mentees. Pause it to stop new attempts.</p></div>
        </div>
        {filteredAssessments.length > 0 ? <div className="assessment-list">
          {filteredAssessments.map((assessment) => {
            const assignedMentees = assessment.menteeIds
              .map((menteeId) => mentees.find((mentee) => mentee.id === menteeId))
              .filter(Boolean)
            const questionPrompts = assessment.questionIds
              .map((questionId) => questions.find((question) => question.id === questionId)?.prompt)
              .filter(Boolean)
            const canReleaseManually =
              assessment.status !== 'Draft' &&
              assessment.feedbackPolicy === 'manual' &&
              !assessment.resultsReleased

            return (
              <article className="assessment-row" key={assessment.id}>
                <div className="assessment-main">
                  <div className="assessment-title-line">
                    <h3>{assessment.title}</h3>
                    <span className={`assessment-status ${statusClass[assessment.status]}`}>{assessment.status}</span>
                  </div>
                  {assessment.description && <p className="assessment-description">{assessment.description}</p>}
                  <div className="assessment-delivery-tags">
                    <span>{assessment.questionIds.length} questions</span>
                    <span>{assessment.timeLimitMinutes ? `${assessment.timeLimitMinutes} min limit` : 'Untimed'}</span>
                    <span>{assessment.navigationMode === 'sequential' ? 'Sequential nav' : 'Free nav'}</span>
                    {assessment.shuffleQuestions && <span>Shuffled questions</span>}
                    {assessment.shuffleOptions && <span>Shuffled options</span>}
                    <span>{assessment.resultsReleased ? 'Results released' : (FEEDBACK_LABELS[assessment.feedbackPolicy] || 'Immediate feedback')}</span>
                    <span>{SECURITY_LABELS[assessment.securityMode] || SECURITY_LABELS.standard}</span>
                    {assessment.requireFullscreen && <span>Full-screen prompt</span>}
                  </div>
                  {(assessment.availableFrom || assessment.availableUntil) && (
                    <span className="assessment-window-meta">
                      Window: {assessment.availableFrom ? formatDateTime(assessment.availableFrom) : 'Now'} → {assessment.availableUntil ? formatDateTime(assessment.availableUntil) : 'No end date'}
                    </span>
                  )}
                  <div className="assessment-question-preview">{assessment.questionIds.slice(0, 2).map((questionId) => {
                    const question = questions.find((item) => item.id === questionId)
                    return question && <span key={question.id}>{question.prompt}</span>
                  })}{questionPrompts.length > 2 && <span>+{questionPrompts.length - 2} more</span>}</div>
                </div>
                <div className="assessment-assignees">
                  <span className="assessment-column-label">ASSIGNED TO</span>
                  <div className="assessment-mentee-avatars" aria-label={`${assignedMentees.length} assigned mentees`}>
                    {assignedMentees.slice(0, 4).map((mentee) => <span className="assessment-mentee-avatar" key={mentee.id} title={mentee.name}>{initialsFor(mentee.name)}</span>)}
                    {assignedMentees.length > 4 && <span className="assessment-mentee-more">+{assignedMentees.length - 4}</span>}
                  </div>
                  <span className="assessment-assignee-names">{assignedMentees.length === 1 ? assignedMentees[0].name : `${assignedMentees.length} mentees`}</span>
                </div>
                <div className="assessment-attempts">
                  <span className="assessment-column-label">ATTEMPTS / MENTEE</span>
                  <strong>{assessment.maxAttempts}</strong><span>base max</span>
                  {assessment.extraAttemptGrants?.length > 0 && (
                    <small className="assessment-grants-count">+{assessment.extraAttemptGrants.length} override{assessment.extraAttemptGrants.length === 1 ? '' : 's'}</small>
                  )}
                </div>
                <div className="assessment-actions">
                  {assessment.status === 'Draft' ? (
                    <>
                      <button className="small-button" onClick={() => editAssessment(assessment)}>Edit</button>
                      <button className="small-button" onClick={() => removeAssessment(assessment)}>Delete</button>
                      <button className="button button-primary assessment-action-button" onClick={() => togglePublishedState(assessment)}>Publish</button>
                    </>
                  ) : (
                    <>
                      <button className="small-button" onClick={() => openExtraAttemptModal(assessment)}>Extra attempt</button>
                      {assessment.securityMode === 'seb' && (
                        <button className="small-button" onClick={() => downloadSebConfig(assessment)}>Download .seb</button>
                      )}
                      {canReleaseManually && (
                        <button className="small-button" onClick={() => handleReleaseResults(assessment)}>Release results</button>
                      )}
                      <button className="button button-secondary assessment-action-button" onClick={() => togglePublishedState(assessment)}>
                        {assessment.status === 'Published' ? 'Pause' : 'Resume'}
                      </button>
                    </>
                  )}
                </div>
              </article>
            )
          })}
        </div> : <div className="assessment-empty">
          <span className="assessment-empty-mark">A</span>
          <strong>{assessments.length ? 'No assessments match your search.' : 'No assessments yet'}</strong>
          <p>{assessments.length ? 'Try another title or mentee name.' : 'Create an assessment using questions from your question bank.'}</p>
          {!assessments.length && <button className="button button-primary" onClick={() => setModalOpen(true)}>Create your first assessment</button>}
        </div>}
        <PaginationBar pagination={pagination?.assessments} onPageChange={(page) => goToPage('assessments', page)} />
      </section>

      <p className="assessment-data-note">Assessment rules, autosave drafts, and attempts are saved in SQLite. Mentee attempts can be opened at <code>#/learner/&lt;mentee-id&gt;</code>.</p>

      {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeModal() }}>
        <section className="modal-card assessment-modal" role="dialog" aria-modal="true" aria-labelledby="create-assessment-title">
          <div className="modal-heading">
            <div><p className="eyebrow">ASSESSMENT BUILDER</p><h2 id="create-assessment-title">{editingAssessmentId ? 'Edit draft' : 'Create assessment'}</h2></div>
            <button className="icon-button" onClick={closeModal} aria-label="Close">×</button>
          </div>
          <form onSubmit={createAssessment}>
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
              {questions.length ? questions.map((question) => <label className={`assessment-choice ${form.questionIds.includes(question.id) ? 'assessment-choice-selected' : ''}`} key={question.id}><input type="checkbox" checked={form.questionIds.includes(question.id)} onChange={() => toggleSelection('questionIds', question.id)} /><span><strong>{question.prompt}</strong><small>{question.id} · {QUESTION_TYPE_LABELS[question.type || 'mcq']} · {question.points ?? 1} pts</small></span></label>) : <p className="assessment-choice-empty">Add questions to the question bank before creating an assessment.</p>}
            </fieldset>
            <fieldset className="assessment-choice-group">
              <legend>Assign to mentees <span>{form.menteeIds.length} selected</span></legend>
              {mentees.map((mentee) => <label className={`assessment-choice ${form.menteeIds.includes(mentee.id) ? 'assessment-choice-selected' : ''}`} key={mentee.id}><input type="checkbox" checked={form.menteeIds.includes(mentee.id)} onChange={() => toggleSelection('menteeIds', mentee.id)} /><span><strong>{mentee.name}</strong><small>{mentee.email}</small></span></label>)}
            </fieldset>
            <p className="assessment-draft-note">This creates a draft. Review the selected questions, delivery rules, and mentees, then publish it to make it available.</p>
            {formError && <p className="inline-message error-message" role="alert">{formError}</p>}
            <div className="modal-actions"><button type="button" className="button button-secondary" onClick={closeModal}>Cancel</button><button type="submit" className="button button-primary">{editingAssessmentId ? 'Save draft' : 'Create draft'}</button></div>
          </form>
        </section>
      </div>}

      {extraModalAssessment && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setExtraModalAssessment(null) }}>
        <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="extra-attempt-title">
          <div className="modal-heading">
            <div><p className="eyebrow">ATTEMPT OVERRIDE</p><h2 id="extra-attempt-title">Grant extra attempt</h2></div>
            <button className="icon-button" onClick={() => setExtraModalAssessment(null)} aria-label="Close">×</button>
          </div>
          <form onSubmit={submitExtraAttempt}>
            <p className="assessment-draft-note">Granting extra attempts for <strong>{extraModalAssessment.title}</strong> is audit-logged with your name and reason.</p>
            <label className="form-label">Mentee
              <select value={extraForm.menteeId} onChange={(event) => setExtraForm({ ...extraForm, menteeId: event.target.value })}>
                {extraModalAssessment.menteeIds.map((id) => {
                  const mentee = mentees.find((m) => m.id === id)
                  return <option key={id} value={id}>{mentee ? `${mentee.name} (${mentee.email})` : id}</option>
                })}
              </select>
            </label>
            <label className="form-label">Additional attempts
              <select value={extraForm.extraAttempts} onChange={(event) => setExtraForm({ ...extraForm, extraAttempts: event.target.value })}>
                <option value="1">+1 attempt</option>
                <option value="2">+2 attempts</option>
                <option value="3">+3 attempts</option>
              </select>
            </label>
            <label className="form-label">Reason (required)
              <textarea required rows="2" maxLength="500" value={extraForm.reason} onChange={(event) => setExtraForm({ ...extraForm, reason: event.target.value })} placeholder="e.g. Network disconnect during attempt 3" />
            </label>
            {extraModalAssessment.extraAttemptGrants?.length > 0 && (
              <div className="extra-grants-history">
                <strong>Previous grants</strong>
                {extraModalAssessment.extraAttemptGrants.map((grant) => {
                  const mentee = mentees.find((m) => m.id === grant.menteeId)
                  return <small key={grant.id}>{mentee?.name || grant.menteeId}: +{grant.extraAttempts} by {grant.grantedBy} — &ldquo;{grant.reason}&rdquo;</small>
                })}
              </div>
            )}
            {extraError && <p className="inline-message error-message" role="alert">{extraError}</p>}
            <div className="modal-actions">
              <button type="button" className="button button-secondary" onClick={() => setExtraModalAssessment(null)}>Cancel</button>
              <button type="submit" className="button button-primary" disabled={extraBusy}>{extraBusy ? 'Granting…' : 'Grant extra attempt'}</button>
            </div>
          </form>
        </section>
      </div>}
    </div>
  )
}

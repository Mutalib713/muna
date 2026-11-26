import { useMemo, useState } from 'react'
import PaginationBar from '../components/PaginationBar'
import { getActiveOrganisationId } from '../services/adminApi'
import AssessmentCard from './assessments/AssessmentCard'
import AssessmentModal from './assessments/AssessmentModal'
import ExtraAttemptModal from './assessments/ExtraAttemptModal'
import { assessmentToForm, formToPayload, newAssessmentForm } from './assessments/assessmentFormUtils'
import './Assessments.css'

/** Manage assessments list, builder modal, extra-attempt overrides, and SEB downloads. */
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
    if (!form.title.trim()) return setFormError('Add an assessment title.')
    if (form.questionIds.length === 0) return setFormError('Choose at least one question from the question bank.')
    if (form.menteeIds.length === 0) return setFormError('Assign the assessment to at least one mentee.')

    try {
      const input = formToPayload(form)
      if (editingAssessmentId) await saveAssessmentChanges(editingAssessmentId, input)
      else await saveAssessment(input)
      closeModal()
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
    setExtraForm({ menteeId: assessment.menteeIds[0] || '', extraAttempts: '1', reason: '' })
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
    setForm(assessmentToForm(assessment))
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
        {filteredAssessments.length > 0 ? (
          <div className="assessment-list">
            {filteredAssessments.map((assessment) => (
              <AssessmentCard
                key={assessment.id}
                assessment={assessment}
                questions={questions}
                mentees={mentees}
                onEdit={editAssessment}
                onDelete={removeAssessment}
                onToggleStatus={togglePublishedState}
                onOpenExtraAttempt={openExtraAttemptModal}
                onDownloadSeb={downloadSebConfig}
                onReleaseResults={handleReleaseResults}
              />
            ))}
          </div>
        ) : (
          <div className="assessment-empty">
            <span className="assessment-empty-mark">A</span>
            <strong>{assessments.length ? 'No assessments match your search.' : 'No assessments yet'}</strong>
            <p>{assessments.length ? 'Try another title or mentee name.' : 'Create an assessment using questions from your question bank.'}</p>
            {!assessments.length && <button className="button button-primary" onClick={() => setModalOpen(true)}>Create your first assessment</button>}
          </div>
        )}
        <PaginationBar pagination={pagination?.assessments} onPageChange={(page) => goToPage('assessments', page)} />
      </section>

      <p className="assessment-data-note">Assessment rules, autosave drafts, and attempts are saved in SQLite. Mentee attempts can be opened at <code>#/learner/&lt;mentee-id&gt;</code>.</p>

      {modalOpen && (
        <AssessmentModal
          editing={Boolean(editingAssessmentId)}
          form={form}
          setForm={setForm}
          formError={formError}
          questions={questions}
          mentees={mentees}
          onToggleSelection={toggleSelection}
          onSubmit={createAssessment}
          onClose={closeModal}
        />
      )}

      {extraModalAssessment && (
        <ExtraAttemptModal
          assessment={extraModalAssessment}
          mentees={mentees}
          form={extraForm}
          setForm={setExtraForm}
          error={extraError}
          busy={extraBusy}
          onSubmit={submitExtraAttempt}
          onClose={() => setExtraModalAssessment(null)}
        />
      )}
    </div>
  )
}

import { formatDateTime } from '../../format'
import { FEEDBACK_LABELS, SECURITY_LABELS, STATUS_CLASS, initialsFor } from './assessmentFormUtils'

/** Render a single assessment summary row with delivery tags, assignees, and actions. */
export default function AssessmentCard({
  assessment,
  questions,
  mentees,
  onEdit,
  onDelete,
  onToggleStatus,
  onOpenExtraAttempt,
  onDownloadSeb,
  onReleaseResults,
}) {
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
    <article className="assessment-row">
      <div className="assessment-main">
        <div className="assessment-title-line">
          <h3>{assessment.title}</h3>
          <span className={`assessment-status ${STATUS_CLASS[assessment.status]}`}>{assessment.status}</span>
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
        <div className="assessment-question-preview">
          {assessment.questionIds.slice(0, 2).map((questionId) => {
            const question = questions.find((item) => item.id === questionId)
            return question && <span key={question.id}>{question.prompt}</span>
          })}
          {questionPrompts.length > 2 && <span>+{questionPrompts.length - 2} more</span>}
        </div>
      </div>

      <div className="assessment-assignees">
        <span className="assessment-column-label">ASSIGNED TO</span>
        <div className="assessment-mentee-avatars" aria-label={`${assignedMentees.length} assigned mentees`}>
          {assignedMentees.slice(0, 4).map((mentee) => (
            <span className="assessment-mentee-avatar" key={mentee.id} title={mentee.name}>{initialsFor(mentee.name)}</span>
          ))}
          {assignedMentees.length > 4 && <span className="assessment-mentee-more">+{assignedMentees.length - 4}</span>}
        </div>
        <span className="assessment-assignee-names">
          {assignedMentees.length === 1 ? assignedMentees[0].name : `${assignedMentees.length} mentees`}
        </span>
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
            <button className="small-button" onClick={() => onEdit(assessment)}>Edit</button>
            <button className="small-button" onClick={() => onDelete(assessment)}>Delete</button>
            <button className="button button-primary assessment-action-button" onClick={() => onToggleStatus(assessment)}>Publish</button>
          </>
        ) : (
          <>
            <button className="small-button" onClick={() => onOpenExtraAttempt(assessment)}>Extra attempt</button>
            {assessment.securityMode === 'seb' && (
              <button className="small-button" onClick={() => onDownloadSeb(assessment)}>Download .seb</button>
            )}
            {canReleaseManually && (
              <button className="small-button" onClick={() => onReleaseResults(assessment)}>Release results</button>
            )}
            <button className="button button-secondary assessment-action-button" onClick={() => onToggleStatus(assessment)}>
              {assessment.status === 'Published' ? 'Pause' : 'Resume'}
            </button>
          </>
        )}
      </div>
    </article>
  )
}

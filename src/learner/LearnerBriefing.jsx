import { formatDateTime } from '../dashboard/format'
import { FEEDBACK_POLICY_COPY } from './learnerUtils'

export default function LearnerBriefing({
  selected,
  menteeId,
  sebStatus,
  fullscreenSupported,
  result,
  starting,
  onStart,
}) {
  return (
    <div className="learner-briefing">
      {selected.description && <p className="assessment-description">{selected.description}</p>}
      <dl className="briefing-grid">
        <div><dt>Questions</dt><dd>{selected.questions.length}</dd></div>
        <div><dt>Time limit</dt><dd>{selected.timeLimitMinutes ? `${selected.timeLimitMinutes} minutes` : 'Untimed'}</dd></div>
        <div>
          <dt>Attempts</dt>
          <dd>
            {selected.attemptCount} of {selected.maxAttempts} used
            {selected.extraAttempts > 0 ? ` (includes +${selected.extraAttempts} granted)` : ''}
          </dd>
        </div>
        <div><dt>Navigation</dt><dd>{selected.navigationMode === 'sequential' ? 'Sequential (one by one)' : 'Free navigation'}</dd></div>
        <div><dt>Availability</dt><dd>
          {selected.availabilityState === 'upcoming' && `Opens ${formatDateTime(selected.availableFrom)}`}
          {selected.availabilityState === 'closed' && `Closed ${formatDateTime(selected.availableUntil)}`}
          {selected.availabilityState === 'open' && (selected.availableUntil ? `Open until ${formatDateTime(selected.availableUntil)}` : 'Open')}
        </dd></div>
        <div><dt>Feedback</dt><dd>{FEEDBACK_POLICY_COPY[selected.feedbackPolicy] || FEEDBACK_POLICY_COPY.immediate}</dd></div>
        <div><dt>Security mode</dt><dd>
          {selected.securityMode === 'seb'
            ? 'Safe Exam Browser (SEB required)'
            : selected.securityMode === 'strict_web'
              ? 'Strict web mode (locks on tab switch)'
              : 'Standard web mode'}
        </dd></div>
        <div><dt>Readiness</dt><dd>
          {selected.securityMode === 'seb'
            ? (sebStatus?.sebVerified
              ? 'SEB session verified — ready to start'
              : 'SEB required — launch using the downloaded .seb file')
            : (fullscreenSupported ? 'Browser ready (full-screen supported)' : 'Browser ready (full-screen unavailable)')}
        </dd></div>
      </dl>

      <p className="assessment-draft-note">
        Starting an assessment consumes <strong>1 attempt</strong>. Your answers autosave as you work, and refreshing resumes an active attempt.{' '}
        {selected.securityMode === 'seb'
          ? 'Open the .seb configuration file in Safe Exam Browser to start. Contact your mentor if you need an accessibility accommodation or fallback.'
          : selected.securityMode === 'strict_web'
            ? 'Under strict web mode, switching tabs or leaving the page will lock and submit your last saved answers for mentor review.'
            : 'Visibility and focus transitions are logged with server timestamps for mentor review.'}
      </p>

      {selected.securityMode === 'seb' && selected.sebConfigReady && (
        <p style={{ margin: '0 0 12px' }}>
          <a
            className="button button-secondary"
            href={`/api/learner/assessments/${encodeURIComponent(selected.id)}/seb-config?menteeId=${encodeURIComponent(menteeId.trim())}`}
          >
            Download .seb configuration file
          </a>
        </p>
      )}

      {result && (
        <div className={`learner-receipt ${result.status === 'terminated_focus_lost' ? 'learner-terminated' : ''}`} role="status">
          <strong>
            {result.status === 'terminated_focus_lost'
              ? 'Attempt terminated — focus lost'
              : 'Attempt submitted'}
          </strong>
          <span>Submitted: {formatDateTime(result.submittedAt)} · Attempt {result.attemptCount} of {result.maxAttempts}</span>
          {result.status === 'terminated_focus_lost' && (
            <span>Your last server-acknowledged answers were saved and logged for mentor review.</span>
          )}
          <span>
            {result.resultsVisible
              ? `Score: ${result.score}${result.needsManualGrading ? ' (pending mentor review for manual items)' : ''}`
              : 'Results will be shown once released under the assessment feedback policy.'}
          </span>
        </div>
      )}

      {!result && selected.latestSubmission && (
        <div className={`learner-receipt ${selected.latestSubmission.status === 'terminated_focus_lost' ? 'learner-terminated' : ''}`}>
          <strong>
            {selected.latestSubmission.status === 'terminated_focus_lost'
              ? 'Latest submission (terminated — focus lost)'
              : `Latest submission (${selected.latestSubmission.status})`}
          </strong>
          <span>Submitted: {formatDateTime(selected.latestSubmission.submittedAt)}</span>
          <span>
            {selected.latestSubmission.resultsVisible
              ? `Score: ${selected.latestSubmission.score}`
              : 'Results hidden until released by your mentor.'}
          </span>
        </div>
      )}

      <button
        type="button"
        className="button button-primary"
        disabled={starting || selected.availabilityState !== 'open' || selected.attemptCount >= selected.maxAttempts}
        onClick={onStart}
      >
        {starting ? 'Starting attempt…' : 'Start attempt (uses 1 attempt)'}
      </button>
    </div>
  )
}

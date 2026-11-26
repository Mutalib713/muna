import { useEffect, useState } from 'react'
import Icon from '../DashboardIcon'
import { formatDateTime } from '../format'
import { QUESTION_TYPE_LABELS } from '../questionTypes'
import apiRequest from '../services/adminApi'

const AUDIT_LABELS = {
  export_csv: 'Exported results CSV',
  grant_extra_attempts: 'Granted extra attempt',
  release_results: 'Released assessment results',
}

export default function Reports({ dashboard }) {
  const { assessments } = dashboard
  const [selectedId, setSelectedId] = useState(() => assessments[0]?.id || '')
  const [analytics, setAnalytics] = useState(null)
  const [auditLogs, setAuditLogs] = useState([])
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')

  const activeAssessmentId = assessments.some((a) => a.id === selectedId)
    ? selectedId
    : (assessments[0]?.id || '')

  useEffect(() => {
    let active = true
    Promise.all([
      apiRequest('/audit-logs'),
      activeAssessmentId
        ? apiRequest(`/assessments/${encodeURIComponent(activeAssessmentId)}/analytics`)
        : Promise.resolve(null),
    ])
      .then(([auditData, analyticsData]) => {
        if (!active) return
        setError('')
        setAuditLogs(auditData.auditLogs || [])
        setAnalytics(analyticsData)
      })
      .catch((err) => {
        if (!active) return
        setError(err.message)
      })
    return () => { active = false }
  }, [activeAssessmentId])

  const loading = Boolean(activeAssessmentId) && !analytics && !error

  async function handleExportCsv() {
    if (!activeAssessmentId) return
    setError('')
    setExporting(true)
    try {
      const response = await fetch(`/api/assessments/${encodeURIComponent(activeAssessmentId)}/export.csv`, {
        credentials: 'same-origin',
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}))
        throw new Error(payload.error || 'Could not export CSV.')
      }
      const csvText = await response.text()
      const url = URL.createObjectURL(new Blob([csvText], { type: 'text/csv;charset=utf-8;' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `assessment-${activeAssessmentId}-results.csv`
      link.click()
      URL.revokeObjectURL(url)
      const auditData = await apiRequest('/audit-logs')
      setAuditLogs(auditData.auditLogs || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setExporting(false)
    }
  }

  const distMax = analytics
    ? Math.max(1, ...analytics.scoreDistribution.map((bucket) => bucket.count))
    : 1

  return (
    <div className="reports-view">
      <div className="welcome-row">
        <div>
          <p className="eyebrow">ANALYTICS &amp; EXPORTS</p>
          <h1>Reports</h1>
          <p className="subheading">Cohort participation, question-level performance, and audited CSV exports.</p>
        </div>
        <div className="button-row">
          {assessments.length > 0 && (
            <select
              className="select-button filter-select"
              aria-label="Select assessment for report"
              value={activeAssessmentId}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {assessments.map((assessment) => (
                <option key={assessment.id} value={assessment.id}>{assessment.title}</option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="button button-primary"
            disabled={!activeAssessmentId || exporting}
            onClick={handleExportCsv}
          >
            <Icon name="download" size={16} /> {exporting ? 'Exporting…' : 'Export CSV'}
          </button>
        </div>
      </div>

      {error && <p className="inline-message error-message" role="alert">{error}</p>}

      {loading && !analytics && assessments.length > 0 && (
        <section className="panel"><p className="empty-row">Loading assessment analytics…</p></section>
      )}

      {!activeAssessmentId && (
        <section className="panel"><p className="empty-row">Create an assessment to view analytics and export results.</p></section>
      )}

      {analytics && (
        <>
          <div className="assessment-stats reports-stats-grid">
            <section className="panel assessment-stat">
              <span>Completion</span>
              <strong>{analytics.summary.completedCount} / {analytics.summary.assignedCount}</strong>
            </section>
            <section className="panel assessment-stat">
              <span>Average score</span>
              <strong>{analytics.summary.averageScorePercent}%</strong>
            </section>
            <section className="panel assessment-stat">
              <span>Total attempts</span>
              <strong>{analytics.summary.totalAttempts}</strong>
            </section>
            <section className="panel assessment-stat">
              <span>Focus / expired stops</span>
              <strong>{analytics.summary.terminatedCount + analytics.summary.expiredCount}</strong>
            </section>
          </div>

          <div className="overview-grid">
            <section className="panel activity-panel">
              <div className="panel-heading">
                <div>
                  <h2>Score distribution</h2>
                  <p>Cohort score bands across finalized attempts (unranked by design)</p>
                </div>
                <span className="chart-range">{analytics.summary.completionRate}% completed</span>
              </div>
              <div className="chart" role="img" aria-label="Score distribution bar chart">
                <div className="chart-grid">
                  <span>{distMax}</span>
                  <span>{Math.round(distMax * 0.5)}</span>
                  <span>0</span>
                </div>
                <div className="chart-bars">
                  {analytics.scoreDistribution.map((bucket) => (
                    <div className="chart-column" key={bucket.label}>
                      <div className="bar-track">
                        <span
                          className="bar"
                          style={{ height: `${bucket.count === 0 ? 2 : Math.max(10, (bucket.count / distMax) * 100)}%` }}
                        />
                      </div>
                      <span className="chart-day">{bucket.label} ({bucket.count})</span>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section className="panel attention-panel">
              <div className="panel-heading">
                <div><h2>Attempt breakdown</h2><p>Lifecycle &amp; integrity summary</p></div>
                <span className="attention-count">{analytics.summary.securityEventCount} events</span>
              </div>
              <div className="report-breakdown-list">
                <div><span>Participating mentees</span><strong>{analytics.summary.participatingCount}</strong></div>
                <div><span>Submitted normally</span><strong>{analytics.summary.submittedCount}</strong></div>
                <div><span>In progress</span><strong>{analytics.summary.inProgressCount}</strong></div>
                <div><span>Auto-submitted (expired)</span><strong>{analytics.summary.expiredCount}</strong></div>
                <div><span>Terminated (focus lost)</span><strong>{analytics.summary.terminatedCount}</strong></div>
              </div>
            </section>
          </div>

          <section className="panel table-panel">
            <div className="panel-heading">
              <div>
                <h2>Question-level item analysis</h2>
                <p>Identify concepts where learners need additional guidance</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>QUESTION</th><th>TYPE</th><th>RESPONSES</th><th>AVG SCORE</th><th>PENDING REVIEW</th></tr>
                </thead>
                <tbody>
                  {analytics.itemAnalysis.map((item) => (
                    <tr key={item.questionId}>
                      <td><div className="question-title"><span className="question-id">{item.questionId}</span><strong>{item.prompt}</strong></div></td>
                      <td><span className="status-pill status-published">{QUESTION_TYPE_LABELS[item.type] || item.type}</span></td>
                      <td>{item.responseCount}</td>
                      <td className="score-cell">{item.averageEarned} / {item.maxPoints} ({item.averagePercent}%)</td>
                      <td>{item.needsReviewCount}</td>
                    </tr>
                  ))}
                  {analytics.itemAnalysis.length === 0 && (
                    <tr><td className="empty-row" colSpan="5">No questions found for this assessment.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><h2>Audit log</h2><p>Recent CSV exports, result releases, and extra-attempt grants</p></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>ACTION</th><th>ACTOR</th><th>TARGET</th><th>DETAILS</th><th>TIME</th></tr>
            </thead>
            <tbody>
              {auditLogs.map((entry) => (
                <tr key={entry.id}>
                  <td><strong>{AUDIT_LABELS[entry.action] || entry.action}</strong></td>
                  <td>{entry.actor}</td>
                  <td>{entry.entityType} · {entry.entityId}</td>
                  <td>{entry.detail?.reason || entry.detail?.title || `${entry.detail?.rowCount ?? ''} rows`}</td>
                  <td>{formatDateTime(entry.createdAt)}</td>
                </tr>
              ))}
              {auditLogs.length === 0 && (
                <tr><td className="empty-row" colSpan="5">No audit events recorded yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}

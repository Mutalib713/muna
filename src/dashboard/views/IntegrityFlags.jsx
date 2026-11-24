import { useMemo } from 'react'
import Icon from '../DashboardIcon'
import StudentCell from '../components/StudentCell'

// Receives the `dashboard` context bag from AdminDashboard.jsx.
export default function IntegrityFlags({ dashboard }) {
  const { flags, search, unresolvedFlags, selectFlag } = dashboard

  const filteredFlags = useMemo(
    () => flags.filter((flag) => `${flag.student} ${flag.assessment} ${flag.signal}`.toLowerCase().includes(search.toLowerCase())),
    [flags, search]
  )

  return (
    <>
      <div className="welcome-row">
        <div><p className="eyebrow">ACADEMIC INTEGRITY</p><h1>Integrity flags</h1><p className="subheading">Review unusual patterns in assessment activity with context.</p></div>
        <span className="header-count flag-count"><Icon name="shield" size={16} /> {unresolvedFlags} need review</span>
      </div>
      <div className="integrity-notice"><span className="notice-icon"><Icon name="alert" size={19} /></span><p><strong>A flag is not a finding.</strong> These signals can have legitimate explanations. Review the evidence and speak with the student before drawing conclusions.</p></div>
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Activity signals</h2><p>Potential concerns that may benefit from a closer look.</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>ASSESSMENT</th><th>ACTIVITY SIGNAL</th><th>STATUS</th><th></th></tr></thead><tbody>
          {filteredFlags.map((flag) => <tr key={flag.id}><td><StudentCell name={flag.student} initials={flag.initials} id={flag.id} /></td><td>{flag.assessment}</td><td><div className="signal-copy"><strong>{flag.signal}</strong><small>{flag.detail}</small>{flag.reviewNote && <small className="review-history">Decision by {flag.reviewedBy} · {new Date(flag.reviewedAt).toLocaleString()}: {flag.reviewNote}</small>}</div></td><td><span className={`status-pill ${flag.level === 'Needs review' ? 'status-review' : flag.level === 'Follow-up' ? 'status-follow-up' : 'status-dismissed'}`}>{flag.level}</span></td><td><button className="small-button" onClick={() => selectFlag(flag)}>{flag.level === 'Needs review' ? 'Review signal' : flag.level === 'Follow-up' ? 'Update review' : 'View history'}</button></td></tr>)}
          {filteredFlags.length === 0 && <tr><td className="empty-row" colSpan="5">No integrity signals match your search.</td></tr>}
        </tbody></table></div>
      </section>
    </>
  )
}
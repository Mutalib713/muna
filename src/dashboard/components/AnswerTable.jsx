import StudentCell from './StudentCell'

function formatDateTime(value) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export default function AnswerTable({ answers, onSelect }) {
  return <div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>ASSESSMENT</th><th>SUBMITTED</th><th>SCORE</th><th>STATUS</th><th></th></tr></thead><tbody>
    {answers.map((answer) => {
      const decision = answer.reviewDecision || answer.status
      const statusClass = answer.status === 'Needs review' || decision === 'Revision requested' ? 'status-review' : 'status-reviewed'
      return <tr key={answer.id}><td><StudentCell name={answer.student} initials={answer.initials} id={answer.id} /></td><td>{answer.question}</td><td>{formatDateTime(answer.submitted)}</td><td className="score-cell">{answer.score}</td><td><span className={`status-pill ${statusClass}`}>{decision}</span></td><td><button className="row-action" aria-label={`Review ${answer.student}'s answer`} onClick={() => onSelect(answer)}>Review <span>→</span></button></td></tr>
    })}
    {answers.length === 0 && <tr><td className="empty-row" colSpan="6">No submissions match your filters.</td></tr>}
  </tbody></table></div>
}
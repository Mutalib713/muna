import StudentCell from './StudentCell'

export default function AnswerTable({ answers, onSelect }) {
  return <div className="table-wrap"><table><thead><tr><th>STUDENT</th><th>ASSESSMENT</th><th>SUBMITTED</th><th>SCORE</th><th>STATUS</th><th></th></tr></thead><tbody>
    {answers.map((answer) => <tr key={answer.id}><td><StudentCell name={answer.student} initials={answer.initials} id={answer.id} /></td><td>{answer.question}</td><td>{answer.submitted}</td><td className="score-cell">{answer.score}</td><td><span className={`status-pill ${answer.status === 'Reviewed' ? 'status-reviewed' : 'status-review'}`}>{answer.status}</span></td><td><button className="row-action" aria-label={`Review ${answer.student}'s answer`} onClick={() => onSelect(answer)}>Review <span>→</span></button></td></tr>)}
    {answers.length === 0 && <tr><td className="empty-row" colSpan="6">No submissions match your filters.</td></tr>}
  </tbody></table></div>
}
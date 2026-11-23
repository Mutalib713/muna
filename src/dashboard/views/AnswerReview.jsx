import { useMemo } from 'react'
import AnswerTable from '../components/AnswerTable'

// Receives the `dashboard` context bag from AdminDashboard.jsx.
export default function AnswerReview({ dashboard }) {
  const { answers, search, answerFilter, setAnswerFilter, pendingAnswers, selectAnswer } = dashboard

  const filteredAnswers = useMemo(() => answers.filter((answer) => {
    const matchesFilter = answerFilter === 'All submissions' || answer.status === answerFilter
    const matchesSearch = `${answer.student} ${answer.question} ${answer.answer}`.toLowerCase().includes(search.toLowerCase())
    return matchesFilter && matchesSearch
  }), [answers, answerFilter, search])

  return (
    <>
      <div className="welcome-row">
        <div><p className="eyebrow">ASSESSMENTS</p><h1>Answer review</h1><p className="subheading">Review student submissions and update their review status.</p></div>
        <span className="header-count">{pendingAnswers} waiting for review</span>
      </div>
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Student submissions</h2><p>Open a submission to review the student&apos;s answer.</p></div><select className="select-button filter-select" value={answerFilter} onChange={(event) => setAnswerFilter(event.target.value)} aria-label="Filter submissions"><option>All submissions</option><option>Needs review</option><option>Reviewed</option></select></div>
        <AnswerTable answers={filteredAnswers} onSelect={selectAnswer} />
      </section>
    </>
  )
}
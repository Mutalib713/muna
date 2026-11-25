import { useMemo, useState } from 'react'
import Icon from '../DashboardIcon'
import PaginationBar from '../components/PaginationBar'
import { QUESTION_TYPE_LABELS, QUESTION_TYPE_OPTIONS, summarizeAnswerKey } from '../questionTypes'

// Receives the `dashboard` context bag from AdminDashboard.jsx.
export default function QuestionBank({ dashboard }) {
  const { questions, pagination, goToPage, search, openQuestionModal, downloadTemplate, handleQuestionUpload, uploadMessage, uploadError, fileInput, editQuestion, deleteQuestion } = dashboard
  const [typeFilter, setTypeFilter] = useState('All types')

  const filteredQuestions = useMemo(() => questions.filter((question) => {
    const type = question.type || 'mcq'
    const matchesType = typeFilter === 'All types' || type === typeFilter
    const tags = (question.tags || []).join(' ')
    const matchesSearch = `${question.prompt} ${question.id} ${tags}`.toLowerCase().includes(search.toLowerCase())
    return matchesType && matchesSearch
  }), [questions, search, typeFilter])

  return (
    <>
      <div className="welcome-row">
        <div><p className="eyebrow">CONTENT</p><h1>Question bank</h1><p className="subheading">Create, organize, and upload interactive assessment questions.</p></div>
        <div className="button-row"><button className="button button-secondary" onClick={downloadTemplate}><Icon name="file" size={17} /> Download template</button><button className="button button-primary" onClick={openQuestionModal}><Icon name="plus" size={17} /> Add question</button></div>
      </div>
      <section className="panel question-panel">
        <div className="upload-box"><span className="upload-icon"><Icon name="upload" size={21} /></span><div className="upload-copy"><strong>Upload questions</strong><p>Import a JSON file (MCQ, multi-select, true/false, short answer, theory, or drawing) to your bank.</p></div><input ref={fileInput} className="visually-hidden" type="file" accept=".json,application/json" onChange={handleQuestionUpload} /><button className="button button-secondary" onClick={() => fileInput.current && fileInput.current.click()}><Icon name="upload" size={16} /> Choose JSON file</button></div>
        {uploadMessage && <p className="inline-message success-message" role="status">{uploadMessage}</p>}
        {uploadError && <p className="inline-message error-message" role="alert">{uploadError}</p>}
        <div className="panel-heading question-list-heading">
          <div><h2>All questions <span className="muted-count">{questions.length}</span></h2><p>Questions available for your assessments</p></div>
          <select className="select-button filter-select" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)} aria-label="Filter questions by type">
            <option value="All types">All types</option>
            {QUESTION_TYPE_OPTIONS.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
        <div className="table-wrap"><table><thead><tr><th>QUESTION</th><th>TYPE</th><th>POINTS</th><th>GRADING / KEY</th><th></th></tr></thead><tbody>
          {filteredQuestions.map((question) => {
            const type = question.type || 'mcq'
            return <tr key={question.id}>
              <td>
                <div className="question-title">
                  <span className="question-id">{question.id}{question.difficulty ? ` · ${question.difficulty}` : ''}</span>
                  <strong>{question.prompt}</strong>
                  {question.tags?.length > 0 && <small className="question-tags">{question.tags.join(', ')}</small>}
                </div>
              </td>
              <td><span className="status-pill status-published">{QUESTION_TYPE_LABELS[type] || type}</span></td>
              <td>{question.points ?? 1} pts</td>
              <td>{summarizeAnswerKey(question)}</td>
              <td><div className="button-row compact-actions"><button className="small-button" onClick={() => editQuestion(question)}>Edit</button><button className="small-button danger-button" onClick={() => deleteQuestion(question.id)}>Delete</button></div></td>
            </tr>
          })}
          {filteredQuestions.length === 0 && <tr><td className="empty-row" colSpan="5">No questions match your search.</td></tr>}
        </tbody></table></div>
        <PaginationBar pagination={pagination?.questions} onPageChange={(page) => goToPage('questions', page)} />
      </section>
    </>
  )
}

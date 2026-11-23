import { useMemo } from 'react'
import Icon from '../DashboardIcon'

// Receives the `dashboard` context bag from AdminDashboard.jsx.
export default function QuestionBank({ dashboard }) {
  const { questions, search, openQuestionModal, downloadTemplate, handleQuestionUpload, uploadMessage, uploadError, fileInput } = dashboard

  const filteredQuestions = useMemo(
    () => questions.filter((question) => `${question.prompt} ${question.id}`.toLowerCase().includes(search.toLowerCase())),
    [questions, search]
  )

  return (
    <>
      <div className="welcome-row">
        <div><p className="eyebrow">CONTENT</p><h1>Question bank</h1><p className="subheading">Create, organize, and upload assessment questions.</p></div>
        <div className="button-row"><button className="button button-secondary" onClick={downloadTemplate}><Icon name="file" size={17} /> Download template</button><button className="button button-primary" onClick={openQuestionModal}><Icon name="plus" size={17} /> Add question</button></div>
      </div>
      <section className="panel question-panel">
        <div className="upload-box"><span className="upload-icon"><Icon name="upload" size={21} /></span><div className="upload-copy"><strong>Upload questions</strong><p>Import a JSON file to add questions to your bank.</p></div><input ref={fileInput} className="visually-hidden" type="file" accept=".json,application/json" onChange={handleQuestionUpload} /><button className="button button-secondary" onClick={() => fileInput.current && fileInput.current.click()}><Icon name="upload" size={16} /> Choose JSON file</button></div>
        {uploadMessage && <p className="inline-message success-message" role="status">{uploadMessage}</p>}
        {uploadError && <p className="inline-message error-message" role="alert">{uploadError}</p>}
        <div className="panel-heading question-list-heading"><div><h2>All questions <span className="muted-count">{questions.length}</span></h2><p>Questions available for your assessments</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>QUESTION</th><th>OPTIONS</th><th>CORRECT ANSWER</th><th>STATUS</th></tr></thead><tbody>
          {filteredQuestions.map((question) => <tr key={question.id}><td><div className="question-title"><span className="question-id">{question.id}</span><strong>{question.prompt}</strong></div></td><td>{question.options.length} options</td><td>{question.correctAnswer}</td><td><span className="status-pill status-published">{question.status}</span></td></tr>)}
          {filteredQuestions.length === 0 && <tr><td className="empty-row" colSpan="4">No questions match your search.</td></tr>}
        </tbody></table></div>
      </section>
    </>
  )
}
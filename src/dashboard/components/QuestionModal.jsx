import Icon from '../DashboardIcon'

export default function QuestionModal({ question, onQuestionChange, error, onClose, onSubmit }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="question-modal-title">
        <div className="modal-heading">
          <div><p className="eyebrow">QUESTION BANK</p><h2 id="question-modal-title">Add a question</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>
        <form onSubmit={onSubmit}>
          <label className="form-label">Question<textarea required rows="3" value={question.prompt} onChange={(event) => onQuestionChange({ ...question, prompt: event.target.value })} placeholder="Write your question..." /></label>
          <div className="option-grid">{question.options.map((option, index) => <label className="form-label" key={index}>Option {String.fromCharCode(65 + index)}<input required value={option} onChange={(event) => onQuestionChange({ ...question, options: question.options.map((value, optionIndex) => optionIndex === index ? event.target.value : value) })} placeholder={`Enter option ${String.fromCharCode(65 + index)}`} /></label>)}</div>
          <label className="form-label">Correct answer<select required value={question.correctAnswer} onChange={(event) => onQuestionChange({ ...question, correctAnswer: event.target.value })}><option value="" disabled>Select the correct option</option>{question.options.map((option, index) => <option key={index} value={option || ''} disabled={!option.trim()}>{String.fromCharCode(65 + index)} — {option || 'Enter an option first'}</option>)}</select></label>
          {error && <p className="inline-message error-message" role="alert">{error}</p>}
          <div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button type="submit" className="button button-primary">Add to question bank</button></div>
        </form>
      </section>
    </div>
  )
}

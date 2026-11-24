import { useMemo, useState } from 'react'
import Icon from '../DashboardIcon'

const helpTopics = [
  {
    title: 'Create a question',
    view: 'Question bank',
    description: 'Add a question manually or import a JSON file using the Download template format.',
  },
  {
    title: 'Build an assessment',
    view: 'Assessments',
    description: 'Choose questions, assign mentees, set an attempt limit, and publish a draft.',
  },
  {
    title: 'Add mentees',
    view: 'Mentees',
    description: 'Create or update student names and email addresses in the workspace roster.',
  },
  {
    title: 'Review submissions',
    view: 'Answer review',
    description: 'Approve a submission or request revisions with clear feedback for the student.',
  },
  {
    title: 'Handle integrity signals',
    view: 'Integrity flags',
    description: 'Treat signals as prompts for review, add a decision note, and follow up or dismiss.',
  },
]

export default function HelpCenterModal({ onClose, onNavigate }) {
  const [query, setQuery] = useState('')
  const filteredTopics = useMemo(
    () => helpTopics.filter((topic) => `${topic.title} ${topic.description}`.toLowerCase().includes(query.trim().toLowerCase())),
    [query]
  )

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-card help-center-modal" role="dialog" aria-modal="true" aria-labelledby="help-center-title">
        <div className="modal-heading">
          <div><p className="eyebrow">MUNA WORKSPACE</p><h2 id="help-center-title">Help center</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close help center"><Icon name="close" /></button>
        </div>
        <label className="form-label">Search help topics
          <span className="help-search"><Icon name="search" size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search questions, assessments, or reviews" /></span>
        </label>
        <div className="help-topic-list">
          {filteredTopics.map((topic) => (
            <button className="help-topic" key={topic.title} onClick={() => { onNavigate(topic.view); onClose() }}>
              <span><strong>{topic.title}</strong><small>{topic.description}</small></span>
              <span className="help-topic-arrow">Go to {topic.view} <b>›</b></span>
            </button>
          ))}
          {filteredTopics.length === 0 && <div className="help-empty">No help topics match “{query}”.</div>}
        </div>
        <div className="help-center-note"><Icon name="alert" size={16} /><span>Questions and assessments are saved in SQLite. Mentee attempts can be opened at <code>#/learner/&lt;mentee-id&gt;</code>.</span></div>
      </section>
    </div>
  )
}

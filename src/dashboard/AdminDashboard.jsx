import { useEffect, useRef, useState } from 'react'
import { initialQuestions, initialAnswers, initialFlags, initialMembers, initialInvitations, getInvitationState } from './dashboardData'
import { dashboardViews } from './views/registry'
import Icon from './DashboardIcon'
import StudentCell from './components/StudentCell'
import './Dashboard.css'

// Admin workspace dashboard (originally built by Priscilla Etornam Gbordjuer
// on the admin-dashboard branch; integrated onto main at #/dashboard and
// split into per-view files so views can be built independently).
//
// CONTEXT CONTRACT: every view in views/registry.js receives a single
// `dashboard` prop — the object built in this component. Fields:
//   questions, answers, flags          demo records (dashboardData.js)
//   members, invitations               org records (dashboardData.js)
//   activeInvites                      count of Active invitations
//   search                             topbar search string
//   answerFilter, setAnswerFilter      Answer review filter state
//   pendingAnswers, unresolvedFlags    derived counts for headers/badges
//   navigate(label)                    switch view + clear search
//   openQuestionModal()                open the Add-question dialog
//   selectAnswer(answer)               open the answer review dialog
//   downloadTemplate()                 download question JSON template
//   handleQuestionUpload(event)        import questions JSON file
//   uploadMessage, uploadError         upload feedback strings
//   fileInput                          ref to the hidden file input
//   markFlagReviewed(flagId)           mark an integrity flag reviewed
//   updateMemberRole(id, role)         change a member's organisation role
//   toggleMemberStatus(id)             suspend / restore a member
//   removeMember(id)                   remove a member from the organisation
//   createInvitation({type, email, role, days, maxUses})
//                                      create an invitation, returns it
//   revokeInvitation(id)               revoke an outstanding invitation
//
// Demo data lives in dashboardData.js until Phase 0/1 wires a real backend.
export default function AdminDashboard() {
  const [activeView, setActiveView] = useState('Overview')
  const [questions, setQuestions] = useState(initialQuestions)
  const [answers, setAnswers] = useState(initialAnswers)
  const [flags, setFlags] = useState(initialFlags)
  const [members, setMembers] = useState(initialMembers)
  const [invitations, setInvitations] = useState(initialInvitations)
  const [search, setSearch] = useState('')
  const [answerFilter, setAnswerFilter] = useState('All submissions')
  const [selectedAnswer, setSelectedAnswer] = useState(null)
  const [questionModalOpen, setQuestionModalOpen] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [newQuestion, setNewQuestion] = useState({ prompt: '', options: ['', '', '', ''], correctAnswer: '' })
  const fileInput = useRef(null)

  const pendingAnswers = answers.filter((answer) => answer.status === 'Needs review').length
  const unresolvedFlags = flags.filter((flag) => flag.level === 'Review').length
  const activeInvites = invitations.filter((invite) => getInvitationState(invite) === 'Active').length

  // Escape closes whichever dialog is open (question modal or answer review)
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setQuestionModalOpen(false)
      setSelectedAnswer(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  function parseQuestionFile(text) {
    const parsed = JSON.parse(text)
    // Support both a plain array and an exported object with a questions array.
    const items = Array.isArray(parsed) ? parsed : parsed.questions
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('The JSON file must contain a non-empty array of questions.')
    }

    return items.map((item, index) => {
      const prompt = item.question || item.prompt
      if (typeof prompt !== 'string' || !prompt.trim()) {
        throw new Error(`Question ${index + 1} needs a question or prompt field.`)
      }
      if (!Array.isArray(item.options) || item.options.length < 2 || item.options.some((option) => typeof option !== 'string' || !option.trim())) {
        throw new Error(`Question ${index + 1} needs at least two non-empty options.`)
      }
      if (typeof item.correctAnswer !== 'string' || !item.correctAnswer.trim()) {
        throw new Error(`Question ${index + 1} needs a correctAnswer field.`)
      }
      return {
        id: `Q-${Date.now()}-${index + 1}`,
        prompt: prompt.trim(),
        options: item.options,
        correctAnswer: item.correctAnswer.trim(),
        status: 'Published',
      }
    })
  }

  async function handleQuestionUpload(event) {
    const file = event.target.files && event.target.files[0]
    if (!file) return
    setUploadError('')
    setUploadMessage('')
    try {
      const importedQuestions = parseQuestionFile(await file.text())
      setQuestions((current) => [...importedQuestions, ...current])
      setUploadMessage(`${importedQuestions.length} question${importedQuestions.length === 1 ? '' : 's'} uploaded successfully.`)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'The question file could not be read.')
    } finally {
      event.target.value = ''
    }
  }

  function downloadTemplate() {
    const template = [{ question: 'What is 2 + 2?', options: ['3', '4', '5', '6'], correctAnswer: '4' }]
    const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'muna-questions-template.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  function addQuestion(event) {
    event.preventDefault()
    const question = {
      id: `Q-${Date.now()}`,
      prompt: newQuestion.prompt.trim(),
      options: newQuestion.options.map((option) => option.trim()),
      correctAnswer: newQuestion.correctAnswer.trim(),
      status: 'Published',
    }
    setQuestions((current) => [question, ...current])
    setNewQuestion({ prompt: '', options: ['', '', '', ''], correctAnswer: '' })
    setQuestionModalOpen(false)
    setUploadMessage('Question added to the question bank.')
  }

  function markAnswerReviewed(answerId) {
    setAnswers((current) => current.map((answer) => answer.id === answerId ? { ...answer, status: 'Reviewed' } : answer))
    setSelectedAnswer(null)
  }

  function markFlagReviewed(flagId) {
    // Reviewing a signal records the admin's review; it does not establish misconduct.
    setFlags((current) => current.map((flag) => flag.id === flagId ? { ...flag, level: 'Reviewed' } : flag))
  }

  function updateMemberRole(memberId, role) {
    setMembers((current) => current.map((member) => member.id === memberId ? { ...member, role } : member))
  }

  function toggleMemberStatus(memberId) {
    setMembers((current) => current.map((member) => member.id === memberId ? { ...member, status: member.status === 'Active' ? 'Suspended' : 'Active' } : member))
  }

  function removeMember(memberId) {
    setMembers((current) => current.filter((member) => member.id !== memberId))
  }

  function createInvitation({ type, email, role, days, maxUses }) {
    const now = new Date()
    const code = `INV-${Math.random().toString(36).slice(2, 8).toUpperCase()}`
    const invite = {
      id: code,
      type,
      email: type === 'email' ? email.trim() : null,
      role,
      created: 'Just now',
      expires: new Date(now.getTime() + days * 86400000).toISOString().slice(0, 10),
      maxUses: type === 'email' ? 1 : Math.max(1, Number(maxUses) || 1),
      uses: 0,
      revoked: false,
    }
    setInvitations((current) => [invite, ...current])
    return invite
  }

  function revokeInvitation(invitationId) {
    setInvitations((current) => current.map((invite) => invite.id === invitationId ? { ...invite, revoked: true } : invite))
  }

  const navigate = (label) => {
    setActiveView(label)
    setSearch('')
  }
  const openQuestionModal = () => setQuestionModalOpen(true)
  const selectAnswer = (answer) => setSelectedAnswer(answer)

  const dashboard = {
    questions, answers, flags, search,
    members, invitations,
    answerFilter, setAnswerFilter,
    pendingAnswers, unresolvedFlags, activeInvites,
    navigate, openQuestionModal, selectAnswer,
    downloadTemplate, handleQuestionUpload,
    uploadMessage, uploadError, fileInput,
    markFlagReviewed,
    updateMemberRole, toggleMemberStatus, removeMember,
    createInvitation, revokeInvitation,
  }

  const badges = { answers: pendingAnswers, flags: unresolvedFlags, invites: activeInvites }
  const activeEntry = dashboardViews.find((view) => view.label === activeView) ?? dashboardViews[0]
  const ActiveView = activeEntry.Component

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#/" aria-label="Back to the Muna landing page"><span className="brand-mark">m</span><span>muna<span className="brand-dot">.</span></span></a>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="main-nav" aria-label="Main navigation">
          {dashboardViews.map((item) => <button key={item.label} className={`nav-item ${activeView === item.label ? 'nav-active' : ''}`} onClick={() => navigate(item.label)}><Icon name={item.icon} size={18} /><span>{item.label}</span>{item.badge && badges[item.badge] > 0 && <span className={`nav-badge${item.badge === 'flags' ? ' nav-badge-warm' : ''}`}>{badges[item.badge]}</span>}</button>)}
        </nav>
        <div className="sidebar-bottom"><div className="help-card"><span className="help-spark">✦</span><strong>Need a hand?</strong><p>Visit the help center for tips and guides.</p><button onClick={() => setUploadMessage('Help center is not connected in this preview.')}>Open help center <span>→</span></button></div><div className="profile"><span className="profile-avatar">AS</span><span className="profile-text"><strong>Alex Morgan</strong><small>Administrator</small></span><span className="profile-menu">···</span></div></div>
      </aside>
      <main className="main-area">
        <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{activeView}</strong></div><div className="topbar-actions"><label className="search-box"><Icon name="search" size={17} /><input type="search" placeholder="Search anything..." value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search current view" /><kbd>⌘ K</kbd></label><button className="icon-button notification-button" aria-label="Notifications"><Icon name="bell" size={19} /><span /></button><span className="top-avatar">AM</span></div></header>
        <div className="content-area"><ActiveView dashboard={dashboard} /></div>
        <footer className="footer"><span>© 2026 Muna learning</span><span>Admin workspace <i /> All systems operational</span></footer>
      </main>
      {questionModalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setQuestionModalOpen(false) }}><section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="question-modal-title"><div className="modal-heading"><div><p className="eyebrow">QUESTION BANK</p><h2 id="question-modal-title">Add a question</h2></div><button className="icon-button" onClick={() => setQuestionModalOpen(false)} aria-label="Close"><Icon name="close" /></button></div><form onSubmit={addQuestion}><label className="form-label">Question<textarea required rows="3" value={newQuestion.prompt} onChange={(event) => setNewQuestion({ ...newQuestion, prompt: event.target.value })} placeholder="Write your question..." /></label><div className="option-grid">{newQuestion.options.map((option, index) => <label className="form-label" key={index}>Option {String.fromCharCode(65 + index)}<input required value={option} onChange={(event) => setNewQuestion({ ...newQuestion, options: newQuestion.options.map((value, optionIndex) => optionIndex === index ? event.target.value : value) })} placeholder={`Enter option ${String.fromCharCode(65 + index)}`} /></label>)}</div><label className="form-label">Correct answer<select required value={newQuestion.correctAnswer} onChange={(event) => setNewQuestion({ ...newQuestion, correctAnswer: event.target.value })}><option value="" disabled>Select the correct option</option>{newQuestion.options.map((option, index) => <option key={index} value={option || ''} disabled={!option.trim()}>{String.fromCharCode(65 + index)} — {option || 'Enter an option first'}</option>)}</select></label><div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setQuestionModalOpen(false)}>Cancel</button><button type="submit" className="button button-primary">Add to question bank</button></div></form></section></div>}
      {selectedAnswer && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedAnswer(null) }}><section className="modal-card answer-modal" role="dialog" aria-modal="true" aria-labelledby="answer-modal-title"><div className="modal-heading"><div><p className="eyebrow">SUBMISSION {selectedAnswer.id}</p><h2 id="answer-modal-title">Review answer</h2></div><button className="icon-button" onClick={() => setSelectedAnswer(null)} aria-label="Close"><Icon name="close" /></button></div><StudentCell name={selectedAnswer.student} initials={selectedAnswer.initials} id={selectedAnswer.submitted} /><div className="answer-detail"><span>ASSESSMENT</span><strong>{selectedAnswer.question}</strong></div><div className="answer-detail"><span>STUDENT&apos;S ANSWER</span><p>{selectedAnswer.answer}</p></div><div className="answer-detail answer-score"><span>SCORE</span><strong>{selectedAnswer.score}</strong></div><div className="modal-actions"><button className="button button-secondary" onClick={() => setSelectedAnswer(null)}>Close</button>{selectedAnswer.status === 'Needs review' && <button className="button button-primary" onClick={() => markAnswerReviewed(selectedAnswer.id)}><Icon name="check" size={16} /> Mark as reviewed</button>}</div></section></div>}
    </div>
  )
}
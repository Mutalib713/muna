import { useEffect, useRef, useState } from 'react'
import { initialMembers, initialInvitations, getInvitationState } from './dashboardData'
import { dashboardViews } from './views/registry'
import Icon from './DashboardIcon'
import AdminLoginScreen from './components/AdminLoginScreen'
import AnswerReviewModal from './components/AnswerReviewModal'
import DashboardSidebar from './components/DashboardSidebar'
import DashboardTopbar from './components/DashboardTopbar'
import FlagReviewModal from './components/FlagReviewModal'
import QuestionModal from './components/QuestionModal'
import HelpCenterModal from './components/HelpCenterModal'
import apiRequest, { cacheCsrfToken, clearCsrfTokenCache, loadDashboardData, requestCsrfToken } from './services/adminApi'
import './Dashboard.css'

// Admin workspace dashboard (originally built by Priscilla Etornam Gbordjuer
// on the admin-dashboard branch; integrated onto main at #/dashboard and
// split into per-view files so views can be built independently).
//
// Each registered view receives the same `dashboard` context object.
export default function AdminDashboard() {
  const [authStatus, setAuthStatus] = useState('checking')
  const [admin, setAdmin] = useState(null)
  const [csrfToken, setCsrfToken] = useState('')
  const [loginEmail, setLoginEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')
  const [loginError, setLoginError] = useState('')
  const [loginLoading, setLoginLoading] = useState(false)
  const [apiError, setApiError] = useState('')
  const [summary, setSummary] = useState({ totalStudents: 0, totalQuestions: 0, weeklyActivity: [] })
  const [mentees, setMentees] = useState([])
  const [assessments, setAssessments] = useState([])
  const [activeView, setActiveView] = useState('Overview')
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState([])
  const [flags, setFlags] = useState([])
  const [members, setMembers] = useState(initialMembers)
  const [invitations, setInvitations] = useState(initialInvitations)
  const [search, setSearch] = useState('')
  const [answerFilter, setAnswerFilter] = useState('All submissions')
  const [selectedAnswer, setSelectedAnswer] = useState(null)
  const [answerFeedback, setAnswerFeedback] = useState('')
  const [answerReviewError, setAnswerReviewError] = useState('')
  const [selectedFlag, setSelectedFlag] = useState(null)
  const [flagReviewNote, setFlagReviewNote] = useState('')
  const [flagReviewError, setFlagReviewError] = useState('')
  const [questionModalOpen, setQuestionModalOpen] = useState(false)
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [newQuestion, setNewQuestion] = useState({ prompt: '', options: ['', '', '', ''], correctAnswer: '' })
  const [editingQuestionId, setEditingQuestionId] = useState(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const fileInput = useRef(null)

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        const { csrfToken: token } = await requestCsrfToken()
        if (!active) return
        setCsrfToken(token)
        try {
          const { user } = await apiRequest('/auth/me')
          const data = await loadDashboardData()
          if (!active) return
          setAdmin(user)
          setQuestions(data.questions)
          setAnswers(data.answers)
          setFlags(data.flags)
          setSummary(data.summary)
          setMentees(data.mentees)
          setAssessments(data.assessments)
          setAuthStatus('authenticated')
        } catch (error) {
          if (error.status === 401) {
            setAuthStatus('unauthenticated')
            return
          }
          throw error
        }
      } catch (error) {
        if (active) {
          setApiError(error.message)
          setAuthStatus('unauthenticated')
        }
      }
    }
    initialize()
    return () => { active = false }
  }, [])

  const pendingAnswers = answers.filter((answer) => answer.status === 'Needs review').length
  const unresolvedFlags = flags.filter((flag) => flag.level !== 'Dismissed').length
  const activeInvites = invitations.filter((invite) => getInvitationState(invite) === 'Active').length

  // Escape closes whichever dialog is open.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      setQuestionModalOpen(false)
      setSelectedAnswer(null)
      setSelectedFlag(null)
      setHelpOpen(false)
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
      const response = await apiRequest('/questions/import', { method: 'POST', body: { questions: importedQuestions }, csrfToken })
      setQuestions((current) => [...response.questions, ...current])
      setSummary((current) => ({ ...current, totalQuestions: current.totalQuestions + response.questions.length }))
      setUploadMessage(`${importedQuestions.length} question${importedQuestions.length === 1 ? '' : 's'} uploaded successfully.`)
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'The question file could not be read.')
      if (error.status === 401) handleApiError(error)
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

  async function addQuestion(event) {
    event.preventDefault()
    const question = {
      prompt: newQuestion.prompt.trim(),
      options: newQuestion.options.map((option) => option.trim()),
      correctAnswer: newQuestion.correctAnswer.trim(),
    }
    setUploadError('')
    try {
      const response = editingQuestionId
        ? await apiRequest(`/questions/${encodeURIComponent(editingQuestionId)}`, { method: 'PATCH', body: question, csrfToken })
        : await apiRequest('/questions', { method: 'POST', body: question, csrfToken })
      setQuestions((current) => editingQuestionId
        ? current.map((item) => item.id === editingQuestionId ? response.question : item)
        : [response.question, ...current])
      if (!editingQuestionId) setSummary((current) => ({ ...current, totalQuestions: current.totalQuestions + 1 }))
      setNewQuestion({ prompt: '', options: ['', '', '', ''], correctAnswer: '' })
      setEditingQuestionId(null)
      setQuestionModalOpen(false)
      setUploadMessage(editingQuestionId ? 'Question updated.' : 'Question added to the question bank.')
    } catch (error) {
      setUploadError(error.message)
      if (error.status === 401) handleApiError(error)
    }
  }

  function editQuestion(question) {
    setEditingQuestionId(question.id)
    setNewQuestion({
      prompt: question.prompt,
      options: [...question.options],
      correctAnswer: question.correctAnswer,
    })
    setUploadError('')
    setQuestionModalOpen(true)
  }

  async function deleteQuestion(questionId) {
    if (!window.confirm('Delete this question?')) return
    try {
      await apiRequest(`/questions/${encodeURIComponent(questionId)}`, { method: 'DELETE', csrfToken })
      setQuestions((current) => current.filter((question) => question.id !== questionId))
      setSummary((current) => ({ ...current, totalQuestions: Math.max(0, current.totalQuestions - 1) }))
      setUploadMessage('Question deleted.')
    } catch (error) {
      setUploadError(error.message)
      if (error.status === 401) handleApiError(error)
    }
  }

  function applyDashboardData(data) {
    setQuestions(data.questions)
    setAnswers(data.answers)
    setFlags(data.flags)
    setSummary(data.summary)
    setMentees(data.mentees)
    setAssessments(data.assessments)
  }

  function handleApiError(error) {
    if (error.status === 401) {
      setAdmin(null)
      setQuestions([])
      setAnswers([])
      setFlags([])
      setAssessments([])
      setMentees([])
      setMembers(initialMembers)
      setInvitations(initialInvitations)
      setSummary({ totalStudents: 0, totalQuestions: 0, weeklyActivity: [] })
      setAuthStatus('unauthenticated')
      clearCsrfTokenCache()
      requestCsrfToken()
        .then(({ csrfToken: token }) => setCsrfToken(token))
        .catch((refreshError) => setApiError(refreshError.message))
    }
    setApiError(error.message)
  }

  async function handleLogin(event) {
    event.preventDefault()
    setLoginLoading(true)
    setLoginError('')
    setApiError('')
    try {
      const { user, csrfToken: token } = await apiRequest('/auth/login', {
        method: 'POST',
        body: { email: loginEmail, password: loginPassword },
        csrfToken,
      })
      cacheCsrfToken(token)
      setCsrfToken(token)
      setAdmin(user)
      applyDashboardData(await loadDashboardData())
      setLoginPassword('')
      setAuthStatus('authenticated')
    } catch (error) {
      setLoginError(error.message)
    } finally {
      setLoginLoading(false)
    }
  }

  async function handleLogout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST', csrfToken })
      setAdmin(null)
      setQuestions([])
      setAnswers([])
      setFlags([])
      setAssessments([])
      setMentees([])
      setMembers(initialMembers)
      setInvitations(initialInvitations)
      setSummary({ totalStudents: 0, totalQuestions: 0, weeklyActivity: [] })
      setAuthStatus('unauthenticated')
      clearCsrfTokenCache()
      const { csrfToken: token } = await requestCsrfToken()
      setCsrfToken(token)
    } catch (error) {
      handleApiError(error)
    }
  }

  async function markAnswerReviewed(answerId, decision = 'Approved', feedback = '') {
    if (decision === 'Revision requested' && !feedback.trim()) {
      setAnswerReviewError('Add feedback before requesting a revision.')
      return
    }
    try {
      const response = await apiRequest(`/answers/${encodeURIComponent(answerId)}/review`, {
        method: 'PATCH',
        body: { decision, feedback },
        csrfToken,
      })
      setAnswers((current) => current.map((answer) => answer.id === answerId ? response.answer : answer))
      setSelectedAnswer(null)
      setAnswerFeedback('')
      setAnswerReviewError('')
    } catch (error) {
      setAnswerReviewError(error.message)
      if (error.status === 401) handleApiError(error)
    }
  }

  function selectFlag(flag) {
    setSelectedFlag(flag)
    setFlagReviewNote(flag.reviewNote || '')
    setFlagReviewError('')
  }

  async function markFlagReviewed(flagId, decision) {
    if (!flagReviewNote.trim()) {
      setFlagReviewError('Add a note to document this review decision.')
      return
    }
    try {
      const response = await apiRequest(`/flags/${encodeURIComponent(flagId)}/review`, {
        method: 'PATCH',
        body: { decision, note: flagReviewNote.trim() },
        csrfToken,
      })
      setFlags((current) => current.map((flag) => flag.id === flagId ? response.flag : flag))
      setSelectedFlag(null)
      setFlagReviewNote('')
      setFlagReviewError('')
    } catch (error) {
      setFlagReviewError(error.message)
      if (error.status === 401) handleApiError(error)
    }
  }

  async function createAssessment(input) {
    try {
      const response = await apiRequest('/assessments', { method: 'POST', body: input, csrfToken })
      setAssessments((current) => [response.assessment, ...current])
    } catch (error) {
      if (error.status === 401) handleApiError(error)
      throw error
    }
  }

  async function updateAssessmentStatus(assessmentId, status) {
    try {
      const response = await apiRequest(`/assessments/${encodeURIComponent(assessmentId)}/status`, {
        method: 'PATCH',
        body: { status },
        csrfToken,
      })
      setAssessments((current) => current.map((assessment) => assessment.id === assessmentId ? response.assessment : assessment))
    } catch (error) {
      if (error.status === 401) handleApiError(error)
      throw error
    }
  }

  async function updateAssessment(assessmentId, input) {
    try {
      const response = await apiRequest(`/assessments/${encodeURIComponent(assessmentId)}`, { method: 'PATCH', body: input, csrfToken })
      setAssessments((current) => current.map((assessment) => assessment.id === assessmentId ? response.assessment : assessment))
    } catch (error) {
      if (error.status === 401) handleApiError(error)
      throw error
    }
  }

  async function deleteAssessment(assessmentId) {
    try {
      await apiRequest(`/assessments/${encodeURIComponent(assessmentId)}`, { method: 'DELETE', csrfToken })
      setAssessments((current) => current.filter((assessment) => assessment.id !== assessmentId))
    } catch (error) {
      if (error.status === 401) handleApiError(error)
      throw error
    }
  }

  async function createMentee(input) {
    try {
      const response = await apiRequest('/mentees', { method: 'POST', body: input, csrfToken })
      setMentees((current) => [response.mentee, ...current].sort((a, b) => a.name.localeCompare(b.name)))
      setSummary((current) => ({ ...current, totalStudents: current.totalStudents + 1 }))
    } catch (error) {
      if (error.status === 401) handleApiError(error)
      throw error
    }
  }

  async function updateMentee(menteeId, input) {
    try {
      const response = await apiRequest(`/mentees/${encodeURIComponent(menteeId)}`, { method: 'PATCH', body: input, csrfToken })
      setMentees((current) => current.map((mentee) => mentee.id === menteeId ? response.mentee : mentee).sort((a, b) => a.name.localeCompare(b.name)))
    } catch (error) {
      if (error.status === 401) handleApiError(error)
      throw error
    }
  }

  async function deleteMentee(menteeId) {
    try {
      await apiRequest(`/mentees/${encodeURIComponent(menteeId)}`, { method: 'DELETE', csrfToken })
      setMentees((current) => current.filter((mentee) => mentee.id !== menteeId))
      setSummary((current) => ({ ...current, totalStudents: Math.max(0, current.totalStudents - 1) }))
    } catch (error) {
      if (error.status === 401) handleApiError(error)
      throw error
    }
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
      maxUses: type === 'email' ? 1 : Math.min(100, Math.max(1, Number(maxUses) || 1)),
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
  const openQuestionModal = () => {
    setEditingQuestionId(null)
    setNewQuestion({ prompt: '', options: ['', '', '', ''], correctAnswer: '' })
    setUploadError('')
    setQuestionModalOpen(true)
  }
  const selectAnswer = (answer) => {
    setSelectedAnswer(answer)
    setAnswerFeedback(answer.feedback || '')
    setAnswerReviewError('')
  }

  const dashboard = {
    questions, answers, flags, search, summary, assessments, mentees, admin,
    members, invitations,
    answerFilter, setAnswerFilter,
    pendingAnswers, unresolvedFlags, activeInvites,
    navigate, openQuestionModal, selectAnswer,
    downloadTemplate, handleQuestionUpload,
    editQuestion, deleteQuestion,
    uploadMessage, uploadError, fileInput,
    selectFlag, markFlagReviewed, flagReviewNote, setFlagReviewNote, flagReviewError,
    createAssessment, updateAssessmentStatus, updateAssessment, deleteAssessment,
    createMentee, updateMentee, deleteMentee,
    updateMemberRole, toggleMemberStatus, removeMember,
    createInvitation, revokeInvitation,
  }

  const badges = { answers: pendingAnswers, flags: unresolvedFlags, invites: activeInvites }
  const activeEntry = dashboardViews.find((view) => view.label === activeView) ?? dashboardViews[0]
  const ActiveView = activeEntry.Component

  if (authStatus === 'checking') {
    return <main className="admin-auth-screen"><div className="admin-auth-card admin-auth-loading"><span className="brand-mark">m</span><strong>Loading Muna workspace…</strong></div></main>
  }

  if (authStatus !== 'authenticated') {
    return <AdminLoginScreen email={loginEmail} password={loginPassword} error={loginError || apiError} loading={loginLoading} onEmailChange={setLoginEmail} onPasswordChange={setLoginPassword} onSubmit={handleLogin} />
  }

  return (
    <div className="app-shell">
      <DashboardSidebar views={dashboardViews} activeView={activeView} badges={badges} admin={admin} onNavigate={navigate} onHelp={() => setHelpOpen(true)} />
      <main className="main-area">
        <DashboardTopbar activeView={activeView} search={search} admin={admin} onSearch={setSearch} onLogout={handleLogout} />
        {apiError && <div className="api-error" role="alert"><span>{apiError}</span><button onClick={() => setApiError('')} aria-label="Dismiss error"><Icon name="close" size={15} /></button></div>}
        <div className="content-area"><ActiveView dashboard={dashboard} /></div>
        <footer className="footer"><span>© 2026 Muna learning</span><span>Admin workspace <i /> All systems operational</span></footer>
      </main>
      {questionModalOpen && <QuestionModal question={newQuestion} editing={Boolean(editingQuestionId)} onQuestionChange={setNewQuestion} error={uploadError} onClose={() => { setQuestionModalOpen(false); setEditingQuestionId(null) }} onSubmit={addQuestion} />}
      {selectedAnswer && <AnswerReviewModal answer={selectedAnswer} feedback={answerFeedback} error={answerReviewError} onFeedbackChange={(feedback) => { setAnswerFeedback(feedback); setAnswerReviewError('') }} onClose={() => setSelectedAnswer(null)} onReview={(decision) => markAnswerReviewed(selectedAnswer.id, decision, answerFeedback)} />}
      {selectedFlag && <FlagReviewModal flag={selectedFlag} note={flagReviewNote} error={flagReviewError} onNoteChange={(note) => { setFlagReviewNote(note); setFlagReviewError('') }} onClose={() => setSelectedFlag(null)} onReview={(decision) => markFlagReviewed(selectedFlag.id, decision)} />}
      {helpOpen && <HelpCenterModal onClose={() => setHelpOpen(false)} onNavigate={navigate} />}
    </div>
  )
}
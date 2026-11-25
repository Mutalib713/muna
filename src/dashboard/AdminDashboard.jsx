import { useEffect, useRef, useState } from 'react'
import { getInvitationState } from './dashboardData'
import { draftToPayload, newQuestionDraft, questionToDraft } from './questionTypes'
import { dashboardViews } from './views/registry'
import Icon from './DashboardIcon'
import AdminLoginScreen from './components/AdminLoginScreen'
import AnswerReviewModal from './components/AnswerReviewModal'
import DashboardSidebar from './components/DashboardSidebar'
import DashboardTopbar from './components/DashboardTopbar'
import FlagReviewModal from './components/FlagReviewModal'
import QuestionModal from './components/QuestionModal'
import HelpCenterModal from './components/HelpCenterModal'
import apiRequest, { cacheCsrfToken, clearCsrfTokenCache, loadDashboardData, loadResourcePage, requestCsrfToken } from './services/adminApi'
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
  const [setupForm, setSetupForm] = useState({ name: '', email: '', password: '', confirmPassword: '', setupCode: '' })
  const [setupError, setSetupError] = useState('')
  const [setupLoading, setSetupLoading] = useState(false)
  const [apiError, setApiError] = useState('')
  const [summary, setSummary] = useState({ totalStudents: 0, totalQuestions: 0, weeklyActivity: [] })
  const [mentees, setMentees] = useState([])
  const [assessments, setAssessments] = useState([])
  const [activeView, setActiveView] = useState('Overview')
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState([])
  const [flags, setFlags] = useState([])
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [pagination, setPagination] = useState({})
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
  const [newQuestion, setNewQuestion] = useState(() => newQuestionDraft())
  const [editingQuestionId, setEditingQuestionId] = useState(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const fileInput = useRef(null)

  useEffect(() => {
    let active = true
    async function initialize() {
      try {
        const [{ csrfToken: token }, { setupRequired }] = await Promise.all([
          requestCsrfToken(),
          apiRequest('/auth/status'),
        ])
        if (!active) return
        setCsrfToken(token)
        if (setupRequired) {
          setAuthStatus('setup-required')
          return
        }
        try {
          const { user } = await apiRequest('/auth/me')
          const data = await loadDashboardData()
          if (!active) return
          setAdmin(user)
          applyDashboardData(data)
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
      const type = item.type || 'mcq'
      if (type === 'mcq' || type === 'multi_select') {
        if (!Array.isArray(item.options) || item.options.length < 2 || item.options.some((option) => typeof option !== 'string' || !option.trim())) {
          throw new Error(`Question ${index + 1} needs at least two non-empty options.`)
        }
      }
      if (type === 'mcq' && (typeof item.correctAnswer !== 'string' || !item.correctAnswer.trim())) {
        throw new Error(`Question ${index + 1} needs a correctAnswer field.`)
      }
      return {
        ...item,
        type,
        prompt: prompt.trim(),
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
    const template = [
      { type: 'mcq', prompt: 'What is 2 + 2?', options: ['3', '4', '5', '6'], correctAnswer: '4', points: 2, difficulty: 'Easy' },
      { type: 'multi_select', prompt: 'Select the prime numbers.', options: ['2', '3', '4', '5'], correctAnswers: ['2', '3', '5'], partialCredit: true, points: 3 },
      { type: 'true_false', prompt: 'HTTP is stateless.', correctAnswer: 'True', points: 1 },
      { type: 'short_answer', prompt: 'Which browser kiosk app integrates with Muna?', acceptedAnswers: ['Safe Exam Browser', 'SEB'], points: 2 },
      { type: 'theory', prompt: 'Explain why grading must run server-side.', points: 10, rubric: [{ criterion: 'Security boundary', points: 5, description: 'Explains client code inspection.' }, { criterion: 'Server authority', points: 5, description: 'Explains authoritative grading.' }] },
      { type: 'drawing', prompt: 'Sketch the attempt lifecycle.', points: 5, rubric: [{ criterion: 'States', points: 5, description: 'Shows Active, Submitted, Terminated.' }] },
    ]
    const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'muna-questions-template.json'
    link.click()
    URL.revokeObjectURL(url)
  }

  async function addQuestion(event) {
    event.preventDefault()
    const question = draftToPayload(newQuestion)
    setUploadError('')
    try {
      const response = editingQuestionId
        ? await apiRequest(`/questions/${encodeURIComponent(editingQuestionId)}`, { method: 'PATCH', body: question, csrfToken })
        : await apiRequest('/questions', { method: 'POST', body: question, csrfToken })
      setQuestions((current) => editingQuestionId
        ? current.map((item) => item.id === editingQuestionId ? response.question : item)
        : [response.question, ...current])
      if (!editingQuestionId) setSummary((current) => ({ ...current, totalQuestions: current.totalQuestions + 1 }))
      setNewQuestion(newQuestionDraft())
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
    setNewQuestion(questionToDraft(question))
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
    setMembers(data.members)
    setInvitations(data.invitations)
    setPagination(data.pagination || {})
  }

  function clearWorkspaceState() {
    setAdmin(null)
    setQuestions([])
    setAnswers([])
    setFlags([])
    setAssessments([])
    setMentees([])
    setMembers([])
    setInvitations([])
    setPagination({})
    setSummary({ totalStudents: 0, totalQuestions: 0, weeklyActivity: [] })
  }

  function handleApiError(error) {
    if (error.status === 401) {
      clearWorkspaceState()
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

  async function handleSetup(event) {
    event.preventDefault()
    setSetupLoading(true)
    setSetupError('')
    setApiError('')
    try {
      const { user, csrfToken: token } = await apiRequest('/auth/setup', {
        method: 'POST',
        body: setupForm,
        csrfToken,
      })
      cacheCsrfToken(token)
      setCsrfToken(token)
      setAdmin(user)
      applyDashboardData(await loadDashboardData())
      setSetupForm({ name: '', email: '', password: '', confirmPassword: '', setupCode: '' })
      setAuthStatus('authenticated')
    } catch (error) {
      setSetupError(error.message)
    } finally {
      setSetupLoading(false)
    }
  }

  async function handleLogout() {
    try {
      await apiRequest('/auth/logout', { method: 'POST', csrfToken })
      clearWorkspaceState()
      setAuthStatus('unauthenticated')
      clearCsrfTokenCache()
      const { csrfToken: token } = await requestCsrfToken()
      setCsrfToken(token)
    } catch (error) {
      handleApiError(error)
    }
  }

  async function markAnswerReviewed(answerId, decision = 'Approved', feedback = '', itemGrades = []) {
    if (decision === 'Revision requested' && !feedback.trim()) {
      setAnswerReviewError('Add feedback before requesting a revision.')
      return
    }
    try {
      const response = await apiRequest(`/answers/${encodeURIComponent(answerId)}/review`, {
        method: 'PATCH',
        body: { decision, feedback, itemGrades },
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

  async function releaseAssessmentResults(assessmentId) {
    try {
      const response = await apiRequest(`/assessments/${encodeURIComponent(assessmentId)}/release-results`, {
        method: 'POST',
        csrfToken,
      })
      setAssessments((current) => current.map((assessment) => assessment.id === assessmentId ? response.assessment : assessment))
    } catch (error) {
      if (error.status === 401) handleApiError(error)
      throw error
    }
  }

  async function grantExtraAttempts(assessmentId, input) {
    try {
      const response = await apiRequest(`/assessments/${encodeURIComponent(assessmentId)}/extra-attempts`, {
        method: 'POST',
        body: input,
        csrfToken,
      })
      setAssessments((current) => current.map((assessment) => assessment.id === assessmentId ? response.assessment : assessment))
      return response.grant
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

  async function updateMemberRole(memberId, role) {
    try {
      const response = await apiRequest(`/members/${encodeURIComponent(memberId)}`, {
        method: 'PATCH',
        body: { role },
        csrfToken,
      })
      setMembers((current) => current.map((member) => member.id === memberId ? response.member : member))
      if (role === 'Mentee') {
        const [menteesData, summaryData] = await Promise.all([apiRequest('/mentees'), apiRequest('/dashboard/summary')])
        setMentees(menteesData.mentees)
        setSummary(summaryData)
      }
    } catch (error) {
      if (error.status === 401) handleApiError(error)
      throw error
    }
  }

  async function toggleMemberStatus(memberId) {
    const existing = members.find((member) => member.id === memberId)
    if (!existing) return
    const nextStatus = existing.status === 'Active' ? 'Suspended' : 'Active'
    try {
      const response = await apiRequest(`/members/${encodeURIComponent(memberId)}`, {
        method: 'PATCH',
        body: { status: nextStatus },
        csrfToken,
      })
      setMembers((current) => current.map((member) => member.id === memberId ? response.member : member))
    } catch (error) {
      if (error.status === 401) handleApiError(error)
      throw error
    }
  }

  async function removeMember(memberId) {
    try {
      await apiRequest(`/members/${encodeURIComponent(memberId)}`, { method: 'DELETE', csrfToken })
      setMembers((current) => current.filter((member) => member.id !== memberId))
    } catch (error) {
      if (error.status === 401) handleApiError(error)
      throw error
    }
  }

  async function createInvitation({ type, email, role, days, maxUses }) {
    try {
      const response = await apiRequest('/invitations', {
        method: 'POST',
        body: { type, email, role, days, maxUses },
        csrfToken,
      })
      setInvitations((current) => [response.invitation, ...current])
      return response.invitation
    } catch (error) {
      if (error.status === 401) handleApiError(error)
      throw error
    }
  }

  async function revokeInvitation(invitationId) {
    try {
      const response = await apiRequest(`/invitations/${encodeURIComponent(invitationId)}`, {
        method: 'DELETE',
        csrfToken,
      })
      setInvitations((current) => current.map((invite) => invite.id === invitationId ? response.invitation : invite))
    } catch (error) {
      if (error.status === 401) handleApiError(error)
      throw error
    }
  }

  async function goToPage(resource, page) {
    try {
      const data = await loadResourcePage(resource, page)
      if (resource === 'questions') setQuestions(data.questions)
      else if (resource === 'answers') setAnswers(data.answers)
      else if (resource === 'flags') setFlags(data.flags)
      else if (resource === 'mentees') setMentees(data.mentees)
      else if (resource === 'assessments') setAssessments(data.assessments)
      if (data.pagination) {
        setPagination((current) => ({ ...current, [resource]: data.pagination }))
      }
    } catch (error) {
      handleApiError(error)
    }
  }

  const navigate = (label) => {
    setActiveView(label)
    setSearch('')
  }
  const openQuestionModal = () => {
    setEditingQuestionId(null)
    setNewQuestion(newQuestionDraft())
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
    members, invitations, pagination, goToPage,
    answerFilter, setAnswerFilter,
    pendingAnswers, unresolvedFlags, activeInvites,
    navigate, openQuestionModal, selectAnswer,
    downloadTemplate, handleQuestionUpload,
    editQuestion, deleteQuestion,
    uploadMessage, uploadError, fileInput,
    selectFlag, markFlagReviewed, flagReviewNote, setFlagReviewNote, flagReviewError,
    createAssessment, updateAssessmentStatus, updateAssessment, deleteAssessment,
    releaseAssessmentResults, grantExtraAttempts,
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
    return <AdminLoginScreen
      setupRequired={authStatus === 'setup-required'}
      email={loginEmail}
      password={loginPassword}
      setupForm={setupForm}
      error={authStatus === 'setup-required' ? setupError || apiError : loginError || apiError}
      loading={authStatus === 'setup-required' ? setupLoading : loginLoading}
      onEmailChange={setLoginEmail}
      onPasswordChange={setLoginPassword}
      onSetupFormChange={(field, value) => {
        setSetupForm((current) => ({ ...current, [field]: value }))
        setSetupError('')
      }}
      onSubmit={authStatus === 'setup-required' ? handleSetup : handleLogin}
    />
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
      {selectedAnswer && <AnswerReviewModal answer={selectedAnswer} feedback={answerFeedback} error={answerReviewError} onFeedbackChange={(feedback) => { setAnswerFeedback(feedback); setAnswerReviewError('') }} onClose={() => setSelectedAnswer(null)} onReview={(decision, itemGrades) => markAnswerReviewed(selectedAnswer.id, decision, answerFeedback, itemGrades)} />}
      {selectedFlag && <FlagReviewModal flag={selectedFlag} note={flagReviewNote} error={flagReviewError} onNoteChange={(note) => { setFlagReviewNote(note); setFlagReviewError('') }} onClose={() => setSelectedFlag(null)} onReview={(decision) => markFlagReviewed(selectedFlag.id, decision)} />}
      {helpOpen && <HelpCenterModal onClose={() => setHelpOpen(false)} onNavigate={navigate} />}
    </div>
  )
}
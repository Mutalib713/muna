import { useCallback, useState } from 'react'
import { getInvitationState } from '../dashboardData'
import { draftToPayload, newQuestionDraft, questionToDraft } from '../questionTypes'
import { downloadQuestionTemplate, parseQuestionFile } from '../questionImport'
import apiRequest, { loadResourcePage } from '../services/adminApi'
import { useWorkspaceAuth } from './useWorkspaceAuth'

/** Manage workspace session, active organisation context, and dashboard CRUD operations. */
export function useDashboardWorkspace(orgSlug = '') {
  const [summary, setSummary] = useState({ totalStudents: 0, totalQuestions: 0, weeklyActivity: [] })
  const [mentees, setMentees] = useState([])
  const [assessments, setAssessments] = useState([])
  const [questions, setQuestions] = useState([])
  const [answers, setAnswers] = useState([])
  const [flags, setFlags] = useState([])
  const [members, setMembers] = useState([])
  const [invitations, setInvitations] = useState([])
  const [pagination, setPagination] = useState({})
  const [uploadMessage, setUploadMessage] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [newQuestion, setNewQuestion] = useState(() => newQuestionDraft())
  const [editingQuestionId, setEditingQuestionId] = useState(null)
  const [questionModalOpen, setQuestionModalOpen] = useState(false)
  const [selectedAnswer, setSelectedAnswer] = useState(null)
  const [answerFeedback, setAnswerFeedback] = useState('')
  const [answerReviewError, setAnswerReviewError] = useState('')
  const [selectedFlag, setSelectedFlag] = useState(null)
  const [flagReviewNote, setFlagReviewNote] = useState('')
  const [flagReviewError, setFlagReviewError] = useState('')

  const applyDashboardData = useCallback((data) => {
    setQuestions(data.questions)
    setAnswers(data.answers)
    setFlags(data.flags)
    setSummary(data.summary)
    setMentees(data.mentees)
    setAssessments(data.assessments)
    setMembers(data.members)
    setInvitations(data.invitations)
    setPagination(data.pagination || {})
  }, [])

  const clearDomainState = useCallback(() => {
    setQuestions([])
    setAnswers([])
    setFlags([])
    setAssessments([])
    setMentees([])
    setMembers([])
    setInvitations([])
    setPagination({})
    setSummary({ totalStudents: 0, totalQuestions: 0, weeklyActivity: [] })
  }, [])

  const auth = useWorkspaceAuth(orgSlug, { applyDashboardData, clearDomainState })
  const { csrfToken, handleApiError, withAuth } = auth

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

  const createAssessment = (input) => withAuth(async () => {
    const response = await apiRequest('/assessments', { method: 'POST', body: input, csrfToken })
    setAssessments((current) => [response.assessment, ...current])
  })

  const updateAssessmentStatus = (assessmentId, status) => withAuth(async () => {
    const response = await apiRequest(`/assessments/${encodeURIComponent(assessmentId)}/status`, {
      method: 'PATCH',
      body: { status },
      csrfToken,
    })
    setAssessments((current) => current.map((assessment) => assessment.id === assessmentId ? response.assessment : assessment))
  })

  const updateAssessment = (assessmentId, input) => withAuth(async () => {
    const response = await apiRequest(`/assessments/${encodeURIComponent(assessmentId)}`, { method: 'PATCH', body: input, csrfToken })
    setAssessments((current) => current.map((assessment) => assessment.id === assessmentId ? response.assessment : assessment))
  })

  const deleteAssessment = (assessmentId) => withAuth(async () => {
    await apiRequest(`/assessments/${encodeURIComponent(assessmentId)}`, { method: 'DELETE', csrfToken })
    setAssessments((current) => current.filter((assessment) => assessment.id !== assessmentId))
  })

  const releaseAssessmentResults = (assessmentId) => withAuth(async () => {
    const response = await apiRequest(`/assessments/${encodeURIComponent(assessmentId)}/release-results`, { method: 'POST', csrfToken })
    setAssessments((current) => current.map((assessment) => assessment.id === assessmentId ? response.assessment : assessment))
  })

  const grantExtraAttempts = (assessmentId, input) => withAuth(async () => {
    const response = await apiRequest(`/assessments/${encodeURIComponent(assessmentId)}/extra-attempts`, { method: 'POST', body: input, csrfToken })
    setAssessments((current) => current.map((assessment) => assessment.id === assessmentId ? response.assessment : assessment))
    return response.grant
  })

  const createMentee = (input) => withAuth(async () => {
    const response = await apiRequest('/mentees', { method: 'POST', body: input, csrfToken })
    setMentees((current) => [response.mentee, ...current].sort((a, b) => a.name.localeCompare(b.name)))
    setSummary((current) => ({ ...current, totalStudents: current.totalStudents + 1 }))
  })

  const updateMentee = (menteeId, input) => withAuth(async () => {
    const response = await apiRequest(`/mentees/${encodeURIComponent(menteeId)}`, { method: 'PATCH', body: input, csrfToken })
    setMentees((current) => current.map((mentee) => mentee.id === menteeId ? response.mentee : mentee).sort((a, b) => a.name.localeCompare(b.name)))
  })

  const deleteMentee = (menteeId) => withAuth(async () => {
    await apiRequest(`/mentees/${encodeURIComponent(menteeId)}`, { method: 'DELETE', csrfToken })
    setMentees((current) => current.filter((mentee) => mentee.id !== menteeId))
    setSummary((current) => ({ ...current, totalStudents: Math.max(0, current.totalStudents - 1) }))
  })

  const updateMemberRole = (memberId, role) => withAuth(async () => {
    const response = await apiRequest(`/members/${encodeURIComponent(memberId)}`, { method: 'PATCH', body: { role }, csrfToken })
    setMembers((current) => current.map((member) => member.id === memberId ? response.member : member))
    if (role === 'Mentee') {
      const [menteesData, summaryData] = await Promise.all([apiRequest('/mentees'), apiRequest('/dashboard/summary')])
      setMentees(menteesData.mentees)
      setSummary(summaryData)
    }
  })

  const toggleMemberStatus = (memberId) => withAuth(async () => {
    const existing = members.find((member) => member.id === memberId)
    if (!existing) return
    const nextStatus = existing.status === 'Active' ? 'Suspended' : 'Active'
    const response = await apiRequest(`/members/${encodeURIComponent(memberId)}`, { method: 'PATCH', body: { status: nextStatus }, csrfToken })
    setMembers((current) => current.map((member) => member.id === memberId ? response.member : member))
  })

  const removeMember = (memberId) => withAuth(async () => {
    await apiRequest(`/members/${encodeURIComponent(memberId)}`, { method: 'DELETE', csrfToken })
    setMembers((current) => current.filter((member) => member.id !== memberId))
  })

  const createInvitation = ({ type, email, role, days, maxUses }) => withAuth(async () => {
    const response = await apiRequest('/invitations', { method: 'POST', body: { type, email, role, days, maxUses }, csrfToken })
    setInvitations((current) => [response.invitation, ...current])
    return response.invitation
  })

  const revokeInvitation = (invitationId) => withAuth(async () => {
    const response = await apiRequest(`/invitations/${encodeURIComponent(invitationId)}`, { method: 'DELETE', csrfToken })
    setInvitations((current) => current.map((invite) => invite.id === invitationId ? response.invitation : invite))
  })

  async function goToPage(resource, page) {
    try {
      const data = await loadResourcePage(resource, page)
      if (resource === 'questions') setQuestions(data.questions)
      else if (resource === 'answers') setAnswers(data.answers)
      else if (resource === 'flags') setFlags(data.flags)
      else if (resource === 'mentees') setMentees(data.mentees)
      else if (resource === 'assessments') setAssessments(data.assessments)
      if (data.pagination) setPagination((current) => ({ ...current, [resource]: data.pagination }))
    } catch (error) {
      handleApiError(error)
    }
  }

  return {
    authStatus: auth.authStatus,
    admin: auth.admin,
    organisations: auth.organisations,
    activeOrg: auth.activeOrg,
    devVerifyToken: auth.devVerifyToken,
    loginEmail: auth.loginEmail,
    setLoginEmail: auth.setLoginEmail,
    loginPassword: auth.loginPassword,
    setLoginPassword: auth.setLoginPassword,
    loginError: auth.loginError,
    loginLoading: auth.loginLoading,
    setupForm: auth.setupForm,
    setSetupForm: auth.setSetupForm,
    setSetupError: auth.setSetupError,
    setupError: auth.setupError,
    setupLoading: auth.setupLoading,
    apiError: auth.apiError,
    setApiError: auth.setApiError,
    questions,
    answers,
    flags,
    summary,
    mentees,
    assessments,
    members,
    invitations,
    pagination,
    pendingAnswers: answers.filter((answer) => answer.status === 'Needs review').length,
    unresolvedFlags: flags.filter((flag) => flag.level !== 'Dismissed').length,
    activeInvites: invitations.filter((invite) => getInvitationState(invite) === 'Active').length,
    uploadMessage,
    uploadError,
    newQuestion,
    setNewQuestion,
    editingQuestionId,
    setEditingQuestionId,
    questionModalOpen,
    setQuestionModalOpen,
    selectedAnswer,
    setSelectedAnswer,
    answerFeedback,
    setAnswerFeedback,
    answerReviewError,
    setAnswerReviewError,
    selectedFlag,
    setSelectedFlag,
    flagReviewNote,
    setFlagReviewNote,
    flagReviewError,
    setFlagReviewError,
    handleLogin: auth.handleLogin,
    handleSetup: auth.handleSetup,
    handleLogout: auth.handleLogout,
    handleResendVerification: auth.handleResendVerification,
    selectOrganisation: auth.selectOrganisation,
    createOrganisation: auth.createOrganisation,
    goToPage,
    downloadTemplate: downloadQuestionTemplate,
    handleQuestionUpload,
    addQuestion,
    editQuestion: (question) => {
      setEditingQuestionId(question.id)
      setNewQuestion(questionToDraft(question))
      setUploadError('')
      setQuestionModalOpen(true)
    },
    deleteQuestion,
    openQuestionModal: () => {
      setEditingQuestionId(null)
      setNewQuestion(newQuestionDraft())
      setUploadError('')
      setQuestionModalOpen(true)
    },
    selectAnswer: (answer) => {
      setSelectedAnswer(answer)
      setAnswerFeedback(answer.feedback || '')
      setAnswerReviewError('')
    },
    markAnswerReviewed,
    selectFlag: (flag) => {
      setSelectedFlag(flag)
      setFlagReviewNote(flag.reviewNote || '')
      setFlagReviewError('')
    },
    markFlagReviewed,
    createAssessment,
    updateAssessmentStatus,
    updateAssessment,
    deleteAssessment,
    releaseAssessmentResults,
    grantExtraAttempts,
    createMentee,
    updateMentee,
    deleteMentee,
    updateMemberRole,
    toggleMemberStatus,
    removeMember,
    createInvitation,
    revokeInvitation,
  }
}

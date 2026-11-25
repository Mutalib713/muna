import { useEffect, useState } from 'react'
import { getInvitationState } from '../dashboardData'
import { draftToPayload, newQuestionDraft, questionToDraft } from '../questionTypes'
import { downloadQuestionTemplate, parseQuestionFile } from '../questionImport'
import apiRequest, {
  cacheCsrfToken,
  clearCsrfTokenCache,
  loadDashboardData,
  loadResourcePage,
  requestCsrfToken,
  setActiveOrganisationId,
} from '../services/adminApi'

/** Manage workspace session, active organisation context, and dashboard CRUD operations. */
export function useDashboardWorkspace(orgSlug = '') {
  const [authStatus, setAuthStatus] = useState('checking')
  const [admin, setAdmin] = useState(null)
  const [organisations, setOrganisations] = useState([])
  const [activeOrg, setActiveOrg] = useState(null)
  const [devVerifyToken, setDevVerifyToken] = useState('')
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
    setOrganisations([])
    setActiveOrg(null)
    setActiveOrganisationId('')
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
    } else if (error.payload?.emailVerificationRequired) {
      setAuthStatus('verification-required')
    }
    setApiError(error.message)
  }

  async function withAuth(task) {
    try {
      return await task()
    } catch (error) {
      if (error.status === 401 || error.payload?.emailVerificationRequired) handleApiError(error)
      throw error
    }
  }

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
        if (setupRequired && !orgSlug) {
          setAuthStatus('setup-required')
          return
        }
        try {
          const me = await apiRequest('/auth/me')
          if (!active) return
          const user = me.user
          const orgList = me.organisations || []
          setAdmin(user)
          setOrganisations(orgList)
          if (!user.emailVerified) {
            setAuthStatus('verification-required')
            return
          }
          const matchedOrg = orgSlug
            ? orgList.find((org) => org.slug === orgSlug)
            : (me.organisation || orgList.find((org) => ['Owner', 'Admin', 'Mentor'].includes(org.role)) || orgList[0])
          if (!matchedOrg) {
            setApiError('You do not have access to this organisation.')
            setAuthStatus('unauthenticated')
            return
          }
          if (!['Owner', 'Admin', 'Mentor'].includes(matchedOrg.role)) {
            if (matchedOrg.menteeId) {
              window.location.assign(`/#/learner/${encodeURIComponent(matchedOrg.menteeId)}`)
              return
            }
            setApiError('This workspace requires an Owner, Admin, or Mentor role.')
            setAuthStatus('unauthenticated')
            return
          }
          setActiveOrg(matchedOrg)
          setActiveOrganisationId(matchedOrg.id)
          const data = await loadDashboardData()
          if (!active) return
          applyDashboardData(data)
          setAuthStatus('authenticated')
        } catch (error) {
          if (error.status === 401) {
            setAuthStatus('unauthenticated')
            return
          }
          if (error.payload?.emailVerificationRequired) {
            setAuthStatus('verification-required')
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
  }, [orgSlug])

  async function selectOrganisation(nextOrgId) {
    setApiError('')
    const { organisation, organisations: nextOrgs } = await apiRequest('/organisations/switch', {
      method: 'POST',
      body: { organisationId: nextOrgId },
      csrfToken,
    })
    setOrganisations(nextOrgs)
    setActiveOrg(organisation)
    setActiveOrganisationId(organisation.id)
    if (orgSlug) window.history.pushState({}, '', `/o/${encodeURIComponent(organisation.slug)}`)
    applyDashboardData(await loadDashboardData())
  }

  async function createOrganisation(name) {
    const { organisation } = await apiRequest('/organisations', { method: 'POST', body: { name }, csrfToken })
    const { organisations: nextOrgs } = await apiRequest('/organisations')
    setOrganisations(nextOrgs)
    setActiveOrg(organisation)
    setActiveOrganisationId(organisation.id)
    if (orgSlug) window.history.pushState({}, '', `/o/${encodeURIComponent(organisation.slug)}`)
    applyDashboardData(await loadDashboardData())
  }

  async function handleResendVerification() {
    setApiError('')
    try {
      const data = await apiRequest('/auth/resend-verification', { method: 'POST', csrfToken })
      if (data.verificationToken) setDevVerifyToken(data.verificationToken)
      setApiError('Verification email re-issued. Verify your email before opening the workspace.')
    } catch (error) {
      setApiError(error.message)
    }
  }

  async function handleLogin(event) {
    event.preventDefault()
    setLoginLoading(true)
    setLoginError('')
    setApiError('')
    try {
      const { user, organisation, organisations: orgList = [], csrfToken: token } = await apiRequest('/auth/login', {
        method: 'POST',
        body: { email: loginEmail, password: loginPassword },
        csrfToken,
      })
      cacheCsrfToken(token)
      setCsrfToken(token)
      setAdmin(user)
      setOrganisations(orgList)
      setLoginPassword('')
      if (!user.emailVerified) {
        setAuthStatus('verification-required')
        return
      }
      const targetOrg = orgSlug ? orgList.find((org) => org.slug === orgSlug) : (organisation || orgList[0])
      if (!targetOrg) {
        setLoginError('You do not have access to this organisation.')
        return
      }
      if (!['Owner', 'Admin', 'Mentor'].includes(targetOrg.role)) {
        if (targetOrg.menteeId) {
          window.location.assign(`/#/learner/${encodeURIComponent(targetOrg.menteeId)}`)
          return
        }
        setLoginError('Workspace access requires an Owner, Admin, or Mentor role.')
        return
      }
      setActiveOrg(targetOrg)
      setActiveOrganisationId(targetOrg.id)
      applyDashboardData(await loadDashboardData())
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
      const { user, organisation, organisations: orgList = [], csrfToken: token } = await apiRequest('/auth/setup', {
        method: 'POST',
        body: setupForm,
        csrfToken,
      })
      cacheCsrfToken(token)
      setCsrfToken(token)
      setAdmin(user)
      setOrganisations(orgList)
      setActiveOrg(organisation)
      if (organisation?.id) setActiveOrganisationId(organisation.id)
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
    authStatus,
    admin,
    organisations,
    activeOrg,
    devVerifyToken,
    loginEmail,
    setLoginEmail,
    loginPassword,
    setLoginPassword,
    loginError,
    loginLoading,
    setupForm,
    setSetupForm,
    setSetupError,
    setupError,
    setupLoading,
    apiError,
    setApiError,
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
    handleLogin,
    handleSetup,
    handleLogout,
    handleResendVerification,
    selectOrganisation,
    createOrganisation,
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

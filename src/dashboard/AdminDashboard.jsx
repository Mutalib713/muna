import { useEffect, useRef, useState } from 'react'
import { dashboardViews } from './views/registry'
import Icon from './DashboardIcon'
import AdminLoginScreen from './components/AdminLoginScreen'
import AnswerReviewModal from './components/AnswerReviewModal'
import DashboardSidebar from './components/DashboardSidebar'
import DashboardTopbar from './components/DashboardTopbar'
import FlagReviewModal from './components/FlagReviewModal'
import HelpCenterModal from './components/HelpCenterModal'
import QuestionModal from './components/QuestionModal'
import VerificationRequiredScreen from './components/VerificationRequiredScreen'
import { useDashboardWorkspace } from './hooks/useDashboardWorkspace'
import './Dashboard.css'

/** Mentor/admin organisation workspace shell rendered at `/o/:slug` or `#/dashboard`. */
export default function AdminDashboard({ orgSlug = '' }) {
  const ws = useDashboardWorkspace(orgSlug)
  const [activeView, setActiveView] = useState('Overview')
  const [search, setSearch] = useState('')
  const [answerFilter, setAnswerFilter] = useState('All submissions')
  const [helpOpen, setHelpOpen] = useState(false)
  const fileInput = useRef(null)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      ws.setQuestionModalOpen(false)
      ws.setSelectedAnswer(null)
      ws.setSelectedFlag(null)
      setHelpOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [ws])

  const navigate = (label) => {
    setActiveView(label)
    setSearch('')
  }

  const dashboard = {
    questions: ws.questions,
    answers: ws.answers,
    flags: ws.flags,
    search,
    summary: ws.summary,
    assessments: ws.assessments,
    mentees: ws.mentees,
    admin: ws.admin,
    members: ws.members,
    invitations: ws.invitations,
    pagination: ws.pagination,
    goToPage: ws.goToPage,
    answerFilter,
    setAnswerFilter,
    pendingAnswers: ws.pendingAnswers,
    unresolvedFlags: ws.unresolvedFlags,
    activeInvites: ws.activeInvites,
    navigate,
    openQuestionModal: ws.openQuestionModal,
    selectAnswer: ws.selectAnswer,
    downloadTemplate: ws.downloadTemplate,
    handleQuestionUpload: ws.handleQuestionUpload,
    editQuestion: ws.editQuestion,
    deleteQuestion: ws.deleteQuestion,
    uploadMessage: ws.uploadMessage,
    uploadError: ws.uploadError,
    fileInput,
    selectFlag: ws.selectFlag,
    markFlagReviewed: ws.markFlagReviewed,
    flagReviewNote: ws.flagReviewNote,
    setFlagReviewNote: ws.setFlagReviewNote,
    flagReviewError: ws.flagReviewError,
    createAssessment: ws.createAssessment,
    updateAssessmentStatus: ws.updateAssessmentStatus,
    updateAssessment: ws.updateAssessment,
    deleteAssessment: ws.deleteAssessment,
    releaseAssessmentResults: ws.releaseAssessmentResults,
    grantExtraAttempts: ws.grantExtraAttempts,
    createMentee: ws.createMentee,
    updateMentee: ws.updateMentee,
    deleteMentee: ws.deleteMentee,
    updateMemberRole: ws.updateMemberRole,
    toggleMemberStatus: ws.toggleMemberStatus,
    removeMember: ws.removeMember,
    createInvitation: ws.createInvitation,
    revokeInvitation: ws.revokeInvitation,
  }

  const badges = { answers: ws.pendingAnswers, flags: ws.unresolvedFlags, invites: ws.activeInvites }
  const activeEntry = dashboardViews.find((view) => view.label === activeView) ?? dashboardViews[0]
  const ActiveView = activeEntry.Component

  if (ws.authStatus === 'checking') {
    return <main className="admin-auth-screen"><div className="admin-auth-card admin-auth-loading"><span className="brand-mark">m</span><strong>Loading Muna workspace…</strong></div></main>
  }

  if (ws.authStatus === 'verification-required') {
    return (
      <VerificationRequiredScreen
        email={ws.admin?.email}
        apiError={ws.apiError}
        devVerifyToken={ws.devVerifyToken}
        onResend={ws.handleResendVerification}
        onLogout={ws.handleLogout}
      />
    )
  }

  if (ws.authStatus !== 'authenticated') {
    return (
      <AdminLoginScreen
        setupRequired={ws.authStatus === 'setup-required'}
        email={ws.loginEmail}
        password={ws.loginPassword}
        setupForm={ws.setupForm}
        error={ws.authStatus === 'setup-required' ? ws.setupError || ws.apiError : ws.loginError || ws.apiError}
        loading={ws.authStatus === 'setup-required' ? ws.setupLoading : ws.loginLoading}
        onEmailChange={ws.setLoginEmail}
        onPasswordChange={ws.setLoginPassword}
        onSetupFormChange={(field, value) => {
          ws.setSetupForm((current) => ({ ...current, [field]: value }))
          ws.setSetupError('')
        }}
        onSubmit={ws.authStatus === 'setup-required' ? ws.handleSetup : ws.handleLogin}
      />
    )
  }

  return (
    <div className="app-shell">
      <DashboardSidebar
        views={dashboardViews}
        activeView={activeView}
        badges={badges}
        admin={ws.admin}
        organisations={ws.organisations}
        activeOrganisation={ws.activeOrg}
        onSelectOrganisation={ws.selectOrganisation}
        onCreateOrganisation={ws.createOrganisation}
        onNavigate={navigate}
        onHelp={() => setHelpOpen(true)}
      />
      <main className="main-area">
        <DashboardTopbar activeView={activeView} search={search} admin={ws.admin} organisation={ws.activeOrg} onSearch={setSearch} onLogout={ws.handleLogout} />
        {ws.apiError && <div className="api-error" role="alert"><span>{ws.apiError}</span><button onClick={() => ws.setApiError('')} aria-label="Dismiss error"><Icon name="close" size={15} /></button></div>}
        <div className="content-area"><ActiveView dashboard={dashboard} /></div>
        <footer className="footer"><span>© 2026 Muna learning</span><span>Admin workspace <i /> All systems operational</span></footer>
      </main>
      {ws.questionModalOpen && <QuestionModal question={ws.newQuestion} editing={Boolean(ws.editingQuestionId)} onQuestionChange={ws.setNewQuestion} error={ws.uploadError} onClose={() => { ws.setQuestionModalOpen(false); ws.setEditingQuestionId(null) }} onSubmit={ws.addQuestion} />}
      {ws.selectedAnswer && <AnswerReviewModal answer={ws.selectedAnswer} feedback={ws.answerFeedback} error={ws.answerReviewError} onFeedbackChange={(feedback) => { ws.setAnswerFeedback(feedback); ws.setAnswerReviewError('') }} onClose={() => ws.setSelectedAnswer(null)} onReview={(decision, itemGrades) => ws.markAnswerReviewed(ws.selectedAnswer.id, decision, ws.answerFeedback, itemGrades)} />}
      {ws.selectedFlag && <FlagReviewModal flag={ws.selectedFlag} note={ws.flagReviewNote} error={ws.flagReviewError} onNoteChange={(note) => { ws.setFlagReviewNote(note); ws.setFlagReviewError('') }} onClose={() => ws.setSelectedFlag(null)} onReview={(decision) => ws.markFlagReviewed(ws.selectedFlag.id, decision)} />}
      {helpOpen && <HelpCenterModal onClose={() => setHelpOpen(false)} onNavigate={navigate} />}
    </div>
  )
}

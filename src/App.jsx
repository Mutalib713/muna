import { lazy, Suspense, useEffect, useState } from 'react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import QuestionStudio from './components/QuestionStudio/QuestionStudio'
import SecuritySection from './components/SecuritySection'
import WorkspacesSection from './components/WorkspacesSection'
import JoinBanner from './components/JoinBanner'
import Footer from './components/Footer'
import ActionModal from './components/ActionModal'
import LoadingScreen from './components/ui/LoadingScreen'
import AdminDashboard from './dashboard/AdminDashboard'
import LearnerAssessment from './LearnerAssessment'
import './App.css'

const Signup = lazy(() => import('./pages/Signup.jsx'))
const Login = lazy(() => import('./pages/Login.jsx'))
const VerifyEmail = lazy(() => import('./pages/VerifyEmail.jsx'))
const InviteAccept = lazy(() => import('./pages/InviteAccept.jsx'))

// Minimal routing: /o/:slug (or #/dashboard) opens an organisation workspace,
// #/learner opens a learner attempt, and /signup, /login, /verify-email, /invite/:token
// handle account & invitation flows.
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])
  return hash
}

export default function App() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalType, setModalType] = useState('join') // 'join' | 'mentor'
  const hash = useHashRoute()
  const path = window.location.pathname

  if (path.startsWith('/invite/') || hash.startsWith('#/invite/')) {
    const rawToken = path.startsWith('/invite/')
      ? path.slice('/invite/'.length)
      : hash.slice('#/invite/'.length)
    const token = decodeURIComponent(rawToken.split(/[?#]/)[0] || '')
    return (
      <Suspense fallback={<LoadingScreen label="Loading invitation" />}>
        <InviteAccept token={token} />
      </Suspense>
    )
  }

  if (path === '/signup' || path === '/login') {
    const AuthPage = path === '/signup' ? Signup : Login
    return (
      <Suspense fallback={<LoadingScreen label="Loading account page" />}>
        <AuthPage />
      </Suspense>
    )
  }

  if (path === '/verify-email') {
    return (
      <Suspense fallback={<LoadingScreen label="Loading verification page" />}>
        <VerifyEmail />
      </Suspense>
    )
  }

  if (path.startsWith('/o/')) {
    const orgSlug = decodeURIComponent(path.slice('/o/'.length).split(/[/?#]/)[0] || '')
    return <AdminDashboard orgSlug={orgSlug} />
  }

  const handleOpenModal = (type) => {
    setModalType(type)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
  }

  if (hash.startsWith('#/dashboard')) {
    return <AdminDashboard />
  }
  if (hash.startsWith('#/learner')) {
    return <LearnerAssessment hash={hash} />
  }

  return (
    <div className="app-container">
      <Navbar onOpenModal={handleOpenModal} />
      <main>
        <Hero />
        <QuestionStudio />
        <SecuritySection />
        <WorkspacesSection />
        <JoinBanner />
      </main>
      <Footer />
      <ActionModal
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        modalType={modalType}
      />
    </div>
  )
}
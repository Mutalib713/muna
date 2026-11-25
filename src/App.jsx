import { lazy, Suspense, useEffect, useState } from 'react'
import { useEffect, useState } from 'react'
import { lazy, Suspense, useState } from 'react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import QuestionStudio from './components/QuestionStudio/QuestionStudio'
import SecuritySection from './components/SecuritySection'
import WorkspacesSection from './components/WorkspacesSection'
import JoinBanner from './components/JoinBanner'
import Footer from './components/Footer'
import ActionModal from './components/ActionModal'
import AdminDashboard from './dashboard/AdminDashboard'
import LearnerAssessment from './LearnerAssessment'
import './App.css'

// Minimal hash routing: #/dashboard opens the admin workspace, everything
// else shows the landing page. Proper routing (react-router) is a Phase 0
// deliverable and should replace this once the app shell exists.
function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const handleHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])
  return hash
}
import LoadingScreen from './components/ui/LoadingScreen'
import AdminDashboard from './dashboard/AdminDashboard'
import './App.css'

const Signup = lazy(() => import('./pages/Signup.jsx'))
const Login = lazy(() => import('./pages/Login.jsx'))

// Minimal hash routing: #/dashboard opens the admin workspace, everything
// else shows the landing page. Proper routing (react-router) is a Phase 0
// deliverable and should replace this once the app shell exists.
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

  if (path === '/signup' || path === '/login') {
    const AuthPage = path === '/signup' ? Signup : Login
    return (
      <Suspense fallback={<LoadingScreen label="Loading account page" />}>
        <AuthPage />
      </Suspense>
    )
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

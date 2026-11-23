import { lazy, Suspense, useState } from 'react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import QuestionStudio from './components/QuestionStudio/QuestionStudio'
import SecuritySection from './components/SecuritySection'
import WorkspacesSection from './components/WorkspacesSection'
import JoinBanner from './components/JoinBanner'
import Footer from './components/Footer'
import ActionModal from './components/ActionModal'
import LoadingScreen from './components/ui/LoadingScreen'
import './App.css'

const Signup = lazy(() => import('./pages/Signup.jsx'))
const Login = lazy(() => import('./pages/Login.jsx'))

export default function App() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalType, setModalType] = useState('join') // 'join' | 'mentor'
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

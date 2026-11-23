import { useEffect, useState } from 'react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import QuestionStudio from './components/QuestionStudio/QuestionStudio'
import SecuritySection from './components/SecuritySection'
import WorkspacesSection from './components/WorkspacesSection'
import JoinBanner from './components/JoinBanner'
import Footer from './components/Footer'
import ActionModal from './components/ActionModal'
import AdminDashboard from './dashboard/AdminDashboard'
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

export default function App() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalType, setModalType] = useState('join') // 'join' | 'mentor'
  const hash = useHashRoute()

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

  return (
    <div className="app-container">
      <Navbar onOpenModal={handleOpenModal} />
      <main>
        <Hero onOpenModal={handleOpenModal} />
        <QuestionStudio />
        <SecuritySection />
        <WorkspacesSection onOpenModal={handleOpenModal} />
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

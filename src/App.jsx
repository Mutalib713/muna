import { useState } from 'react'
import Navbar from './components/Navbar'
import Hero from './components/Hero'
import QuestionStudio from './components/QuestionStudio/QuestionStudio'
import SecuritySection from './components/SecuritySection'
import WorkspacesSection from './components/WorkspacesSection'
import JoinBanner from './components/JoinBanner'
import Footer from './components/Footer'
import ActionModal from './components/ActionModal'
import './App.css'

export default function App() {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [modalType, setModalType] = useState('join') // 'join' | 'mentor'

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

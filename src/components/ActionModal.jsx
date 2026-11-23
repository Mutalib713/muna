import { useState } from 'react'

export default function ActionModal({ isOpen, onClose, modalType }) {
  const [modalCode, setModalCode] = useState('')
  const [modalStatus, setModalStatus] = useState(null)

  if (!isOpen) return null

  const handleModalSubmit = (e) => {
    e.preventDefault()
    if (!modalCode.trim()) return

    if (modalCode.toUpperCase().includes('MUNA') || modalCode.toUpperCase().includes('BRIGHT')) {
      setModalStatus({
        valid: true,
        message: '✓ Verified: Bright Minds Academy (3 assessments assigned).'
      })
    } else {
      setModalStatus({
        valid: false,
        message: 'Invalid code. Please check with your mentor.'
      })
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15, 23, 42, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
        padding: '16px'
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          maxWidth: '480px',
          width: '100%',
          padding: '32px',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {modalType === 'join' ? (
          <>
            <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
              Enter Organisation Join Code
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--ink2)', marginBottom: '20px' }}>
              Paste the unique invitation token or code provided by your mentor.
            </p>
            <form onSubmit={handleModalSubmit}>
              <input
                type="text"
                className="clean-input"
                style={{ width: '100%', marginBottom: '16px' }}
                placeholder="e.g. BRIGHT-MINDS-2026"
                value={modalCode}
                onChange={(e) => setModalCode(e.target.value)}
                autoFocus
              />
              {modalStatus && (
                <div style={{
                  marginBottom: '16px',
                  fontSize: '13px',
                  color: modalStatus.valid ? 'var(--support)' : 'var(--danger)'
                }}>
                  {modalStatus.message}
                </div>
              )}
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={onClose}
                >
                  Close
                </button>
                <button type="submit" className="btn btn-primary">
                  Verify & Join
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h3 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
              Mentor Workspace Login
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--ink2)', marginBottom: '20px' }}>
              Organisation admins and mentors manage assessments, question banks, and grading rubrics.
            </p>
            <div style={{ background: 'var(--field2)', padding: '16px', borderRadius: '8px', fontSize: '13px', color: 'var(--ink2)', marginBottom: '20px' }}>
              <strong>Phase 0 & 1 Status:</strong> Database authentication is being configured. You can test question authoring in the <strong>Question Studio</strong> section right on this page!
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={onClose}
              >
                Explore Studio
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

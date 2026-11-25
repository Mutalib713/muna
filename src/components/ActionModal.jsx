import { useEffect, useRef, useState } from 'react'
import { X } from '../icons'
import apiRequest from '../dashboard/services/adminApi'

const FOCUSABLE_SELECTOR = 'button, input, textarea, select, a[href], [tabindex]:not([tabindex="-1"])'

export default function ActionModal({ isOpen, onClose, modalType }) {
  const dialogRef = useRef(null)
  const restoreFocusRef = useRef(null)
  const [modalCode, setModalCode] = useState('')
  const [modalStatus, setModalStatus] = useState(null)
  const [checking, setChecking] = useState(false)

  // Remember focus origin and restore it when the dialog closes.
  useEffect(() => {
    if (!isOpen) return undefined
    restoreFocusRef.current = document.activeElement
    return () => {
      const el = restoreFocusRef.current
      if (el && typeof el.focus === 'function') {
        el.focus()
      }
    }
  }, [isOpen])

  // Initial focus, Escape to close, Tab focus trap.
  useEffect(() => {
    if (!isOpen) return undefined
    const dialog = dialogRef.current
    if (dialog) {
      dialog.focus()
      const firstInput = dialog.querySelector('input')
      if (firstInput) firstInput.focus()
    }

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const dialogEl = dialogRef.current
      if (!dialogEl) return
      const focusables = [...dialogEl.querySelectorAll(FOCUSABLE_SELECTOR)].filter(
        (el) => !el.disabled && el.offsetParent !== null
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      const active = document.activeElement
      if (e.shiftKey && (active === first || active === dialogEl)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, modalType, onClose])

  if (!isOpen) return null

  const handleModalSubmit = async (e) => {
    e.preventDefault()
    const code = modalCode.trim()
    if (!code) return
    setChecking(true)
    setModalStatus(null)
    try {
      const { invitation } = await apiRequest(`/invitations/${encodeURIComponent(code)}`)
      setModalStatus({
        valid: true,
        token: code,
        message: `✓ Verified: ${invitation.organisationName} (joining as ${invitation.role}).`,
      })
    } catch (error) {
      setModalStatus({
        valid: false,
        message: error.message || 'Invalid code. Please check with your mentor.',
      })
    } finally {
      setChecking(false)
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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-heading"
        tabIndex={-1}
        style={{
          position: 'relative',
          background: '#ffffff',
          borderRadius: '16px',
          maxWidth: '480px',
          width: '100%',
          padding: '32px',
          boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          aria-label="Close dialog"
          onClick={onClose}
          style={{
            position: 'absolute',
            top: '14px',
            right: '14px',
            width: '34px',
            height: '34px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '6px',
            color: 'var(--ink2)',
            border: '1px solid var(--rule)',
            background: 'var(--surface)'
          }}
        >
          <X size={18} />
        </button>

        {modalType === 'join' ? (
          <>
            <h3 id="modal-heading" style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
              Enter Organisation Join Code
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--ink2)', marginBottom: '20px' }}>
              Paste the unique invitation token or code provided by your mentor.
            </p>
            <form onSubmit={handleModalSubmit}>
              <label htmlFor="modal-join-code" className="sr-only">
                Organisation invitation code
              </label>
              <input
                id="modal-join-code"
                type="text"
                className="clean-input"
                style={{ width: '100%', marginBottom: '16px' }}
                placeholder="e.g. BRIGHT-MINDS-2026"
                value={modalCode}
                onChange={(e) => setModalCode(e.target.value)}
                autoComplete="off"
              />
              {modalStatus && (
                <div
                  aria-live="polite"
                  style={{
                    marginBottom: '16px',
                    fontSize: '13px',
                    color: modalStatus.valid ? 'var(--support)' : 'var(--accent2-text)'
                  }}
                >
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
                {modalStatus?.valid && modalStatus.token ? (
                  <a
                    className="btn btn-primary"
                    href={`/invite/${encodeURIComponent(modalStatus.token)}`}
                  >
                    Continue to join
                  </a>
                ) : (
                  <button type="submit" className="btn btn-primary" disabled={checking}>
                    {checking ? 'Checking…' : 'Verify & Join'}
                  </button>
                )}
              </div>
            </form>
          </>
        ) : (
          <>
            <h3 id="modal-heading" style={{ fontSize: '20px', fontWeight: 700, marginBottom: '8px' }}>
              Mentor Workspace Login
            </h3>
            <p style={{ fontSize: '14px', color: 'var(--ink2)', marginBottom: '20px' }}>
              Organisation admins and mentors manage assessments, question banks, and grading rubrics.
            </p>
            <div style={{ background: 'var(--field2)', padding: '16px', borderRadius: '8px', fontSize: '13px', color: 'var(--ink2)', marginBottom: '20px' }}>
              <strong>Phase 0 &amp; 1 Status:</strong> Database authentication is being configured. You can test question authoring in the <strong>Question Studio</strong> section right on this page!
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

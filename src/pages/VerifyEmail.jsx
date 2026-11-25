import { useEffect, useState } from 'react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { ShieldCheck } from '../icons'
import apiRequest, { requestCsrfToken } from '../dashboard/services/adminApi'

export default function VerifyEmail() {
  const initialToken = new URLSearchParams(window.location.search).get('token')?.trim() || ''
  const [token, setToken] = useState(initialToken)
  const [status, setStatus] = useState(initialToken ? 'verifying' : 'idle') // 'idle' | 'verifying' | 'verified' | 'error'
  const [message, setMessage] = useState('')
  const [resending, setResending] = useState(false)
  const [devToken, setDevToken] = useState('')
  const [activeOrgSlug, setActiveOrgSlug] = useState('')

  useEffect(() => {
    if (!initialToken) return undefined
    let active = true
    async function verifyFromUrl() {
      try {
        const { csrfToken } = await requestCsrfToken()
        await apiRequest('/auth/verify-email', {
          method: 'POST',
          body: { token: initialToken },
          csrfToken,
        })
        let slug = ''
        try {
          const me = await apiRequest('/auth/me')
          if (me?.organisation?.slug && ['Owner', 'Admin', 'Mentor'].includes(me.organisation.role)) {
            slug = me.organisation.slug
          }
        } catch {
          // User may not be signed in in this browser tab.
        }
        if (!active) return
        setActiveOrgSlug(slug)
        setStatus('verified')
        setMessage('Your email address is verified. You can now access your workspace.')
      } catch (error) {
        if (!active) return
        setStatus('error')
        setMessage(error.message)
      }
    }
    verifyFromUrl()
    return () => { active = false }
  }, [initialToken])

  const handleSubmit = async (event) => {
    event.preventDefault()
    const cleanToken = token.trim()
    if (!cleanToken) {
      setStatus('error')
      setMessage('Enter the verification token sent to your email.')
      return
    }
    setStatus('verifying')
    setMessage('')
    try {
      const { csrfToken } = await requestCsrfToken()
      await apiRequest('/auth/verify-email', {
        method: 'POST',
        body: { token: cleanToken },
        csrfToken,
      })
      let slug = ''
      try {
        const me = await apiRequest('/auth/me')
        if (me?.organisation?.slug && ['Owner', 'Admin', 'Mentor'].includes(me.organisation.role)) {
          slug = me.organisation.slug
        }
      } catch {
        // Not signed in yet.
      }
      setActiveOrgSlug(slug)
      setStatus('verified')
      setMessage('Your email address is verified. You can now access your workspace.')
    } catch (error) {
      setStatus('error')
      setMessage(error.message)
    }
  }

  const handleResend = async () => {
    setResending(true)
    setMessage('')
    setDevToken('')
    try {
      const { csrfToken } = await requestCsrfToken()
      const data = await apiRequest('/auth/resend-verification', { method: 'POST', csrfToken })
      if (data.alreadyVerified) {
        setStatus('verified')
        setMessage('Your email address is already verified.')
      } else {
        setStatus('idle')
        setMessage('A new verification email has been issued.')
        if (data.verificationToken) setDevToken(data.verificationToken)
      }
    } catch (error) {
      setStatus('error')
      setMessage(error.message)
    } finally {
      setResending(false)
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="About Muna">
        <a className="auth-brand" href="/" aria-label="Muna home">
          <span className="brand-icon-box"><ShieldCheck size={22} /></span>
          <span>MUNA</span>
        </a>
        <div className="auth-story-content">
          <span className="auth-kicker">Verify your email</span>
          <h1>Confirm your workspace identity.</h1>
          <p>
            Verifying your email unlocks organisation creation, invitations,
            and assessment delivery across your workspaces.
          </p>
          <div className="auth-story-points">
            <span><i aria-hidden="true">01</i> Protects your organisation workspace</span>
            <span><i aria-hidden="true">02</i> Enables team invitations and roles</span>
            <span><i aria-hidden="true">03</i> Takes less than a minute</span>
          </div>
        </div>
        <p className="auth-story-footer">Thoughtful assessment starts here.</p>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap login-form-wrap">
          <a className="auth-mobile-brand" href="/" aria-label="Muna home">
            <span className="brand-icon-box"><ShieldCheck size={22} /></span>
            <span>MUNA</span>
          </a>
          <p className="auth-eyebrow">Email verification</p>
          <h2>Verify your email</h2>
          <p className="auth-description">
            {status === 'verifying'
              ? 'Verifying your token…'
              : 'Paste your verification token below or use the verification link from signup.'}
          </p>

          {status !== 'verified' ? (
            <form className="auth-form" onSubmit={handleSubmit}>
              <Input
                id="verify-token"
                label="Verification token"
                name="token"
                placeholder="Paste verification token"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                required
              />
              {message && <p className="auth-notice" role="status">{message}</p>}
              {devToken && (
                <a className="auth-home-link" href={`/verify-email?token=${encodeURIComponent(devToken)}`}>
                  Verify now with issued token
                </a>
              )}
              <Button className="auth-submit" type="submit" disabled={status === 'verifying'}>
                {status === 'verifying' ? 'Verifying…' : 'Verify email'}
              </Button>
              <Button
                className="auth-submit"
                type="button"
                variant="secondary"
                disabled={resending}
                onClick={handleResend}
              >
                {resending ? 'Sending…' : 'Resend verification email'}
              </Button>
            </form>
          ) : (
            <div className="auth-form">
              <p className="auth-notice" role="status">{message}</p>
              <a
                className="auth-home-link"
                href={activeOrgSlug ? `/o/${encodeURIComponent(activeOrgSlug)}` : '/login'}
              >
                {activeOrgSlug ? 'Open your workspace' : 'Continue to log in'}
              </a>
            </div>
          )}

          <p className="auth-switch">
            Need to switch accounts? <a href="/login">Log in</a>
          </p>
          <a className="auth-home-link" href="/">Back to Muna home</a>
        </div>
      </section>
    </main>
  )
}

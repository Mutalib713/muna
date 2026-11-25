import { useState } from 'react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { ShieldCheck } from '../icons'
import apiRequest, { cacheCsrfToken, requestCsrfToken } from '../dashboard/services/adminApi'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [notice, setNotice] = useState('')
  const [unverifiedUser, setUnverifiedUser] = useState(false)
  const [devVerifyToken, setDevVerifyToken] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setNotice('')
    setUnverifiedUser(false)
    setDevVerifyToken('')
    setSubmitting(true)
    try {
      const { csrfToken } = await requestCsrfToken()
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        body: { email, password },
        csrfToken,
      })
      cacheCsrfToken(data.csrfToken)
      if (!data.user?.emailVerified) {
        setUnverifiedUser(true)
        setNotice('Verify your email address before opening your workspace.')
        return
      }
      const org = data.organisation || data.organisations?.[0]
      if (org && ['Owner', 'Admin', 'Mentor'].includes(org.role)) {
        window.location.assign(`/o/${encodeURIComponent(org.slug)}`)
        return
      }
      if (org?.menteeId) {
        window.location.assign(`/#/learner/${encodeURIComponent(org.menteeId)}`)
        return
      }
      window.location.assign('/#/learner')
    } catch (error) {
      setNotice(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleResend = async () => {
    setResending(true)
    try {
      const { csrfToken } = await requestCsrfToken()
      const data = await apiRequest('/auth/resend-verification', { method: 'POST', csrfToken })
      if (data.verificationToken) {
        setDevVerifyToken(data.verificationToken)
      }
      setNotice('Verification email re-issued. Check your inbox or click verify below.')
    } catch (error) {
      setNotice(error.message)
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
          <span className="auth-kicker">Welcome back</span>
          <h1>Your next great assessment starts here.</h1>
          <p>
            Pick up where you left off, whether you’re preparing an assessment
            or ready to learn.
          </p>
          <div className="auth-story-points">
            <span><i aria-hidden="true">01</i> Your work stays with your workspace</span>
            <span><i aria-hidden="true">02</i> Clear rules before every assessment</span>
            <span><i aria-hidden="true">03</i> A focused experience for everyone</span>
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
          <p className="auth-eyebrow">Good to see you again</p>
          <h2>Log in to Muna</h2>
          <p className="auth-description">Enter your details to access your organisation workspace.</p>

          <form className="auth-form" onSubmit={handleSubmit}>
            <Input
              id="login-email"
              label="Email address"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
            <Input
              id="login-password"
              label="Password"
              name="password"
              type="password"
              autoComplete="current-password"
              placeholder="Enter your password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {notice && <p className="auth-notice" role="status">{notice}</p>}
            {unverifiedUser && (
              <div style={{ display: 'grid', gap: '8px' }}>
                <Button className="auth-submit" type="button" variant="secondary" disabled={resending} onClick={handleResend}>
                  {resending ? 'Sending…' : 'Resend verification email'}
                </Button>
                <a
                  className="auth-home-link"
                  href={devVerifyToken ? `/verify-email?token=${encodeURIComponent(devVerifyToken)}` : '/verify-email'}
                >
                  Open email verification page
                </a>
              </div>
            )}
            <Button className="auth-submit" type="submit" disabled={submitting}>
              {submitting ? 'Logging in…' : 'Log in'}
            </Button>
          </form>

          <p className="auth-switch">
            New to Muna? <a href="/signup">Create an account</a>
          </p>
          <a className="auth-home-link" href="/">Back to Muna home</a>
        </div>
      </section>
    </main>
  )
}

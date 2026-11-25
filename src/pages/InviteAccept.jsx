import { useEffect, useState } from 'react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { ShieldCheck } from '../icons'
import apiRequest, { requestCsrfToken } from '../dashboard/services/adminApi'

export default function InviteAccept({ token }) {
  const [status, setStatus] = useState('loading') // 'loading' | 'ready' | 'error' | 'accepted'
  const [invitation, setInvitation] = useState(null)
  const [csrfToken, setCsrfToken] = useState('')
  const [loadError, setLoadError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [acceptedResult, setAcceptedResult] = useState(null)

  useEffect(() => {
    let active = true
    async function load() {
      setStatus('loading')
      setLoadError('')
      setSubmitError('')
      try {
        const [{ csrfToken: nextCsrf }, preview] = await Promise.all([
          requestCsrfToken(),
          apiRequest(`/invitations/${encodeURIComponent(token)}`),
        ])
        if (!active) return
        setCsrfToken(nextCsrf)
        setInvitation(preview.invitation)
        setStatus('ready')
      } catch (error) {
        if (!active) return
        setLoadError(error.message)
        setStatus('error')
      }
    }
    load()
    return () => { active = false }
  }, [token])

  async function handleAccept(event) {
    event.preventDefault()
    setSubmitError('')
    setSubmitting(true)
    try {
      const result = await apiRequest(`/invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: { name, email, password },
        csrfToken,
      })
      setAcceptedResult(result)
      setStatus('accepted')
    } catch (error) {
      setSubmitError(error.message)
    } finally {
      setSubmitting(false)
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
          <span className="auth-kicker">Organisation invitation</span>
          <h1>Join your workspace on Muna.</h1>
          <p>
            Review who invited you and your assigned role before accepting membership.
          </p>
          <div className="auth-story-points">
            <span><i aria-hidden="true">01</i> Membership is scoped to this organisation</span>
            <span><i aria-hidden="true">02</i> Clear assessment rules before you begin</span>
            <span><i aria-hidden="true">03</i> Your progress stays synced with the workspace</span>
          </div>
        </div>
        <p className="auth-story-footer">Thoughtful assessment starts here.</p>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap">
          <a className="auth-mobile-brand" href="/" aria-label="Muna home">
            <span className="brand-icon-box"><ShieldCheck size={22} /></span>
            <span>MUNA</span>
          </a>

          {status === 'loading' && (
            <>
              <p className="auth-eyebrow">Checking invitation</p>
              <h2>Verifying your invite…</h2>
              <p className="auth-description">One moment while we validate this invitation with the workspace.</p>
            </>
          )}

          {status === 'error' && (
            <>
              <p className="auth-eyebrow">Invitation unavailable</p>
              <h2>This invitation can&apos;t be used</h2>
              <p className="auth-notice" role="alert">{loadError}</p>
              <a className="auth-home-link" href="/">Back to Muna home</a>
            </>
          )}

          {status === 'ready' && invitation && (
            <>
              <p className="auth-eyebrow">You&apos;re invited</p>
              <h2>Join {invitation.organisationName}</h2>
              <p className="auth-description">
                Invited by <strong>{invitation.inviterName}</strong> as a <strong>{invitation.role}</strong>.
                {invitation.requiresEmailMatch && invitation.emailHint
                  ? ` Use ${invitation.emailHint} to accept.`
                  : ''}
              </p>

              <form className="auth-form" onSubmit={handleAccept}>
                <Input
                  id="invite-name"
                  label="Full name"
                  name="name"
                  autoComplete="name"
                  placeholder="Your name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
                <Input
                  id="invite-email"
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
                  id="invite-password"
                  label="Password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  minLength={8}
                  placeholder="At least 8 characters"
                  hint="New accounts need at least 8 characters. Existing accounts must enter their current password."
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                {submitError && <p className="auth-notice" role="alert">{submitError}</p>}
                <Button className="auth-submit" type="submit" disabled={submitting}>
                  {submitting ? 'Accepting…' : `Accept invitation as ${invitation.role}`}
                </Button>
              </form>
              <a className="auth-home-link" href="/">Back to Muna home</a>
            </>
          )}

          {status === 'accepted' && acceptedResult && (
            <>
              <p className="auth-eyebrow">Membership confirmed</p>
              <h2>Welcome to {acceptedResult.organisation.name}</h2>
              <p className="auth-notice" role="status">
                {acceptedResult.alreadyMember
                  ? `You are already an active ${acceptedResult.member.role} in ${acceptedResult.organisation.name}.`
                  : `You joined ${acceptedResult.organisation.name} as ${acceptedResult.member.role}.`}
              </p>
              {acceptedResult.menteeId && (
                <a className="auth-home-link" href={`/#/learner/${encodeURIComponent(acceptedResult.menteeId)}`}>
                  Open your assigned assessments (ID: {acceptedResult.menteeId})
                </a>
              )}
              <a className="auth-home-link" href="/">Back to Muna home</a>
            </>
          )}
        </div>
      </section>
    </main>
  )
}

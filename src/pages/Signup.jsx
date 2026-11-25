import { useState } from 'react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { ShieldCheck } from '../icons'
import apiRequest, { requestCsrfToken } from '../dashboard/services/adminApi'

export default function Signup() {
  const [role, setRole] = useState(
    new URLSearchParams(window.location.search).get('role') === 'mentee'
      ? 'mentee'
      : 'mentor',
  )
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [organisation, setOrganisation] = useState('')
  const [invitationCode, setInvitationCode] = useState('')
  const [notice, setNotice] = useState('')
  const [joinedResult, setJoinedResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setNotice('')
    setJoinedResult(null)
    if (role === 'mentor') {
      setNotice("Mentor workspace signup isn't connected yet. Use the admin workspace or accept an invitation code.")
      return
    }
    const token = invitationCode.trim()
    if (!token) {
      setNotice('Enter the invitation code from your mentor.')
      return
    }
    setSubmitting(true)
    try {
      const { csrfToken } = await requestCsrfToken()
      const result = await apiRequest(`/invitations/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        body: { name, email, password },
        csrfToken,
      })
      setJoinedResult(result)
      setNotice(
        result.alreadyMember
          ? `You are already an active ${result.member.role} in ${result.organisation.name}.`
          : `Welcome to ${result.organisation.name}! Joined as ${result.member.role}.`,
      )
    } catch (error) {
      setNotice(error.message)
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
          <span className="auth-kicker">A better way to assess</span>
          <h1>Make room for every way of thinking.</h1>
          <p>
            Create meaningful assessments, bring your organisation together,
            and help learners show what they know.
          </p>
          <div className="auth-story-points">
            <span><i aria-hidden="true">01</i> Build beyond multiple choice</span>
            <span><i aria-hidden="true">02</i> Keep workspaces organised</span>
            <span><i aria-hidden="true">03</i> Give learners a calm place to focus</span>
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
          <p className="auth-eyebrow">Create your account</p>
          <h2>Get started with Muna</h2>
          <p className="auth-description">Choose how you’ll use Muna. You can belong to more than one organisation.</p>

          <fieldset className="role-picker">
            <legend>I’m joining as a</legend>
            <label className={role === 'mentor' ? 'role-option selected' : 'role-option'}>
              <input
                type="radio"
                name="role"
                value="mentor"
                checked={role === 'mentor'}
                onChange={() => setRole('mentor')}
              />
              <span className="role-option-title">Mentor</span>
              <span className="role-option-caption">Create an organisation</span>
            </label>
            <label className={role === 'mentee' ? 'role-option selected' : 'role-option'}>
              <input
                type="radio"
                name="role"
                value="mentee"
                checked={role === 'mentee'}
                onChange={() => setRole('mentee')}
              />
              <span className="role-option-title">Mentee</span>
              <span className="role-option-caption">Join with an invitation</span>
            </label>
          </fieldset>

          <form className="auth-form" onSubmit={handleSubmit}>
            <Input
              id="full-name"
              label="Full name"
              name="name"
              autoComplete="name"
              placeholder="Your name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
            />
            <Input
              id="signup-email"
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
              id="signup-password"
              label="Password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              placeholder="At least 8 characters"
              hint="Use at least 8 characters."
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {role === 'mentor' ? (
              <Input
                id="organisation-name"
                label="Organisation name"
                name="organisation"
                autoComplete="organization"
                placeholder="e.g. Bright Minds Academy"
                value={organisation}
                onChange={(event) => setOrganisation(event.target.value)}
                required
              />
            ) : (
              <Input
                id="invitation-code"
                label="Invitation code"
                name="invitation"
                placeholder="Enter the code from your mentor"
                value={invitationCode}
                onChange={(event) => setInvitationCode(event.target.value)}
                required
              />
            )}
            {notice && <p className="auth-notice" role="status">{notice}</p>}
            {joinedResult?.menteeId && (
              <a className="auth-home-link" href={`/#/learner/${encodeURIComponent(joinedResult.menteeId)}`}>
                Open your assigned assessments (ID: {joinedResult.menteeId})
              </a>
            )}
            <Button className="auth-submit" type="submit" disabled={submitting}>
              {submitting ? 'Creating account…' : `Create ${role === 'mentor' ? 'mentor' : 'mentee'} account`}
            </Button>
          </form>

          <p className="auth-switch">
            Already have an account? <a href="/login">Log in</a>
          </p>
          <p className="auth-legal">
            By continuing, you agree to use Muna in accordance with your organisation’s policies.
          </p>
        </div>
      </section>
    </main>
  )
}

import { useState } from 'react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { ShieldCheck } from '../icons'

export default function Signup() {
  const [role, setRole] = useState(
    new URLSearchParams(window.location.search).get('role') === 'mentee'
      ? 'mentee'
      : 'mentor',
  )
  const [notice, setNotice] = useState('')

  const handleSubmit = (event) => {
    event.preventDefault()
    setNotice("Account creation isn't connected yet. Your details haven't been sent.")
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
            <Input id="full-name" label="Full name" name="name" autoComplete="name" placeholder="Your name" required />
            <Input id="signup-email" label="Email address" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
            <Input
              id="signup-password"
              label="Password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              placeholder="At least 8 characters"
              hint="Use at least 8 characters."
              required
            />
            {role === 'mentor' ? (
              <Input id="organisation-name" label="Organisation name" name="organisation" autoComplete="organization" placeholder="e.g. Bright Minds Academy" required />
            ) : (
              <Input id="invitation-code" label="Invitation code" name="invitation" placeholder="Enter the code from your mentor" required />
            )}
            {notice && <p className="auth-notice" role="status">{notice}</p>}
            <Button className="auth-submit" type="submit">
              Create {role === 'mentor' ? 'mentor' : 'mentee'} account
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

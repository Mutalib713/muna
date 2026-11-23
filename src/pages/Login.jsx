import { useState } from 'react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { ShieldCheck } from '../icons'

export default function Login() {
  const [notice, setNotice] = useState('')

  const handleSubmit = (event) => {
    event.preventDefault()
    setNotice("Sign in isn't connected yet. Your details haven't been sent.")
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
            <Input id="login-email" label="Email address" name="email" type="email" autoComplete="email" placeholder="you@example.com" required />
            <Input id="login-password" label="Password" name="password" type="password" autoComplete="current-password" placeholder="Enter your password" required />
            {notice && <p className="auth-notice" role="status">{notice}</p>}
            <Button className="auth-submit" type="submit">Log in</Button>
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

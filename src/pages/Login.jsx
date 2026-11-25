import { useState } from 'react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { ShieldCheck } from '../icons'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { useAuth } from '../lib/authContext'

export default function Login() {
  const { refreshMemberships } = useAuth()
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!isSupabaseConfigured || !supabase) {
      setNotice('Supabase is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local.')
      return
    }

    const formData = new FormData(event.currentTarget)
    const email = String(formData.get('email') || '').trim()
    const password = String(formData.get('password') || '')

    setSubmitting(true)
    setNotice('')

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setNotice(error.message)
        return
      }

      let memberships = await refreshMemberships()

      // Complete pending mentor organisation creation if user confirmed email after signup
      const pendingOrg = data.user?.user_metadata?.pending_org_name
      if (memberships.length === 0 && pendingOrg) {
        const { error: orgError } = await supabase.rpc('create_organisation', {
          org_name: pendingOrg,
        })
        if (!orgError) {
          await supabase.auth.updateUser({ data: { pending_org_name: null } })
          memberships = await refreshMemberships()
        }
      }

      const primaryRole = memberships[0]?.role
      if (primaryRole === 'mentee') {
        window.location.href = '/#/learner'
      } else {
        window.location.href = '/#/dashboard'
      }
    } catch (err) {
      setNotice(err?.message || 'Unable to log in right now.')
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
            <Button className="auth-submit" type="submit" disabled={submitting}>
              {submitting ? 'Logging in...' : 'Log in'}
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

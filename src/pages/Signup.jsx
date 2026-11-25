import { useState } from 'react'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import { ShieldCheck } from '../icons'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { useAuth } from '../lib/authContext'

export default function Signup() {
  const { refreshMemberships } = useAuth()
  const [role, setRole] = useState(
    new URLSearchParams(window.location.search).get('role') === 'mentee'
      ? 'mentee'
      : 'mentor',
  )
  const [notice, setNotice] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    if (!isSupabaseConfigured || !supabase) {
      setNotice('Supabase is not configured yet. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to .env.local.')
      return
    }

    const formData = new FormData(event.currentTarget)
    const fullName = String(formData.get('name') || '').trim()
    const email = String(formData.get('email') || '').trim()
    const password = String(formData.get('password') || '')
    const orgName = String(formData.get('organisation') || '').trim()
    const invitationCode = String(formData.get('invitation') || '').trim()

    setSubmitting(true)
    setNotice('')

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            pending_org_name: role === 'mentor' ? orgName : null,
            pending_invite_code: role === 'mentee' ? invitationCode : null,
          },
        },
      })

      if (error) {
        setNotice(error.message)
        return
      }

      if (!data.session) {
        setNotice('Account created! Please check your email to verify your address, then log in.')
        return
      }

      if (role === 'mentor' && orgName) {
        const { error: orgError } = await supabase.rpc('create_organisation', {
          org_name: orgName,
        })
        if (orgError) {
          setNotice(`Account created, but organisation setup failed: ${orgError.message}`)
          return
        }
        await supabase.auth.updateUser({ data: { pending_org_name: null } })
        await refreshMemberships()
        window.location.href = '/#/dashboard'
        return
      }

      setNotice('Account created! Invitation redemption will be enabled in Phase 1.')
    } catch (err) {
      setNotice(err?.message || 'Unable to create account right now.')
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
            <Button className="auth-submit" type="submit" disabled={submitting}>
              {submitting
                ? 'Creating account...'
                : `Create ${role === 'mentor' ? 'mentor' : 'mentee'} account`}
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

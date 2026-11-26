export default function AdminLoginScreen({
  setupRequired,
  setupAvailable,
  email,
  password,
  setupForm,
  error,
  loading,
  onEmailChange,
  onPasswordChange,
  onSetupFormChange,
  onToggleSetup,
  onSubmit,
}) {
  return (
    <main className="admin-auth-screen">
      <section className="admin-auth-card">
        <a className="brand admin-auth-brand" href="#/" aria-label="Muna home"><span className="brand-mark">m</span><span>muna<span className="brand-dot">.</span></span></a>
        <p className="eyebrow">WORKSPACE</p>
        <h1>{setupRequired ? 'Create your admin account' : 'Sign in to Muna'}</h1>
        <p className="admin-auth-description">{setupRequired ? 'Set up the administrator account for this Muna workspace.' : 'Sign in with your account to open your workspace dashboard.'}</p>
        <form onSubmit={onSubmit}>
          {setupRequired ? (
            <>
              <label className="form-label">Name<input type="text" autoComplete="name" required maxLength={120} value={setupForm.name} onChange={(event) => onSetupFormChange('name', event.target.value)} placeholder="Your name" /></label>
              <label className="form-label">Email address<input type="email" autoComplete="email" required value={setupForm.email} onChange={(event) => onSetupFormChange('email', event.target.value)} placeholder="you@example.com" /></label>
              <label className="form-label">Password<input type="password" autoComplete="new-password" minLength={10} required value={setupForm.password} onChange={(event) => onSetupFormChange('password', event.target.value)} placeholder="At least 10 characters" /></label>
              <label className="form-label">Confirm password<input type="password" autoComplete="new-password" minLength={10} required value={setupForm.confirmPassword} onChange={(event) => onSetupFormChange('confirmPassword', event.target.value)} placeholder="Re-enter your password" /></label>
              <label className="form-label">Setup code<input type="password" autoComplete="off" required value={setupForm.setupCode} onChange={(event) => onSetupFormChange('setupCode', event.target.value)} placeholder="Enter the server setup code" /></label>
            </>
          ) : (
            <>
              <label className="form-label">Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="you@example.com" /></label>
              <label className="form-label">Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="Enter your password" /></label>
            </>
          )}
          {error && <p className="inline-message error-message" role="alert">{error}</p>}
          <button type="submit" className="button button-primary admin-auth-submit" disabled={loading}>{loading ? (setupRequired ? 'Creating account…' : 'Signing in…') : (setupRequired ? 'Create admin account' : 'Sign in')}</button>
        </form>
        {setupRequired ? (
          <p className="admin-auth-footnote">
            Already have an account?{' '}
            <button type="button" className="admin-auth-link" onClick={() => onToggleSetup(false)}>Sign in instead</button>
          </p>
        ) : (
          <>
            <p className="admin-auth-footnote">
              New to Muna? <a className="admin-auth-link" href="/signup">Create an account</a>
            </p>
            {setupAvailable && (
              <p className="admin-auth-footnote admin-auth-footnote-secondary">
                First-time server admin?{' '}
                <button type="button" className="admin-auth-link" onClick={() => onToggleSetup(true)}>Set up admin account</button>
              </p>
            )}
          </>
        )}
      </section>
    </main>
  )
}

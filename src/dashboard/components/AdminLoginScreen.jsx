export default function AdminLoginScreen({ email, password, error, loading, onEmailChange, onPasswordChange, onSubmit }) {
  return (
    <main className="admin-auth-screen">
      <section className="admin-auth-card">
        <a className="brand admin-auth-brand" href="#/" aria-label="Muna home"><span className="brand-mark">m</span><span>muna<span className="brand-dot">.</span></span></a>
        <p className="eyebrow">ADMIN WORKSPACE</p>
        <h1>Sign in to Muna</h1>
        <p className="admin-auth-description">Use your administrator account to continue.</p>
        <form onSubmit={onSubmit}>
          <label className="form-label">Email address<input type="email" autoComplete="username" required value={email} onChange={(event) => onEmailChange(event.target.value)} placeholder="admin@example.com" /></label>
          <label className="form-label">Password<input type="password" autoComplete="current-password" required value={password} onChange={(event) => onPasswordChange(event.target.value)} placeholder="Enter your password" /></label>
          {error && <p className="inline-message error-message" role="alert">{error}</p>}
          <button type="submit" className="button button-primary admin-auth-submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="admin-auth-footnote">Administrator access only. Contact your system administrator if you need access.</p>
      </section>
    </main>
  )
}

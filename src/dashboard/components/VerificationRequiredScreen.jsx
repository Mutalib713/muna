export default function VerificationRequiredScreen({ email, apiError, devVerifyToken, onResend, onLogout }) {
  return (
    <main className="admin-auth-screen">
      <section className="admin-auth-card">
        <span className="brand-mark">m</span>
        <p className="eyebrow">EMAIL VERIFICATION REQUIRED</p>
        <h1>Verify your email</h1>
        <p className="auth-subcopy">
          Confirm <strong>{email}</strong> before accessing your organisation workspace.
        </p>
        {apiError && <p className="inline-message error-message" role="alert">{apiError}</p>}
        <div style={{ display: 'grid', gap: '10px', marginTop: '14px' }}>
          <a
            className="button button-primary"
            href={devVerifyToken ? `/verify-email?token=${encodeURIComponent(devVerifyToken)}` : '/verify-email'}
          >
            Verify email address
          </a>
          <button type="button" className="button button-secondary" onClick={onResend}>
            Resend verification email
          </button>
          <button type="button" className="button button-secondary" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </section>
    </main>
  )
}

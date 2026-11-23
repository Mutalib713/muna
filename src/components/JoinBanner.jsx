import { useState } from 'react'
import { ArrowRight } from '../icons'

export default function JoinBanner() {
  const [joinCode, setJoinCode] = useState('')
  const [joinStatus, setJoinStatus] = useState(null)

  const handleJoinSubmit = (e) => {
    e.preventDefault()
    if (!joinCode.trim()) return

    if (joinCode.toUpperCase().includes('MUNA') || joinCode.toUpperCase().includes('BRIGHT')) {
      setJoinStatus({
        valid: true,
        orgName: 'Bright Minds Academy',
        slug: 'bright-minds',
        assessments: 3
      })
    } else {
      setJoinStatus({
        valid: false,
        message: 'Invalid or expired invitation code. Please verify with your mentor.'
      })
    }
  }

  return (
    <section className="cta-banner">
      <div className="content-wrap">
        <div className="cta-box">
          <h2>Ready to begin an assessment?</h2>
          <p>
            If your mentor provided an invitation code or organization link, enter it below to access your assigned assessments.
          </p>

          <form onSubmit={handleJoinSubmit} className="code-input-form">
            <input
              type="text"
              className="code-input"
              placeholder="e.g. BRIGHT-MINDS-2026"
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value)}
            />
            <button type="submit" className="btn btn-white">
              Verify Code <ArrowRight size={16} />
            </button>
          </form>

          {joinStatus && (
            <div style={{ marginTop: '20px', fontSize: '14px' }}>
              {joinStatus.valid ? (
                <div style={{ background: 'rgba(255,255,255,0.15)', padding: '12px 20px', borderRadius: '8px', display: 'inline-block' }}>
                  ✓ <strong>{joinStatus.orgName}</strong> found! ({joinStatus.assessments} active assessments available).
                </div>
              ) : (
                <div style={{ background: 'rgba(220, 38, 38, 0.25)', padding: '12px 20px', borderRadius: '8px', display: 'inline-block' }}>
                  {joinStatus.message}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

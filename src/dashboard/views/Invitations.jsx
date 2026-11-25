import { useMemo, useState } from 'react'
import Icon from '../DashboardIcon'
import { getInvitationState } from '../dashboardData'
import { formatDate } from '../format'

const STATE_CLASSES = {
  Active: 'status-published',
  Expired: 'status-expired',
  Revoked: 'status-revoked',
  Exhausted: 'status-exhausted',
}

// Receives the `dashboard` context bag from AdminDashboard.jsx.
export default function Invitations({ dashboard }) {
  const { invitations, search, activeInvites, createInvitation, revokeInvitation } = dashboard
  const [inviteType, setInviteType] = useState('code') // 'code' | 'email'
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('Mentee')
  const [days, setDays] = useState('7')
  const [maxUses, setMaxUses] = useState('10')
  const [created, setCreated] = useState(null)
  const [copyMessage, setCopyMessage] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [revokingId, setRevokingId] = useState(null)

  const filteredInvitations = useMemo(
    () => invitations.filter((invite) => `${invite.id} ${invite.email || ''} ${invite.role}`.toLowerCase().includes(search.toLowerCase())),
    [invitations, search]
  )

  const handleCreate = async (event) => {
    event.preventDefault()
    if (inviteType === 'email' && !email.trim()) return
    setError('')
    setCopyMessage('')
    setSubmitting(true)
    try {
      const invite = await createInvitation({
        type: inviteType,
        email,
        role,
        days: Number(days),
        maxUses: inviteType === 'email' ? 1 : Number(maxUses),
      })
      setCreated(invite)
      setEmail('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevoke = async (invitationId) => {
    setError('')
    setRevokingId(invitationId)
    try {
      await revokeInvitation(invitationId)
      if (created?.id === invitationId) setCreated(null)
    } catch (err) {
      setError(err.message)
    } finally {
      setRevokingId(null)
    }
  }

  const handleCopy = async (value, label) => {
    setCopyMessage('')
    try {
      await navigator.clipboard.writeText(value)
      setCopyMessage(`${label} copied to the clipboard.`)
    } catch {
      setCopyMessage('Clipboard unavailable — copy the value manually.')
    }
  }

  const inviteUrl = created?.token ? `${window.location.origin}/invite/${created.token}` : ''

  return (
    <>
      <div className="welcome-row">
        <div><p className="eyebrow">ORGANISATION</p><h1>Invitations</h1><p className="subheading">Create invitation codes or email invites and track their use.</p></div>
        <span className="header-count">{activeInvites} active</span>
      </div>
      {error && <p className="inline-message error-message" role="alert">{error}</p>}
      <div className="invite-layout">
        <section className="panel invite-panel">
          <div className="panel-heading"><div><h2>Create invitation</h2><p>Invitees join this organisation after accepting.</p></div></div>
          <form className="invite-form" onSubmit={handleCreate}>
            <div className="segmented" role="radiogroup" aria-label="Invitation type">
              <label className={`radio-pill ${inviteType === 'code' ? 'radio-pill-active' : ''}`}><input type="radio" name="invite-type" value="code" checked={inviteType === 'code'} onChange={() => setInviteType('code')} />Reusable code</label>
              <label className={`radio-pill ${inviteType === 'email' ? 'radio-pill-active' : ''}`}><input type="radio" name="invite-type" value="email" checked={inviteType === 'email'} onChange={() => setInviteType('email')} />Email invite</label>
            </div>
            {inviteType === 'email' && (
              <label className="form-label">Email address<input type="email" required placeholder="name@school.edu" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            )}
            <label className="form-label">Role<select value={role} onChange={(event) => setRole(event.target.value)}><option>Mentee</option><option>Mentor</option><option>Admin</option></select></label>
            <div className="form-row">
              <label className="form-label">Expires in<select value={days} onChange={(event) => setDays(event.target.value)}><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
              {inviteType === 'code' && (
                <label className="form-label">Max uses<input type="number" min="1" max="100" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} /></label>
              )}
            </div>
            <div className="invite-note"><Icon name="shield" size={15} /><span>Tokens are stored hashed on the server and validated on acceptance; email invites are single-use.</span></div>
            <button type="submit" className="button button-primary" disabled={submitting}><Icon name="plus" size={16} /> {submitting ? 'Creating…' : 'Create invitation'}</button>
            {created && (
              <div className="invite-result" role="status">
                <div>
                  <p>Code: <strong className="invite-code">{created.token}</strong></p>
                  <small>Save or share this now — tokens are stored hashed and won&apos;t be shown again.</small>
                </div>
                <div className="row-actions">
                  <button type="button" className="button button-secondary" onClick={() => handleCopy(created.token, 'Invitation code')}><Icon name="copy" size={15} /> Copy code</button>
                  <button type="button" className="button button-secondary" onClick={() => handleCopy(inviteUrl, 'Invitation link')}><Icon name="copy" size={15} /> Copy link</button>
                </div>
              </div>
            )}
            {copyMessage && <p className="inline-message success-message" role="status">{copyMessage}</p>}
          </form>
        </section>

        <section className="panel table-panel">
          <div className="panel-heading"><div><h2>Invitations <span className="muted-count">{invitations.length}</span></h2><p>Outstanding and past invitations for this organisation.</p></div></div>
          <div className="table-wrap"><table><thead><tr><th>INVITATION</th><th>ROLE</th><th>USES</th><th>EXPIRES</th><th>STATUS</th><th></th></tr></thead><tbody>
            {filteredInvitations.map((invite) => {
              const state = getInvitationState(invite)
              return <tr key={invite.id}>
                <td><div className="signal-copy"><strong className="invite-code">{invite.id}</strong><small>{invite.type === 'email' ? invite.email : 'Reusable join code'}</small></div></td>
                <td>{invite.role}</td>
                <td>{invite.uses} / {invite.maxUses}</td>
                <td>{formatDate(invite.expiresAt || invite.expires)}</td>
                <td><span className={`status-pill ${STATE_CLASSES[state]}`}>{state}</span></td>
                <td><div className="row-actions">
                  {state === 'Active' && <button className="small-button small-button-danger" disabled={revokingId === invite.id} onClick={() => handleRevoke(invite.id)} aria-label={`Revoke invitation ${invite.id}`}>{revokingId === invite.id ? 'Revoking…' : 'Revoke'}</button>}
                </div></td>
              </tr>
            })}
            {filteredInvitations.length === 0 && <tr><td className="empty-row" colSpan="6">No invitations match your search.</td></tr>}
          </tbody></table></div>
        </section>
      </div>
    </>
  )
}
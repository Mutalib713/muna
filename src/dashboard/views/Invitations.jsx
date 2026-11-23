import { useMemo, useState } from 'react'
import Icon from '../DashboardIcon'
import { getInvitationState } from '../dashboardData'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDate(iso) {
  const [year, month, day] = iso.split('-')
  return `${MONTHS[Number(month) - 1]} ${Number(day)}, ${year}`
}

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

  const filteredInvitations = useMemo(
    () => invitations.filter((invite) => `${invite.id} ${invite.email || ''}`.toLowerCase().includes(search.toLowerCase())),
    [invitations, search]
  )

  const handleCreate = (event) => {
    event.preventDefault()
    if (inviteType === 'email' && !email.trim()) return
    const invite = createInvitation({ type: inviteType, email, role, days: Number(days), maxUses })
    setCreated(invite)
    setCopyMessage('')
    setEmail('')
  }

  const handleCopy = async (code) => {
    setCopyMessage('')
    try {
      await navigator.clipboard.writeText(code)
      setCopyMessage(`Copied ${code} to the clipboard.`)
    } catch {
      setCopyMessage('Clipboard unavailable — copy the code manually.')
    }
  }

  return (
    <>
      <div className="welcome-row">
        <div><p className="eyebrow">ORGANISATION</p><h1>Invitations</h1><p className="subheading">Create invitation codes or email invites and track their use.</p></div>
        <span className="header-count">{activeInvites} active</span>
      </div>
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
            <label className="form-label">Role<select value={role} onChange={(event) => setRole(event.target.value)}><option>Mentee</option><option>Mentor</option></select></label>
            <div className="form-row">
              <label className="form-label">Expires in<select value={days} onChange={(event) => setDays(event.target.value)}><option value="3">3 days</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></label>
              {inviteType === 'code' && (
                <label className="form-label">Max uses<input type="number" min="1" max="100" value={maxUses} onChange={(event) => setMaxUses(event.target.value)} /></label>
              )}
            </div>
            <div className="invite-note"><Icon name="shield" size={15} /><span>Codes are validated server-side on acceptance; email invites are single-use.</span></div>
            <button type="submit" className="button button-primary"><Icon name="plus" size={16} /> Create invitation</button>
            {created && (
              <div className="invite-result" role="status">
                <p>Invitation created: <strong className="invite-code">{created.id}</strong></p>
                <button type="button" className="button button-secondary" onClick={() => handleCopy(created.id)}><Icon name="copy" size={15} /> Copy code</button>
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
                <td>{formatDate(invite.expires)}</td>
                <td><span className={`status-pill ${STATE_CLASSES[state]}`}>{state}</span></td>
                <td><div className="row-actions">
                  {state === 'Active' && <button className="small-button icon-only" onClick={() => handleCopy(invite.id)} aria-label={`Copy invitation code ${invite.id}`} title="Copy code"><Icon name="copy" size={14} /></button>}
                  {state === 'Active' && <button className="small-button small-button-danger" onClick={() => revokeInvitation(invite.id)} aria-label={`Revoke invitation ${invite.id}`}>Revoke</button>}
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
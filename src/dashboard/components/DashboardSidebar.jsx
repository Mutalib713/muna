import { useState } from 'react'
import Icon from '../DashboardIcon'

function initialsFor(name) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

export default function DashboardSidebar({
  views,
  activeView,
  badges,
  admin,
  organisations = [],
  activeOrganisation = null,
  onSelectOrganisation,
  onCreateOrganisation,
  onNavigate,
  onHelp,
}) {
  const [creatingOrg, setCreatingOrg] = useState(false)
  const [newOrgName, setNewOrgName] = useState('')
  const [orgError, setOrgError] = useState('')
  const staffOrganisations = organisations.filter((org) => ['Owner', 'Admin', 'Mentor'].includes(org.role))

  async function handleCreateSubmit(event) {
    event.preventDefault()
    if (!newOrgName.trim()) return
    setOrgError('')
    try {
      await onCreateOrganisation?.(newOrgName.trim())
      setNewOrgName('')
      setCreatingOrg(false)
    } catch (error) {
      setOrgError(error.message)
    }
  }

  return (
    <aside className="sidebar">
      <a className="brand" href="#/" aria-label="Back to the Muna landing page"><span className="brand-mark">m</span><span>muna<span className="brand-dot">.</span></span></a>
      <div className="workspace-label">WORKSPACE</div>
      {staffOrganisations.length > 0 && (
        <div className="workspace-switcher">
          <select
            aria-label="Active organisation"
            value={activeOrganisation?.id || ''}
            onChange={(event) => onSelectOrganisation?.(event.target.value)}
          >
            {staffOrganisations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name} ({org.role})
              </option>
            ))}
          </select>
          <button
            type="button"
            className="workspace-add-btn"
            title="Create new organisation"
            onClick={() => { setCreatingOrg((open) => !open); setOrgError('') }}
          >
            {creatingOrg ? '×' : '+'}
          </button>
        </div>
      )}
      {creatingOrg && (
        <form className="workspace-create-form" onSubmit={handleCreateSubmit}>
          <input
            type="text"
            placeholder="New organisation name"
            value={newOrgName}
            onChange={(event) => setNewOrgName(event.target.value)}
            required
          />
          {orgError && <small className="inline-message error-message">{orgError}</small>}
          <button type="submit" className="button button-primary button-sm">Create workspace</button>
        </form>
      )}
      <nav className="main-nav" aria-label="Main navigation">
        {views.map((item) => <button key={item.label} className={`nav-item ${activeView === item.label ? 'nav-active' : ''}`} onClick={() => onNavigate(item.label)}><Icon name={item.icon} size={18} /><span>{item.label}</span>{item.badge && badges[item.badge] > 0 && <span className={`nav-badge${item.badge === 'flags' ? ' nav-badge-warm' : ''}`}>{badges[item.badge]}</span>}</button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="help-card"><span className="help-spark">✦</span><strong>Need a hand?</strong><p>Visit the help center for tips and guides.</p><button onClick={onHelp}>Open help center <span>→</span></button></div>
        <div className="profile"><span className="profile-avatar">{initialsFor(admin.name || admin.email)}</span><span className="profile-text"><strong>{admin.name}</strong><small>{admin.email}</small></span></div>
      </div>
    </aside>
  )
}

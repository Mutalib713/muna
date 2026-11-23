import Icon from '../DashboardIcon'

function initialsFor(name) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

export default function DashboardSidebar({ views, activeView, badges, admin, onNavigate, onHelp }) {
  return (
    <aside className="sidebar">
      <a className="brand" href="#/" aria-label="Back to the Muna landing page"><span className="brand-mark">m</span><span>muna<span className="brand-dot">.</span></span></a>
      <div className="workspace-label">WORKSPACE</div>
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

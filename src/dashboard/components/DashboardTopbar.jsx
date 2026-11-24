import Icon from '../DashboardIcon'

function initialsFor(name) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

export default function DashboardTopbar({ activeView, search, admin, onSearch, onLogout }) {
  return (
    <header className="topbar">
      <div className="breadcrumb">Workspace <span>/</span> <strong>{activeView}</strong></div>
      <div className="topbar-actions">
        <label className="search-box"><Icon name="search" size={17} /><input type="search" placeholder="Search anything..." value={search} onChange={(event) => onSearch(event.target.value)} aria-label="Search current view" /><kbd>⌘ K</kbd></label>
        <button className="logout-button" onClick={onLogout}>Sign out</button>
        <span className="top-avatar">{initialsFor(admin.name || admin.email)}</span>
      </div>
    </header>
  )
}

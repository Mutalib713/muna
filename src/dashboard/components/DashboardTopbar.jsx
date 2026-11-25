import { useEffect, useRef } from 'react'
import Icon from '../DashboardIcon'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const searchShortcut = isMac ? '⌘ K' : 'Ctrl K'

function initialsFor(name) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

export default function DashboardTopbar({ activeView, search, admin, onSearch, onLogout }) {
  const searchInput = useRef(null)

  useEffect(() => {
    const handleKeyDown = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchInput.current?.focus()
        searchInput.current?.select()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <header className="topbar">
      <div className="breadcrumb">Workspace <span>/</span> <strong>{activeView}</strong></div>
      <div className="topbar-actions">
        <label className="search-box"><Icon name="search" size={17} /><input ref={searchInput} type="search" placeholder="Search this view..." value={search} onChange={(event) => onSearch(event.target.value)} aria-label="Search current view" /><kbd>{searchShortcut}</kbd></label>
        <button className="logout-button" onClick={onLogout}>Sign out</button>
        <span className="top-avatar" title={admin.name}>{initialsFor(admin.name || admin.email)}</span>
      </div>
    </header>
  )
}
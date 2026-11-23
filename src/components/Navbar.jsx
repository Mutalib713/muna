import { ShieldCheck } from '../icons'

export default function Navbar({ onOpenModal }) {
  return (
    <header className="navbar">
      <div className="content-wrap nav-content">
        <div className="brand-group">
          <div className="brand-icon-box">
            <ShieldCheck size={22} />
          </div>
          <div>
            <div className="brand-title">MUNA</div>
            <div className="brand-tag">Assessment Platform</div>
          </div>
        </div>

        <nav className="nav-links">
          <a href="#features" className="nav-link">Features</a>
          <a href="#studio" className="nav-link">Question Studio</a>
          <a href="#security" className="nav-link">Security Model</a>
          <a href="#workspaces" className="nav-link">Workspaces</a>
        </nav>

        <div className="nav-actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => onOpenModal('join')}
          >
            Enter Code
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => onOpenModal('mentor')}
          >
            Mentor Portal
          </button>
        </div>
      </div>
    </header>
  )
}

import Icon from '../DashboardIcon'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const searchShortcut = isMac ? '⌘ K' : 'Ctrl K'

export default function HelpModal({ onClose }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="modal-card help-modal" role="dialog" aria-modal="true" aria-labelledby="help-modal-title">
        <div className="modal-heading">
          <div><p className="eyebrow">ADMIN WORKSPACE</p><h2 id="help-modal-title">Quick guide</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </div>

        <div className="help-section">
          <h3>Keyboard</h3>
          <div className="help-row"><span>Search the current view</span><kbd>{searchShortcut}</kbd></div>
          <div className="help-row"><span>Close a dialog</span><kbd>Esc</kbd></div>
        </div>

        <div className="help-section">
          <h3>What is saved</h3>
          <p>Questions, assessments, review decisions and review notes are stored in SQLite. Submissions, integrity signals, mentees, members and invitations are sample records for now.</p>
        </div>

        <div className="help-section">
          <h3>Setup and tests</h3>
          <p>Run <code>npm run setup</code> once to create the admin account, then <code>npm run dev</code> to start the app. <code>npm test</code> covers the admin API.</p>
        </div>

        <div className="modal-actions">
          <a className="button button-secondary" href="https://github.com/nonydev27/muna#admin-dashboard-and-api" target="_blank" rel="noreferrer">Read the setup guide</a>
          <button className="button button-primary" onClick={onClose}>Done</button>
        </div>
      </section>
    </div>
  )
}
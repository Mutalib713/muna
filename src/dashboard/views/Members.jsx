import { useMemo, useState } from 'react'
import Icon from '../DashboardIcon'
import StudentCell from '../components/StudentCell'
import { formatDate } from '../format'

const ROLE_OPTIONS = ['Admin', 'Mentor', 'Mentee']
const ROLE_FILTERS = ['All roles', 'Owner', 'Admin', 'Mentor', 'Mentee']

// Receives the `dashboard` context bag from AdminDashboard.jsx.
export default function Members({ dashboard }) {
  const { members, search, navigate, updateMemberRole, toggleMemberStatus, removeMember } = dashboard
  const [roleFilter, setRoleFilter] = useState('All roles')
  const [busyId, setBusyId] = useState(null)
  const [error, setError] = useState('')

  const filteredMembers = useMemo(() => members.filter((member) => {
    const matchesRole = roleFilter === 'All roles' || member.role === roleFilter
    const matchesSearch = `${member.name} ${member.email}`.toLowerCase().includes(search.toLowerCase())
    return matchesRole && matchesSearch
  }), [members, roleFilter, search])

  const activeCount = members.filter((member) => member.status === 'Active').length

  async function handleRoleChange(member, nextRole) {
    setError('')
    setBusyId(member.id)
    try {
      await updateMemberRole(member.id, nextRole)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleToggleStatus(member) {
    setError('')
    setBusyId(member.id)
    try {
      await toggleMemberStatus(member.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  async function handleRemove(member) {
    if (!window.confirm(`Remove ${member.name} from this organisation?`)) return
    setError('')
    setBusyId(member.id)
    try {
      await removeMember(member.id)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <div className="welcome-row">
        <div><p className="eyebrow">PEOPLE</p><h1>Members</h1><p className="subheading">Manage mentors and mentees in this organisation.</p></div>
        <div className="button-row">
          <span className="header-count">{activeCount} active</span>
          <button className="button button-primary" onClick={() => navigate('Invitations')}><Icon name="userplus" size={17} /> Invite members</button>
        </div>
      </div>
      {error && <p className="inline-message error-message" role="alert">{error}</p>}
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Organisation members</h2><p>Roles are scoped to this organisation; changes apply to this workspace only.</p></div><select className="select-button filter-select" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} aria-label="Filter members by role">{ROLE_FILTERS.map((role) => <option key={role}>{role}</option>)}</select></div>
        <div className="table-wrap"><table><thead><tr><th>MEMBER</th><th>ROLE</th><th>STATUS</th><th>JOINED</th><th>ACTIONS</th></tr></thead><tbody>
          {filteredMembers.map((member) => {
            const isBusy = busyId === member.id
            return <tr key={member.id}>
              <td><StudentCell name={member.name} initials={member.initials} id={member.email} /></td>
              <td>{member.role === 'Owner'
                ? <span className="status-pill status-published">Owner</span>
                : <select className="member-role-select" disabled={isBusy} value={member.role} onChange={(event) => handleRoleChange(member, event.target.value)} aria-label={`Role for ${member.name}`}>{ROLE_OPTIONS.map((role) => <option key={role}>{role}</option>)}</select>}</td>
              <td><span className={`status-pill ${member.status === 'Active' ? 'status-published' : 'status-review'}`}>{member.status}</span></td>
              <td>{formatDate(member.joinedAt || member.joined)}</td>
              <td>{member.role !== 'Owner' && <div className="row-actions">
                <button className="small-button" disabled={isBusy} onClick={() => handleToggleStatus(member)} aria-label={`${member.status === 'Active' ? 'Suspend' : 'Restore'} ${member.name}`}>{member.status === 'Active' ? 'Suspend' : 'Restore'}</button>
                <button className="small-button small-button-danger" disabled={isBusy} onClick={() => handleRemove(member)} aria-label={`Remove ${member.name}`}>Remove</button>
              </div>}</td>
            </tr>
          })}
          {filteredMembers.length === 0 && <tr><td className="empty-row" colSpan="5">No members match your filters.</td></tr>}
        </tbody></table></div>
      </section>
    </>
  )
}
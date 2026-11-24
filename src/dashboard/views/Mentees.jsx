import { useMemo, useState } from 'react'

const emptyForm = { name: '', email: '' }

export default function Mentees({ dashboard }) {
  const { mentees, search, createMentee, updateMentee, deleteMentee } = dashboard
  const [modalOpen, setModalOpen] = useState(false)
  const [editingId, setEditingId] = useState(null)
  const [form, setForm] = useState(emptyForm)
  const [error, setError] = useState('')

  const filtered = useMemo(
    () => mentees.filter((mentee) => `${mentee.name} ${mentee.email}`.toLowerCase().includes(search.toLowerCase())),
    [mentees, search]
  )

  function openCreate() {
    setEditingId(null)
    setForm(emptyForm)
    setError('')
    setModalOpen(true)
  }

  function openEdit(mentee) {
    setEditingId(mentee.id)
    setForm({ name: mentee.name, email: mentee.email })
    setError('')
    setModalOpen(true)
  }

  async function save(event) {
    event.preventDefault()
    setError('')
    try {
      if (editingId) await updateMentee(editingId, form)
      else await createMentee(form)
      setModalOpen(false)
      setEditingId(null)
      setForm(emptyForm)
    } catch (saveError) {
      setError(saveError.message)
    }
  }

  async function remove(mentee) {
    if (!window.confirm(`Remove ${mentee.name}? Their assignments and attempts will be removed.`)) return
    setError('')
    try {
      await deleteMentee(mentee.id)
    } catch (deleteError) {
      setError(deleteError.message)
    }
  }

  return (
    <>
      <div className="welcome-row">
        <div><p className="eyebrow">WORKSPACE</p><h1>Mentees</h1><p className="subheading">Manage the students assigned to assessments.</p></div>
        <button className="button button-primary" onClick={openCreate}>+ Add mentee</button>
      </div>
      {error && <p className="inline-message error-message" role="alert">{error}</p>}
      <section className="panel table-panel">
        <div className="panel-heading"><div><h2>Student roster</h2><p>{mentees.length} mentees in this workspace</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>MENTEE</th><th>EMAIL</th><th>ID</th><th></th></tr></thead><tbody>
          {filtered.map((mentee) => <tr key={mentee.id}><td><strong>{mentee.name}</strong></td><td>{mentee.email}</td><td>{mentee.id}</td><td><div className="mentee-actions"><button className="small-button" onClick={() => openEdit(mentee)}>Edit</button><button className="small-button" onClick={() => remove(mentee)}>Remove</button></div></td></tr>)}
          {filtered.length === 0 && <tr><td className="empty-row" colSpan="4">No mentees match your search.</td></tr>}
        </tbody></table></div>
      </section>
      {modalOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setModalOpen(false) }}>
        <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="mentee-modal-title">
          <div className="modal-heading"><div><p className="eyebrow">MENTEE DIRECTORY</p><h2 id="mentee-modal-title">{editingId ? 'Edit mentee' : 'Add mentee'}</h2></div><button className="icon-button" onClick={() => setModalOpen(false)} aria-label="Close">×</button></div>
          <form onSubmit={save}>
            <label className="form-label">Full name<input autoFocus required maxLength="120" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Student name" /></label>
            <label className="form-label">Email address<input type="email" required maxLength="254" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="student@example.com" /></label>
            {error && <p className="inline-message error-message" role="alert">{error}</p>}
            <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setModalOpen(false)}>Cancel</button><button type="submit" className="button button-primary">{editingId ? 'Save changes' : 'Add mentee'}</button></div>
          </form>
        </section>
      </div>}
    </>
  )
}

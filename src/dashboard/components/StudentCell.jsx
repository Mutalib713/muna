function initialsFor(name) {
  return name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

export default function StudentCell({ name, initials, id }) {
  return <div className="student-cell"><span className="student-avatar">{initials || initialsFor(name)}</span><span><strong>{name}</strong><small>{id}</small></span></div>
}
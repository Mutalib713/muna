export default function Input({ id, label, hint, ...inputProps }) {
  return (
    <div className="form-field">
      <label className="form-label" htmlFor={id}>{label}</label>
      <input className="form-input" id={id} {...inputProps} />
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  )
}

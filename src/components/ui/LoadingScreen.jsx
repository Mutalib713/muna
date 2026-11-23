export default function LoadingScreen({ label = 'Loading Muna' }) {
  return (
    <div className="stream-loader" role="status" aria-label={label}>
      <div className="stream-shell" aria-hidden="true">
        <div className="stream-brand shimmer-block" />
        <div className="stream-title shimmer-block" />
        <div className="stream-copy shimmer-block" />
        <div className="stream-copy stream-copy-short shimmer-block" />
        <div className="stream-card shimmer-block" />
      </div>
      <span className="sr-only">{label}...</span>
    </div>
  )
}

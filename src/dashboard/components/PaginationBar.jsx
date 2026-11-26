export default function PaginationBar({ pagination, onPageChange }) {
  if (!pagination || pagination.total === 0) return null
  const { page, pages, total } = pagination
  if (pages <= 1) return null

  return (
    <div className="pagination-bar" role="navigation" aria-label="Pagination">
      <span className="pagination-summary">
        Page <strong>{page}</strong> of <strong>{pages}</strong> · {total} total
      </span>
      <div className="pagination-buttons">
        <button
          type="button"
          className="small-button"
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="small-button"
          disabled={page >= pages}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  )
}

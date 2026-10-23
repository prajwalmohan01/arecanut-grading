import Button from './Button';

export default function Pagination({ page = 1, pages = 1, total = 0, onPage, label = 'records' }) {
  if (!total || pages <= 1) {
    return (
      <div className="flex items-center justify-between px-4 py-3 text-xs text-muted">
        <span>
          {total.toLocaleString()} {label}
        </span>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[color:var(--border)] px-4 py-3">
      <p className="text-xs text-muted">
        Page {page} of {pages} · {total.toLocaleString()} {label}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPage(page + 1)}
          disabled={page >= pages}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

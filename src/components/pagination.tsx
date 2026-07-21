import Link from "next/link";

export function parsePage(value?: string) {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
}

function pageHref(pathname: string, page: number, search?: string) {
  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set("q", search);
  return `${pathname}?${params.toString()}`;
}

export function Pagination({
  pathname,
  page,
  hasNext,
  search,
}: {
  pathname: string;
  page: number;
  hasNext: boolean;
  search?: string;
}) {
  const controlClass =
    "rounded-lg border px-4 py-2 text-sm font-semibold transition";
  const disabledClass = `${controlClass} cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400`;
  const enabledClass = `${controlClass} border-slate-300 bg-white text-slate-700 hover:border-brand-primary/30 hover:text-brand-primary`;

  return (
    <nav aria-label="Pagination" className="mt-6 flex items-center justify-between gap-4">
      {page === 1 ? (
        <span aria-disabled="true" className={disabledClass}>Previous</span>
      ) : (
        <Link href={pageHref(pathname, page - 1, search)} className={enabledClass}>
          Previous
        </Link>
      )}
      <span className="text-sm font-medium text-slate-600">Page {page}</span>
      {hasNext ? (
        <Link href={pageHref(pathname, page + 1, search)} className={enabledClass}>
          Next
        </Link>
      ) : (
        <span aria-disabled="true" className={disabledClass}>Next</span>
      )}
    </nav>
  );
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm sm:p-10">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-sky-50 text-lg font-bold text-sky-700">
        +
      </div>
      <h2 className="mt-6 text-xl font-semibold text-slate-950">{title}</h2>
      <p className="mt-2 max-w-xl leading-7 text-slate-600">{description}</p>
      <button
        type="button"
        className="mt-6 rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-sky-700"
      >
        Add placeholder
      </button>
    </section>
  );
}

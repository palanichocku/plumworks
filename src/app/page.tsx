export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 py-16 text-white">
      <section className="w-full max-w-3xl rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl shadow-black/20 backdrop-blur sm:p-12">
        <p className="mb-6 text-sm font-semibold uppercase tracking-[0.24em] text-sky-300">
          Cloud-first shop management
        </p>
        <h1 className="text-5xl font-semibold tracking-tight sm:text-7xl">
          Car Doc
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300 sm:text-xl">
          A modern workspace for auto repair shops. The application foundation
          is ready for the first MVP features.
        </p>
        <div className="mt-10 inline-flex items-center gap-3 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-4 py-2 text-sm font-medium text-emerald-200">
          <span className="h-2 w-2 rounded-full bg-emerald-300" />
          Framework scaffold complete
        </div>
      </section>
    </main>
  );
}

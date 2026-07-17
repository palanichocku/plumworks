export function MarketingPageHero({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <section className="border-b border-slate-200 bg-white">
    <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6 sm:py-20">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-orange-600">{eyebrow}</p>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">{title}</h1>
      <p className="mx-auto mt-5 max-w-2xl text-lg leading-8 text-slate-600">{description}</p>
    </div>
  </section>;
}

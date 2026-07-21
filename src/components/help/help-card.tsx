import Link from "next/link";

export function HelpCard({ title, description, href, result }: { title: string; description: string; href?: string; result?: string }) {
  const content = <><h2 className="text-base font-bold text-slate-950">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-600">{description}</p>{result && <p className="mt-4 border-t border-slate-100 pt-3 text-xs font-semibold uppercase tracking-wide text-brand-primary">Result: {result}</p>}</>;
  const classes = "rounded-2xl border border-slate-200 bg-white p-5 shadow-sm";
  return href ? <Link href={href} className={`${classes} transition hover:-translate-y-0.5 hover:border-brand-primary/30 hover:shadow-md`}>{content}</Link> : <article className={classes}>{content}</article>;
}

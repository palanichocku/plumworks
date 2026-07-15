import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { getShopReport } from "@/lib/data/reports";
import { formatDate, formatMoney } from "@/lib/formatters";

export const dynamic = "force-dynamic";

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function validDate(value: string | undefined) {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)));
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const now = new Date();
  const defaultFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = isoDate(now);
  const from = validDate(params.from) ? params.from! : defaultFrom;
  const to = validDate(params.to) ? params.to! : defaultTo;
  const start = new Date(`${from}T00:00:00Z`);
  const requestedEnd = new Date(`${to}T00:00:00Z`);
  const safeEnd = requestedEnd < start ? start : requestedEnd;
  const endExclusive = new Date(safeEnd);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const report = await getShopReport({ start, endExclusive });

  if (!report) return null;

  const cards = [
    ["Invoice count", report.invoiceTotals._count._all.toLocaleString()],
    ["Gross sales", formatMoney(report.invoiceTotals._sum.total)],
    ["Parts total", formatMoney(report.invoiceTotals._sum.partsTotal)],
    ["Labor total", formatMoney(report.invoiceTotals._sum.laborTotal)],
    ["Tax total", formatMoney(report.invoiceTotals._sum.taxTotal)],
    ["Payments received", formatMoney(report.paymentTotals._sum.amount)],
    ["Open AR balance", formatMoney(report.arTotals._sum.balance)],
  ];

  return <>
    <PageHeading eyebrow="Analytics" title="Reports" description="Recorded shop activity and balances for a selected date range." />
    <form action="/reports" className="mb-6 flex flex-wrap items-end gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <label className="text-sm font-semibold text-slate-700">From<input name="from" type="date" required defaultValue={from} className="mt-1.5 block rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
      <label className="text-sm font-semibold text-slate-700">To<input name="to" type="date" required defaultValue={to} className="mt-1.5 block rounded-lg border border-slate-300 px-3 py-2 font-normal" /></label>
      <button className="rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700" type="submit">Run report</button>
    </form>

    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {cards.map(([label, value]) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><p className="text-sm font-medium text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold text-slate-950">{value}</p></article>)}
    </section>

    <ReportSection title="Invoices in range" empty="No invoices were recorded in this date range." headings={["Invoice / RO", "Date", "Status", "Parts", "Labor", "Total"]}>
      {report.invoices.map((invoice) => <tr key={invoice.id}><td className="px-5 py-4"><Link href={`/invoices/${invoice.id}`} className="font-semibold text-sky-700 hover:text-sky-800">RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Not recorded"}</Link></td><td className="px-5 py-4 text-slate-600">{formatDate(invoice.invoiceDate)}</td><td className="px-5 py-4 capitalize text-slate-600">{invoice.status}</td><td className="px-5 py-4 text-right">{formatMoney(invoice.partsTotal)}</td><td className="px-5 py-4 text-right">{formatMoney(invoice.laborTotal)}</td><td className="px-5 py-4 text-right font-semibold">{formatMoney(invoice.total)}</td></tr>)}
    </ReportSection>

    <ReportSection title="Payments in range" empty="No payments were recorded in this date range." headings={["Invoice / RO", "Date", "Method", "Amount"]}>
      {report.payments.map((payment) => <tr key={payment.id}><td className="px-5 py-4">{payment.invoice ? <Link href={`/invoices/${payment.invoice.id}`} className="font-semibold text-sky-700 hover:text-sky-800">RO #{payment.invoice.repairOrderNumber ?? payment.invoice.legacyRoNo ?? "Not recorded"}</Link> : "Invoice not linked"}</td><td className="px-5 py-4 text-slate-600">{formatDate(payment.paidAt)}</td><td className="px-5 py-4 capitalize text-slate-600">{payment.method ?? "Not specified"}</td><td className="px-5 py-4 text-right font-semibold">{formatMoney(payment.amount)}</td></tr>)}
    </ReportSection>

    <ReportSection title={`Open accounts receivable (${report.arTotals._count._all.toLocaleString()})`} empty="No open receivables remain." headings={["Invoice / RO", "Date", "Status", "Total", "Paid", "Balance"]}>
      {report.receivables.map((row) => <tr key={row.id}><td className="px-5 py-4">{row.invoice ? <Link href={`/invoices/${row.invoice.id}`} className="font-semibold text-sky-700 hover:text-sky-800">RO #{row.invoice.repairOrderNumber ?? row.invoice.legacyRoNo ?? "Not recorded"}</Link> : "Invoice not linked"}</td><td className="px-5 py-4 text-slate-600">{formatDate(row.invoice?.invoiceDate)}</td><td className="px-5 py-4 capitalize text-slate-600">{row.status}</td><td className="px-5 py-4 text-right">{formatMoney(row.invoice?.total)}</td><td className="px-5 py-4 text-right">{formatMoney(row.invoice?.paidTotal)}</td><td className="px-5 py-4 text-right font-semibold">{formatMoney(row.balance)}</td></tr>)}
    </ReportSection>
  </>;
}

function ReportSection({ title, empty, headings, children }: { title: string; empty: string; headings: string[]; children: React.ReactNode }) {
  const rows = Array.isArray(children) ? children : [children];
  return <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="border-b border-slate-200 px-5 py-4"><h2 className="text-lg font-semibold text-slate-950">{title}</h2></div>{rows.length === 0 ? <p className="px-5 py-8 text-sm text-slate-600">{empty}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="bg-slate-50 text-slate-600"><tr>{headings.map((heading, index) => <th key={heading} className={`px-5 py-3 ${index >= headings.length - 3 ? "text-right" : ""}`}>{heading}</th>)}</tr></thead><tbody className="divide-y divide-slate-200">{children}</tbody></table></div>}<p className="border-t border-slate-200 px-5 py-3 text-xs text-slate-500">Showing up to 100 rows.</p></section>;
}

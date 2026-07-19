import Link from "next/link";
import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { getCurrentMembership } from "@/lib/data/membership";
import { getShopReport } from "@/lib/data/reports";
import { inclusiveUtcDateRange } from "@/lib/daily-sales-aggregation";
import { formatDate, formatMoney } from "@/lib/formatters";
import { hasPermission } from "@/lib/permissions";

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
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "view_reports")) return <PermissionDenied />;
  
  const now = new Date();
  const defaultFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = isoDate(now);
  const from = validDate(params.from) ? params.from! : defaultFrom;
  const to = validDate(params.to) ? params.to! : defaultTo;
  
  const { start, endExclusive } = inclusiveUtcDateRange(from, to);
  
  const report = await getShopReport({ start, endExclusive });
  if (!report) return null;

  const salesCards = [
    { label: "Invoices", value: report.sales.invoiceCount.toLocaleString(), highlight: false },
    { label: "Gross sales", value: formatMoney(report.sales.grossSalesTotal), highlight: true },
    { label: "Parts", value: formatMoney(report.sales.partsTotal), highlight: false },
    { label: "Labor", value: formatMoney(report.sales.laborTotal), highlight: false },
    { label: "Shop supplies", value: formatMoney(report.sales.shopSuppliesTotal), highlight: false },
    { label: "Sales tax", value: formatMoney(report.sales.ordinarySalesTaxTotal), highlight: false },
    { label: "Discounts/reductions", value: formatMoney(report.sales.discountsTotal), highlight: false },
  ];
  if (!report.sales.legacyChargeTotal.isZero()) {
    salesCards.push({ label: "Legacy charges", value: formatMoney(report.sales.legacyChargeTotal), highlight: false });
  }
  const paymentCards = [
    { label: "Cash", value: formatMoney(report.payments.cashTotal) },
    { label: "Check", value: formatMoney(report.payments.checkTotal) },
    { label: "Card", value: formatMoney(report.payments.cardTotal) },
    { label: "Internal", value: formatMoney(report.payments.internalTotal) },
    { label: "Other", value: formatMoney(report.payments.otherTotal) },
    { label: "Payment total", value: formatMoney(report.payments.paymentTotal) },
    { label: "Payment rows", value: report.payments.paymentRowCount.toLocaleString() },
    { label: "Paid invoices", value: report.payments.paidInvoiceCount.toLocaleString() },
    { label: "Split-tender invoices", value: report.payments.splitTenderInvoiceCount.toLocaleString() },
  ];
  const hasDifference = !report.reconciliation.salesPaymentDifference.isZero() ||
    !report.reconciliation.invoicePaidPaymentDifference.isZero();

  const inputClass = "mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 font-medium shadow-2xs outline-none transition-all focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10";

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeading eyebrow="Analytics" title="Reports" description="Recorded shop activity, sales breakdowns, and balances for a selected date range." />
      
      {/* Premium Filter Control Panel */}
      <form action="/reports" className="flex flex-col sm:flex-row items-end gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="w-full sm:w-auto flex-1 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
            From Date
            <input name="from" type="date" required defaultValue={from} className={inputClass} />
          </label>
          <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
            To Date
            <input name="to" type="date" required defaultValue={to} className={inputClass} />
          </label>
        </div>
        <button 
          className="w-full sm:w-auto rounded-lg bg-sky-600 px-5 py-2.5 text-sm font-semibold text-white shadow-xs transition-colors hover:bg-sky-700 focus:outline-none focus:ring-4 focus:ring-sky-500/20" 
          type="submit"
        >
          Run Report
        </button>
      </form>
      <p className="-mt-3 text-xs text-slate-500">
        Report dates use inclusive UTC calendar days. Sales are grouped by invoice date; payments are grouped by payment date.
      </p>

      <SummarySection title="Sales Summary">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {salesCards.map(({ label, value, highlight }) => (
            <article 
              key={label} 
              className={`rounded-2xl border p-5 shadow-sm transition-all hover:shadow-md ${
                highlight 
                  ? "border-sky-200 bg-sky-50/40 ring-1 ring-sky-100" 
                  : "border-slate-200 bg-white"
              }`}
            >
              <p className={`text-xs font-bold uppercase tracking-wider ${highlight ? "text-sky-700" : "text-slate-400"}`}>
                {label}
              </p>
              <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">
                {value}
              </p>
            </article>
          ))}
        </section>
      </SummarySection>

      <SummarySection title="Payment Summary">
        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {paymentCards.map(({ label, value }) => (
            <MetricCard key={label} label={label} value={value} />
          ))}
        </section>
        <div className={`mt-4 rounded-xl border p-4 text-sm ${hasDifference ? "border-amber-300 bg-amber-50 text-amber-950" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}>
          <p className="font-semibold">Sales − payments: {formatMoney(report.reconciliation.salesPaymentDifference)}</p>
          <p className="mt-1 font-semibold">Invoice paid − payments: {formatMoney(report.reconciliation.invoicePaidPaymentDifference)}</p>
          <p className="mt-2 text-xs leading-relaxed opacity-80">
            Sales use invoice date; payments use payment date. A difference can be valid when payment timing differs from the invoice date.
          </p>
          {hasDifference ? <p className="mt-2 font-bold">Review the nonzero reconciliation difference.</p> : null}
        </div>
      </SummarySection>

      {/* Invoice Data Grid Output */}
      <ReportSection 
        title="Invoices in Range" 
        empty="No invoices or closed repair manifests were recorded in this date range." 
        headings={["Invoice / RO", "Date", "Status", "Parts", "Labor", "Total"]}
      >
        {report.invoices.map((invoice) => (
          <tr key={invoice.id} className="group transition-colors hover:bg-slate-50/60">
            <td className="px-5 py-3.5 text-sm">
              <Link 
                href={`/invoices/${invoice.id}`} 
                className="font-bold text-sky-600 hover:text-sky-700 hover:underline transition-colors"
              >
                RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Draft"}
              </Link>
            </td>
            <td className="px-5 py-3.5 text-sm font-medium text-slate-500">
              {formatDate(invoice.invoiceDate)}
            </td>
            <td className="px-5 py-3.5 text-sm">
              <span className="inline-flex rounded-md bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-700 shadow-2xs capitalize">
                {invoice.status}
              </span>
            </td>
            <td className="px-5 py-3.5 text-sm text-right font-medium text-slate-500">
              {formatMoney(invoice.partsTotal)}
            </td>
            <td className="px-5 py-3.5 text-sm text-right font-medium text-slate-500">
              {formatMoney(invoice.laborTotal)}
            </td>
            <td className="px-5 py-3.5 text-sm text-right font-black text-slate-900">
              {formatMoney(invoice.total)}
            </td>
          </tr>
        ))}
      </ReportSection>
    </div>
  );
}

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="mb-4 text-base font-bold text-slate-900">{title}</h2>
      {children}
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight text-slate-900">{value}</p>
    </article>
  );
}

function ReportSection({ title, empty, headings, children }: { title: string; empty: string; headings: string[]; children: React.ReactNode }) {
  const rows = Array.isArray(children) ? children : [children];
  const thClass = "px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-500 select-none";
  
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-slate-50/50 px-5 py-4">
        <h2 className="text-base font-bold text-slate-900">{title}</h2>
      </div>
      
      {rows.length === 0 ? (
        <p className="px-5 py-8 text-sm font-medium text-slate-400 text-center italic bg-white">{empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75">
                {headings.map((heading, index) => (
                  <th 
                    key={heading} 
                    className={`${thClass} ${index >= headings.length - 3 ? "text-right" : ""}`}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {children}
            </tbody>
          </table>
        </div>
      )}
      <div className="border-t border-slate-100 bg-slate-50/30 px-5 py-3 text-xs font-medium text-slate-400 italic">
        Showing up to 100 rows matching search parameters.
      </div>
    </section>
  );
}

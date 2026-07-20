import Link from "next/link";
import { DailySalesReportControls } from "@/components/daily-sales-report-controls";
import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { getCurrentMembership } from "@/lib/data/membership";
import { getDailySalesReportModel } from "@/lib/data/reports";
import { canEmailDailySalesReport, DAILY_SALES_COLUMNS, formatReportDateRange, formatReportGeneratedTime, isIsoReportDate, normalizeDailySalesReportOutput } from "@/lib/daily-sales-report-model";
import { formatDate, formatMoney } from "@/lib/formatters";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; output?: string }>;
}) {
  const params = await searchParams;
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "view_reports")) return <PermissionDenied />;
  
  const now = new Date();
  const defaultFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = isoDate(now);
  const from = isIsoReportDate(params.from) ? params.from : defaultFrom;
  const to = isIsoReportDate(params.to) ? params.to : defaultTo;
  const output = normalizeDailySalesReportOutput(params.output);
  const report = await getDailySalesReportModel({ from, to });
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
  const otherInternalTotal = report.payments.internalTotal.plus(report.payments.otherTotal);
  const paymentCards = [
    { label: "Cash", value: formatMoney(report.payments.cashTotal) },
    { label: "Check", value: formatMoney(report.payments.checkTotal) },
    { label: "Card", value: formatMoney(report.payments.cardTotal) },
    { label: "Internal", value: formatMoney(otherInternalTotal) },
    { label: "Payment total", value: formatMoney(report.payments.paymentTotal) },
    { label: "Payment rows", value: report.payments.paymentRowCount.toLocaleString() },
    { label: "Paid invoices", value: report.payments.paidInvoiceCount.toLocaleString() },
    { label: "Split-tender invoices", value: report.payments.splitTenderInvoiceCount.toLocaleString() },
  ];
  const hasDifference = !report.reconciliation.salesPaymentDifference.isZero() ||
    !report.reconciliation.invoicePaidPaymentDifference.isZero();

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeading eyebrow="Analytics" title="Reports" description="Recorded shop activity, sales breakdowns, and balances for a selected date range." />
      
      <DailySalesReportControls
        key={`${report.from}:${report.to}`}
        loadedFrom={report.from}
        loadedTo={report.to}
        formattedRange={formatReportDateRange(report.from, report.to)}
        generatedTime={formatReportGeneratedTime(report.generatedAt)}
        invoiceCount={report.invoices.length}
        initialOutput={output}
        canEmail={canEmailDailySalesReport(membership.role)}
        summary={<><SummarySection title="Sales Summary">
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
      </SummarySection></>}

      detail={<ReportSection
        title="Invoices in Range" 
        empty="No invoices or closed repair manifests were recorded in this date range." 
        headings={[...DAILY_SALES_COLUMNS]}
        rowCount={report.invoices.length}
        footer={(
          <tr className="border-t-2 border-slate-300 bg-slate-100 font-bold text-slate-950">
            <th className="px-4 py-3 text-left text-xs uppercase tracking-wider" colSpan={4} scope="row">Totals</th>
            <MoneyCell value={report.sales.grossSalesTotal} strong />
            <MoneyCell value={report.sales.partsTotal} />
            <MoneyCell value={report.sales.laborTotal} />
            <MoneyCell value={report.sales.shopSuppliesTotal} />
            <MoneyCell value={report.sales.ordinarySalesTaxTotal} />
            <MoneyCell value={report.payments.cashTotal} />
            <MoneyCell value={report.payments.checkTotal} />
            <MoneyCell value={report.payments.cardTotal} />
            <MoneyCell value={otherInternalTotal} />
          </tr>
        )}
      >
        {report.invoices.map((invoice) => (
          <tr key={invoice.id} className="group transition-colors hover:bg-slate-50/60">
            <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-slate-500">
              {formatDate(invoice.invoiceDate)}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-sm">
              <Link 
                href={`/invoices/${invoice.id}`} 
                className="font-bold text-sky-600 hover:text-sky-700 hover:underline transition-colors"
              >
                RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Draft"}
              </Link>
              {invoice.isSplitTender ? <span className="ml-2 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-sky-800">Split</span> : null}
            </td>
            <td className="max-w-48 px-4 py-3 text-sm font-medium text-slate-700">
              {invoice.customer.displayName}
            </td>
            <td className="max-w-52 px-4 py-3 text-sm text-slate-600">
              {vehicleLabel(invoice.vehicle)}
            </td>
            <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-black text-slate-900 tabular-nums">
              <span>{formatMoney(invoice.total)}</span>
              {!invoice.discountsTotal.isZero() || !invoice.legacyChargeTotal.isZero() ? (
                <span className="mt-1 block text-[10px] font-medium text-slate-500">
                  {!invoice.discountsTotal.isZero() ? `Reductions ${formatMoney(invoice.discountsTotal)}` : null}
                  {!invoice.discountsTotal.isZero() && !invoice.legacyChargeTotal.isZero() ? " · " : null}
                  {!invoice.legacyChargeTotal.isZero() ? `Legacy ${formatMoney(invoice.legacyChargeTotal)}` : null}
                </span>
              ) : null}
              {invoice.hasPaymentMismatch ? (
                <span className="mt-1 block text-[10px] font-bold text-amber-700">
                  Payment variance: paid {formatMoney(invoice.paymentDifference)}, total {formatMoney(invoice.totalPaymentDifference)}
                </span>
              ) : null}
            </td>
            <MoneyCell value={invoice.partsTotal} />
            <MoneyCell value={invoice.laborTotal} />
            <MoneyCell value={invoice.shopSuppliesAmount} />
            <MoneyCell value={invoice.taxTotal} />
            <MoneyCell value={invoice.cashTotal} />
            <MoneyCell value={invoice.checkTotal} />
            <MoneyCell value={invoice.cardTotal} />
            <MoneyCell value={invoice.otherInternalTotal} />
          </tr>
        ))}
      </ReportSection>}
      />
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

function MoneyCell({ value, strong = false }: { value: { toString(): string }; strong?: boolean }) {
  return (
    <td className={`whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums ${strong ? "font-black text-slate-950" : "font-medium text-slate-600"}`}>
      {formatMoney(value)}
    </td>
  );
}

function vehicleLabel(vehicle: { year: number | null; make: string | null; model: string | null } | null) {
  if (!vehicle) return "—";
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable";
}

function ReportSection({ title, empty, headings, children, footer, rowCount }: { title: string; empty: string; headings: string[]; children: React.ReactNode; footer?: React.ReactNode; rowCount: number }) {
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
          <table className="w-full min-w-[1560px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/75">
                {headings.map((heading, index) => (
                  <th 
                    key={heading} 
                    className={`${thClass} whitespace-nowrap ${index >= 4 ? "text-right" : ""}`}
                  >
                    {heading}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {children}
            </tbody>
            {footer ? <tfoot>{footer}</tfoot> : null}
          </table>
        </div>
      )}
      <div className="border-t border-slate-100 bg-slate-50/30 px-5 py-3 text-xs font-medium text-slate-400 italic">
        Showing all {rowCount.toLocaleString()} invoices in the selected range.
      </div>
    </section>
  );
}

import Link from "next/link";
import { DailySalesReportControls } from "@/components/daily-sales-report-controls";
import { PageHeading } from "@/components/page-heading";
import { PermissionDenied } from "@/components/permission-denied";
import { getCurrentMembership } from "@/lib/data/membership";
import { getDailySalesReportModel } from "@/lib/data/reports";
import { 
  canEmailDailySalesReport, 
  DAILY_SALES_COLUMNS, 
  formatReportDateRange, 
  formatReportGeneratedTime, 
  normalizeDailySalesReportOutput 
} from "@/lib/daily-sales-report-model";
import { formatDate, formatMoney } from "@/lib/formatters";
import { hasPermission } from "@/lib/permissions";
import { ReportFilterForm } from "@/components/report-filter-form";
import { resolveSalesReportPeriod, type SalesReportPeriodParams } from "@/lib/sales-report-period";

export const dynamic = "force-dynamic";

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SalesReportPeriodParams & { output?: string }>;
}) {
  const params = await searchParams;
  const { membership } = await getCurrentMembership();
  if (!membership) return null;
  if (!hasPermission(membership.role, "view_reports")) return <PermissionDenied />;
  
  const now = new Date();
  const defaultFrom = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  const defaultTo = isoDate(now);
  const output = normalizeDailySalesReportOutput(params.output);
  const resolved = resolveSalesReportPeriod(params, { from: defaultFrom, to: defaultTo });
  if (!resolved.ok) {
    return <div className="space-y-6"><PageHeading eyebrow="Analytics" title="Reports" description="Recorded shop activity and sales breakdowns." /><div role="alert" className="rounded-2xl border-2 border-red-200 bg-red-50 p-6 text-red-900"><h2 className="font-black">Invalid report period</h2><p className="mt-2 text-sm">{resolved.error}</p><Link href="/reports" className="mt-4 inline-flex rounded-lg bg-slate-900 px-4 py-2 text-sm font-bold text-white">Return to Reports</Link></div></div>;
  }
  const period = resolved.period;
  const report = await getDailySalesReportModel({ from: period.from, to: period.to });
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

  const reportPayload = `
${period.title} (${formatReportDateRange(report.from, report.to)})
Generated: ${formatReportGeneratedTime(report.generatedAt)}

-- SUMMARY --
Invoices: ${report.sales.invoiceCount.toLocaleString()}
Gross Sales: ${formatMoney(report.sales.grossSalesTotal)}
Payment Total: ${formatMoney(report.payments.paymentTotal)}
  `.trim();

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Force Landscape and exact colors for printing */}
      <style>{`
        @media print {
          @page { size: landscape; margin: 0.5in; }
          body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        }
      `}</style>

      <div className="print:hidden">
        <PageHeading eyebrow="Analytics" title="Reports" description="Recorded shop activity, sales breakdowns, and balances for a selected date range." />
      </div>
      
      <ReportFilterForm key={JSON.stringify(period.query)} initialPeriod={period} output={output} />
      
      <DailySalesReportControls
        key={`${report.from}:${report.to}`}
        formattedRange={formatReportDateRange(report.from, report.to)}
        generatedTime={formatReportGeneratedTime(report.generatedAt)}
        invoiceCount={report.invoices.length}
        initialOutput={output}
        period={period}
        canEmail={canEmailDailySalesReport(membership.role)}
        reportPayload={reportPayload}
        summary={
          <>
            <SummarySection title="Sales Summary">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {salesCards.map(({ label, value, highlight }) => (
                  <article
                    key={label} 
                    className={`rounded-xl border p-5 shadow-sm transition-colors print:break-inside-avoid print:rounded-none print:border-slate-300 print:bg-white print:p-3 print:shadow-none ${
                      highlight 
                        ? "border-brand-primary/40 bg-brand-subtle/40"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-600 print:text-slate-700">
                      {label}
                    </p>
                    <p className={`mt-2 text-2xl tracking-tight text-slate-900 tabular-nums print:text-xl ${highlight ? "font-semibold" : "font-normal"}`}>
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
              <div className={`mt-5 rounded-lg border p-4 text-sm print:break-inside-avoid print:rounded-none print:border-slate-300 print:bg-white print:text-slate-900 ${hasDifference ? "border-amber-300 bg-amber-50 text-amber-950" : "border-slate-200 bg-white text-slate-800"}`}>
                <p>Sales − payments: <span className="font-medium tabular-nums">{formatMoney(report.reconciliation.salesPaymentDifference)}</span></p>
                <p className="mt-1">Invoice paid − payments: <span className="font-medium tabular-nums">{formatMoney(report.reconciliation.invoicePaidPaymentDifference)}</span></p>
                <p className="mt-2 leading-relaxed text-slate-600 print:hidden">
                  Sales use finalized-sale date; payments use payment date. A difference can be valid when payment timing differs from the sale date.
                </p>
                {hasDifference ? <p className="mt-3 font-semibold text-amber-800">Review the nonzero reconciliation difference.</p> : null}
              </div>
            </SummarySection>
          </>
        }
        detail={
          <ReportSection
            title="Invoices in Range" 
            empty="No invoices or closed repair manifests were recorded in this date range." 
            headings={[...DAILY_SALES_COLUMNS]}
            rowCount={report.invoices.length}
            footer={(
              <tr className="border-t-2 border-slate-400 bg-slate-50 font-semibold text-slate-950 print:bg-white">
                <th className="px-4 py-3 text-left text-xs uppercase tracking-wide print:px-2 print:py-2" colSpan={4} scope="row">Totals</th>
                <MoneyCell value={report.sales.grossSalesTotal} strong />
                <MoneyCell value={report.sales.partsTotal} strong />
                <MoneyCell value={report.sales.laborTotal} strong />
                <MoneyCell value={report.sales.shopSuppliesTotal} strong />
                <MoneyCell value={report.sales.ordinarySalesTaxTotal} strong />
                <MoneyCell value={report.payments.cashTotal} strong />
                <MoneyCell value={report.payments.checkTotal} strong />
                <MoneyCell value={report.payments.cardTotal} strong />
                <MoneyCell value={otherInternalTotal} strong />
              </tr>
            )}
          >
            {report.invoices.map((invoice) => (
              <tr key={invoice.id} className="group border-b border-slate-100 transition-colors last:border-0 hover:bg-slate-50 print:break-inside-avoid">
                <td className="whitespace-nowrap px-4 py-3 text-sm font-normal text-slate-600 print:px-2 print:py-2 print:text-[10px]">
                  {formatDate(invoice.reportingDate)}
                </td>
                <td className="whitespace-nowrap px-5 py-4 print:px-2 print:py-2 text-sm print:text-[10px]">
                  <Link 
                    href={`/invoices/${invoice.id}`} 
                    className="font-medium text-brand-primary transition-colors hover:text-brand-primary hover:underline print:text-slate-900"
                  >
                    RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Draft"}
                  </Link>
                  {invoice.isSplitTender ? <span className="ml-2 rounded border border-slate-200 px-1.5 py-0.5 text-[10px] font-medium uppercase text-slate-600 print:border-0 print:p-0 print:text-[8px]">Split</span> : null}
                </td>
                <td className="max-w-48 px-4 py-3 text-sm font-normal text-slate-800 print:px-2 print:py-2 print:text-[10px]">
                  {invoice.customer.displayName}
                </td>
                <td className="max-w-52 px-4 py-3 text-sm font-normal text-slate-600 print:px-2 print:py-2 print:text-[10px]">
                  {vehicleLabel(invoice.vehicle)}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium tabular-nums text-slate-900 print:px-2 print:py-2 print:text-[10px]">
                  <span className="print:text-xs">{formatMoney(invoice.total)}</span>
                  {!invoice.discountsTotal.isZero() || !invoice.legacyChargeTotal.isZero() ? (
                    <span className="mt-1 block text-[11px] font-normal text-slate-500 print:text-[9px]">
                      {!invoice.discountsTotal.isZero() ? `Reductions ${formatMoney(invoice.discountsTotal)}` : null}
                      {!invoice.discountsTotal.isZero() && !invoice.legacyChargeTotal.isZero() ? " · " : null}
                      {!invoice.legacyChargeTotal.isZero() ? `Legacy ${formatMoney(invoice.legacyChargeTotal)}` : null}
                    </span>
                  ) : null}
                  {/* Cleaned up variance to stack smoothly under the total */}
                  {invoice.hasPaymentMismatch ? (
                    <span className="mt-1 block text-[11px] font-medium text-amber-700 print:text-[9px]">
                      Var: {formatMoney(invoice.totalPaymentDifference)}
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
          </ReportSection>
        }
      />
    </div>
  );
}

function SummarySection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:rounded-none print:border-0 print:bg-white print:p-0 print:shadow-none">
      <h2 className="mb-4 text-base font-semibold text-slate-900 print:mb-3">{title}</h2>
      {children}
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm print:break-inside-avoid print:rounded-none print:border-slate-300 print:p-3 print:shadow-none">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-600">{label}</p>
      <p className="mt-2 text-2xl font-normal tracking-tight tabular-nums text-slate-900 print:text-xl">{value}</p>
    </article>
  );
}

function MoneyCell({ value, strong = false }: { value: { toString(): string }; strong?: boolean }) {
  return (
    <td className={`whitespace-nowrap px-4 py-3 text-right text-sm tabular-nums print:px-2 print:py-2 print:text-[10px] ${strong ? "font-semibold text-slate-950 print:text-xs" : "font-normal text-slate-700"}`}>
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
  const thClass = "select-none bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-600 print:border-b print:border-slate-400 print:bg-white print:px-2 print:py-2 print:text-[9px]";
  
  return (
    <section className="mt-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm print:mt-4 print:rounded-none print:border-0 print:shadow-none">
      <div className="border-b border-slate-200 bg-white px-5 py-4 print:px-2 print:py-2">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
      </div>
      
      {rows.length === 0 ? (
        <p className="bg-white px-6 py-10 text-center text-sm font-normal italic text-slate-500">{empty}</p>
      ) : (
        // Print overrides to allow the table to flex naturally on standard page widths
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full min-w-[1560px] print:min-w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200">
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
            <tbody className="bg-white">
              {children}
            </tbody>
            {footer ? <tfoot>{footer}</tfoot> : null}
          </table>
        </div>
      )}
      <div className="border-t border-slate-200 bg-white px-5 py-3 text-sm font-normal italic text-slate-500 print:px-2 print:py-2 print:text-xs">
        Showing all {rowCount.toLocaleString()} invoices in the selected range.
      </div>
    </section>
  );
}

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
  isIsoReportDate, 
  normalizeDailySalesReportOutput 
} from "@/lib/daily-sales-report-model";
import { formatDate, formatMoney } from "@/lib/formatters";
import { hasPermission } from "@/lib/permissions";
import { ReportFilterForm } from "@/components/report-filter-form";

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

  const reportPayload = `
Daily Sales Report (${formatReportDateRange(report.from, report.to)})
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
      
      <ReportFilterForm initialFrom={from} initialTo={to} output={output} />
      
      <DailySalesReportControls
        key={`${report.from}:${report.to}`}
        loadedFrom={report.from}
        loadedTo={report.to}
        formattedRange={formatReportDateRange(report.from, report.to)}
        generatedTime={formatReportGeneratedTime(report.generatedAt)}
        invoiceCount={report.invoices.length}
        initialOutput={output}
        canEmail={canEmailDailySalesReport(membership.role)}
        reportPayload={reportPayload}
        summary={
          <>
            <SummarySection title="Sales Summary">
              <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {salesCards.map(({ label, value, highlight }) => (
                  <article 
                    key={label} 
                    className={`rounded-2xl border-2 p-6 shadow-sm transition-all hover:shadow-md print:break-inside-avoid print:p-4 ${
                      highlight 
                        ? "border-brand-primary bg-brand-subtle ring-1 ring-brand-subtle" 
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <p className={`text-xs font-bold uppercase tracking-wider ${highlight ? "text-brand-primary" : "text-slate-500"}`}>
                      {label}
                    </p>
                    <p className="mt-2 text-3xl font-black tracking-tight text-slate-900 print:text-2xl">
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
              <div className={`mt-6 rounded-xl border-2 p-5 text-sm print:break-inside-avoid ${hasDifference ? "border-amber-300 bg-amber-50 text-amber-950" : "border-emerald-300 bg-emerald-50 text-emerald-950"}`}>
                <p className="font-bold text-base">Sales − payments: {formatMoney(report.reconciliation.salesPaymentDifference)}</p>
                <p className="mt-1 font-bold text-base">Invoice paid − payments: {formatMoney(report.reconciliation.invoicePaidPaymentDifference)}</p>
                <p className="mt-2 font-medium leading-relaxed opacity-90 print:hidden">
                  Sales use invoice date; payments use payment date. A difference can be valid when payment timing differs from the invoice date.
                </p>
                {hasDifference ? <p className="mt-3 font-black text-amber-800">Review the nonzero reconciliation difference.</p> : null}
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
              <tr className="border-t-4 border-slate-300 bg-slate-200 font-black text-slate-950">
                <th className="px-5 py-4 print:px-2 print:py-2 text-left text-xs uppercase tracking-wider" colSpan={4} scope="row">Totals</th>
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
              <tr key={invoice.id} className="group transition-colors hover:bg-slate-50 border-b border-slate-100 last:border-0 print:break-inside-avoid">
                <td className="whitespace-nowrap px-5 py-4 print:px-2 print:py-2 text-sm print:text-[10px] font-bold text-slate-600">
                  {formatDate(invoice.invoiceDate)}
                </td>
                <td className="whitespace-nowrap px-5 py-4 print:px-2 print:py-2 text-sm print:text-[10px]">
                  <Link 
                    href={`/invoices/${invoice.id}`} 
                    className="font-black text-brand-primary hover:text-brand-primary hover:underline transition-colors"
                  >
                    RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Draft"}
                  </Link>
                  {invoice.isSplitTender ? <span className="ml-2 rounded-md bg-brand-subtle px-2 py-1 text-[10px] print:text-[8px] font-black uppercase text-brand-primary">Split</span> : null}
                </td>
                <td className="max-w-48 px-5 py-4 print:px-2 print:py-2 text-sm print:text-[10px] font-bold text-slate-800">
                  {invoice.customer.displayName}
                </td>
                <td className="max-w-52 px-5 py-4 print:px-2 print:py-2 text-sm print:text-[10px] font-medium text-slate-600">
                  {vehicleLabel(invoice.vehicle)}
                </td>
                <td className="whitespace-nowrap px-5 py-4 print:px-2 print:py-2 text-right text-sm print:text-[10px] font-black text-slate-900 tabular-nums">
                  <span className="text-base print:text-xs">{formatMoney(invoice.total)}</span>
                  {!invoice.discountsTotal.isZero() || !invoice.legacyChargeTotal.isZero() ? (
                    <span className="mt-1 block text-[11px] print:text-[9px] font-bold text-slate-500">
                      {!invoice.discountsTotal.isZero() ? `Reductions ${formatMoney(invoice.discountsTotal)}` : null}
                      {!invoice.discountsTotal.isZero() && !invoice.legacyChargeTotal.isZero() ? " · " : null}
                      {!invoice.legacyChargeTotal.isZero() ? `Legacy ${formatMoney(invoice.legacyChargeTotal)}` : null}
                    </span>
                  ) : null}
                  {/* Cleaned up variance to stack smoothly under the total */}
                  {invoice.hasPaymentMismatch ? (
                    <span className="mt-1 block text-[11px] print:text-[9px] font-black text-amber-700">
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
    <section className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-6 print:border-none print:p-0 print:bg-transparent shadow-sm print:shadow-none">
      <h2 className="mb-5 text-lg font-black text-slate-900 print:mb-3">{title}</h2>
      {children}
    </section>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <article className="rounded-2xl border-2 border-slate-200 bg-white p-6 print:p-4 print:break-inside-avoid shadow-sm print:shadow-none">
      <p className="text-xs font-bold uppercase tracking-wider text-slate-500">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight text-slate-900 print:text-2xl">{value}</p>
    </article>
  );
}

function MoneyCell({ value, strong = false }: { value: { toString(): string }; strong?: boolean }) {
  return (
    <td className={`whitespace-nowrap px-5 py-4 print:px-2 print:py-2 text-right text-sm print:text-[10px] tabular-nums ${strong ? "font-black text-slate-950 text-base print:text-xs" : "font-bold text-slate-600"}`}>
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
  const thClass = "px-5 py-4 print:px-2 print:py-2 text-xs print:text-[9px] font-black uppercase tracking-wider text-slate-500 select-none bg-slate-100 print:bg-transparent print:border-b-2 print:border-slate-300";
  
  return (
    <section className="mt-8 overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-sm print:mt-4 print:border-none print:shadow-none">
      <div className="border-b-2 border-slate-200 bg-slate-50 px-6 py-5 print:px-2 print:py-2 print:bg-transparent">
        <h2 className="text-lg font-black text-slate-900">{title}</h2>
      </div>
      
      {rows.length === 0 ? (
        <p className="px-6 py-10 text-base font-bold text-slate-500 text-center italic bg-white">{empty}</p>
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
      <div className="border-t-2 border-slate-200 bg-slate-50 px-6 py-4 print:px-2 print:py-2 text-sm print:text-xs font-bold text-slate-500 italic print:bg-transparent">
        Showing all {rowCount.toLocaleString()} invoices in the selected range.
      </div>
    </section>
  );
}
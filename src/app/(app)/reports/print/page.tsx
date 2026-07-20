import Link from "next/link";
import { PermissionDenied } from "@/components/permission-denied";
import { PrintButton } from "@/components/print-button";
import { getCurrentMembership } from "@/lib/data/membership";
import { getDailySalesReportModel, type DailySalesReportModel } from "@/lib/data/reports";
import {
  DAILY_SALES_COLUMNS,
  formatReportDateRange,
  formatReportGeneratedAt,
  isValidReportRange,
  normalizeDailySalesReportOutput,
} from "@/lib/daily-sales-report-model";
import { formatDate, formatMoney } from "@/lib/formatters";
import { hasPermission } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export default async function PrintableDailySalesPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; output?: string }>;
}) {
  const [{ membership }, params] = await Promise.all([getCurrentMembership(), searchParams]);
  if (!membership) return <PrintError title="Shop access required" message="Sign in with an active shop membership to view this report." />;
  if (!hasPermission(membership.role, "view_reports")) return <PermissionDenied />;
  if (!isValidReportRange(params.from, params.to)) {
    return <PrintError title="Invalid report dates" message="Choose a valid start and end date, with the end date on or after the start date." />;
  }
  const from = params.from as string;
  const to = params.to as string;
  const output = normalizeDailySalesReportOutput(params.output);

  let report: DailySalesReportModel | null = null;
  try {
    report = await getDailySalesReportModel({ from, to });
  } catch {
    // Render the stable error state outside the catch block.
  }
  if (!report) return <PrintError title="Report unavailable" message="The Daily Sales report could not be loaded. No data was changed; try again shortly." />;

  const backHref = `/reports?from=${encodeURIComponent(report.from)}&to=${encodeURIComponent(report.to)}&output=${output}`;
  const otherInternalTotal = report.payments.internalTotal.plus(report.payments.otherTotal);
  const hasDifference = !report.reconciliation.salesPaymentDifference.isZero() ||
    !report.reconciliation.invoicePaidPaymentDifference.isZero();

  return (
    <article className={`${output === "summary" ? "daily-sales-summary-print max-w-4xl" : "daily-sales-print max-w-[1800px]"} mx-auto min-h-screen bg-white text-slate-950`}>
      <div className="print-hidden flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
        <Link href={backHref} className="rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">← Back to Report</Link>
        <PrintButton label="Print Report" ariaLabel={`Print Daily Sales ${output}`} />
      </div>

      <div className="daily-sales-print-content px-5 py-5">
        <header className="daily-sales-print-heading flex items-start justify-between gap-6 border-b border-slate-300 pb-3">
          <div>
            <p className="text-sm font-semibold text-slate-700">{report.shop.name}</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{output === "summary" ? "Daily Sales Summary" : "Daily Sales Report"}</h1>
            <p className="mt-1 text-sm text-slate-700">{formatReportDateRange(report.from, report.to)}</p>
          </div>
          <p className="text-right text-xs text-slate-600">{formatReportGeneratedAt(report.generatedAt)}</p>
        </header>

        <section className="daily-sales-print-summary mt-3 grid gap-4 sm:grid-cols-2" aria-label="Report summaries">
          <CompactSummary title="Sales Summary" rows={[
            ["Parts", formatMoney(report.sales.partsTotal)],
            ["Labor", formatMoney(report.sales.laborTotal)],
            ["Shop Supplies", formatMoney(report.sales.shopSuppliesTotal)],
            ["Sales Tax", formatMoney(report.sales.ordinarySalesTaxTotal)],
            ["Discounts / Reductions", formatMoney(report.sales.discountsTotal)],
            ...(!report.sales.legacyChargeTotal.isZero() ? [["Legacy Charges", formatMoney(report.sales.legacyChargeTotal)] as [string, string]] : []),
            ["Total Sales", formatMoney(report.sales.grossSalesTotal)],
          ]} />
          <CompactSummary title="Payment Summary" rows={[
            ["Cash", formatMoney(report.payments.cashTotal)],
            ["Check", formatMoney(report.payments.checkTotal)],
            ["Card", formatMoney(report.payments.cardTotal)],
            ["Internal", formatMoney(otherInternalTotal)],
            ["Total Payments", formatMoney(report.payments.paymentTotal)],
          ]} />
        </section>

        <div className={`daily-sales-print-reconciliation mt-3 border px-3 py-2 text-xs ${hasDifference ? "border-amber-400 text-amber-950" : "border-slate-300 text-slate-700"}`}>
          Sales − payments: {formatMoney(report.reconciliation.salesPaymentDifference)} · Invoice paid − payments: {formatMoney(report.reconciliation.invoicePaidPaymentDifference)}
          <span className="ml-2 text-slate-500">Sales use invoice date; payments use payment date.</span>
        </div>

        {report.invoices.length === 0 ? (
          <p className="mt-8 border border-dashed border-slate-300 px-5 py-8 text-center text-sm text-slate-600">No sales were found for this date range.</p>
        ) : output === "detail" ? (
          <section className="daily-sales-print-listing mt-4" aria-labelledby="daily-sales-detail-title">
            <h2 id="daily-sales-detail-title" className="mb-2 text-sm font-semibold">Invoice Detail — {report.invoices.length.toLocaleString()} invoices</h2>
            <table className="daily-sales-print-table w-full border-collapse">
              <thead><tr>{DAILY_SALES_COLUMNS.map((heading, index) => <th key={heading} className={index >= 4 ? "text-right" : "text-left"}>{heading}</th>)}</tr></thead>
              <tbody>{report.invoices.map((invoice) => <tr key={invoice.id}>
                <td>{formatDate(invoice.invoiceDate)}</td>
                <td className="whitespace-nowrap">RO #{invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Draft"}{invoice.isSplitTender ? <span className="block text-[6.5pt]">Split tender</span> : null}</td>
                <td className="daily-sales-print-description">{invoice.customer.displayName}</td>
                <td className="daily-sales-print-description">{vehicleLabel(invoice.vehicle)}</td>
                <PrintMoneyCell value={invoice.total}>{!invoice.discountsTotal.isZero() || !invoice.legacyChargeTotal.isZero() ? <span className="block text-[6pt] text-slate-600">{!invoice.discountsTotal.isZero() ? `Reductions ${formatMoney(invoice.discountsTotal)}` : ""}{!invoice.discountsTotal.isZero() && !invoice.legacyChargeTotal.isZero() ? " · " : ""}{!invoice.legacyChargeTotal.isZero() ? `Legacy ${formatMoney(invoice.legacyChargeTotal)}` : ""}</span> : null}{invoice.hasPaymentMismatch ? <span className="block text-[6pt] font-semibold">Payment variance</span> : null}</PrintMoneyCell>
                <PrintMoneyCell value={invoice.partsTotal} /><PrintMoneyCell value={invoice.laborTotal} /><PrintMoneyCell value={invoice.shopSuppliesAmount} /><PrintMoneyCell value={invoice.taxTotal} /><PrintMoneyCell value={invoice.cashTotal} /><PrintMoneyCell value={invoice.checkTotal} /><PrintMoneyCell value={invoice.cardTotal} /><PrintMoneyCell value={invoice.otherInternalTotal} />
              </tr>)}</tbody>
              <tfoot><tr><th colSpan={4} scope="row" className="text-left">Totals</th><PrintMoneyCell value={report.sales.grossSalesTotal} /><PrintMoneyCell value={report.sales.partsTotal} /><PrintMoneyCell value={report.sales.laborTotal} /><PrintMoneyCell value={report.sales.shopSuppliesTotal} /><PrintMoneyCell value={report.sales.ordinarySalesTaxTotal} /><PrintMoneyCell value={report.payments.cashTotal} /><PrintMoneyCell value={report.payments.checkTotal} /><PrintMoneyCell value={report.payments.cardTotal} /><PrintMoneyCell value={otherInternalTotal} /></tr></tfoot>
            </table>
          </section>
        ) : null}
      </div>
    </article>
  );
}

function CompactSummary({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return <section className="border border-slate-300 p-3"><h2 className="mb-2 text-sm font-semibold">{title}</h2><dl className="grid grid-cols-[1fr_auto] gap-x-5 gap-y-1 text-xs">{rows.map(([label, value], index) => <div key={label} className={`col-span-2 grid grid-cols-subgrid ${index === rows.length - 1 ? "mt-1 border-t border-slate-300 pt-1" : ""}`}><dt>{label}</dt><dd className="text-right tabular-nums">{value}</dd></div>)}</dl></section>;
}

function PrintMoneyCell({ value, children }: { value: { toString(): string }; children?: React.ReactNode }) {
  return <td className="whitespace-nowrap text-right tabular-nums"><span>{formatMoney(value)}</span>{children}</td>;
}

function PrintError({ title, message }: { title: string; message: string }) {
  return <main className="mx-auto max-w-xl px-5 py-16 text-slate-950"><h1 className="text-2xl font-bold">{title}</h1><p className="mt-3 text-sm leading-6 text-slate-600">{message}</p><Link href="/reports" className="mt-6 inline-flex rounded-lg border border-slate-300 px-4 py-2.5 text-sm font-semibold">Back to Reports</Link></main>;
}

function vehicleLabel(vehicle: { year: number | null; make: string | null; model: string | null } | null) {
  if (!vehicle) return "—";
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable";
}

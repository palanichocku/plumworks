import "server-only";

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { DailySalesReportModel } from "@/lib/data/reports";
import { DAILY_SALES_COLUMNS, formatReportDateRange, formatReportGeneratedAt, type DailySalesReportOutput } from "@/lib/daily-sales-report-model";
import { formatDate, formatMoney } from "@/lib/formatters";

const ROWS_PER_FIRST_PAGE = 22;
const ROWS_PER_FOLLOWING_PAGE = 30;
const widths = [7, 7, 13, 13, 8, 6.5, 6.5, 6.5, 6.5, 6.5, 6.5, 6.5, 6.5];

const styles = StyleSheet.create({
  page: { padding: 20, fontFamily: "Helvetica", fontSize: 6.5, color: "#111827" },
  heading: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.75, borderBottomColor: "#94a3b8", paddingBottom: 6 },
  shop: { fontSize: 9, marginBottom: 2 },
  title: { fontSize: 15, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  muted: { color: "#475569" },
  generated: { fontSize: 7, color: "#475569", textAlign: "right" },
  summaries: { flexDirection: "row", gap: 10, marginTop: 7 },
  summary: { width: "50%", borderWidth: 0.5, borderColor: "#cbd5e1", padding: 6 },
  summaryTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  summaryRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 1 },
  summaryTotal: { borderTopWidth: 0.5, borderTopColor: "#cbd5e1", marginTop: 2, paddingTop: 2 },
  reconciliation: { borderWidth: 0.5, borderColor: "#cbd5e1", marginTop: 6, padding: 4, color: "#334155" },
  detailTitle: { fontSize: 8, fontFamily: "Helvetica-Bold", marginTop: 8, marginBottom: 3 },
  table: { width: "100%" },
  row: { flexDirection: "row", borderBottomWidth: 0.35, borderBottomColor: "#cbd5e1", minHeight: 13 },
  header: { backgroundColor: "#f1f5f9", borderTopWidth: 0.5, borderTopColor: "#94a3b8" },
  footer: { borderTopWidth: 0.8, borderTopColor: "#475569", borderBottomWidth: 0 },
  cell: { paddingHorizontal: 2, paddingVertical: 3, overflow: "hidden" },
  headingCell: { fontFamily: "Helvetica-Bold", fontSize: 5.7, color: "#334155", textTransform: "uppercase" },
  money: { textAlign: "right" },
  total: { fontFamily: "Helvetica-Bold" },
  noData: { marginTop: 18, borderWidth: 0.5, borderStyle: "dashed", borderColor: "#94a3b8", padding: 16, textAlign: "center", fontSize: 8, color: "#475569" },
  pageNumber: { position: "absolute", bottom: 7, right: 20, fontSize: 6, color: "#64748b" },
});

export function DailySalesReportPdf({ report, output = "detail" }: { report: DailySalesReportModel; output?: DailySalesReportOutput }) {
  if (output === "summary") return <DailySalesSummaryPdf report={report} />;
  const pages = paginate(report.invoices);
  const otherInternalTotal = report.payments.internalTotal.plus(report.payments.otherTotal);
  return <Document title={`${report.shop.name} Daily Sales Report`}>
    {pages.map((rows, pageIndex) => {
      const first = pageIndex === 0;
      const last = pageIndex === pages.length - 1;
      return <Page key={pageIndex} size="LETTER" orientation="landscape" style={styles.page}>
        {first ? <>
          <View style={styles.heading}>
            <View><Text style={styles.shop}>{report.shop.name}</Text><Text style={styles.title}>Daily Sales Report</Text><Text style={styles.muted}>{formatReportDateRange(report.from, report.to)}</Text></View>
            <Text style={styles.generated}>{formatReportGeneratedAt(report.generatedAt)}</Text>
          </View>
          <View style={styles.summaries}>
            <PdfSummary title="Sales Summary" rows={[
              ["Parts", formatMoney(report.sales.partsTotal)], ["Labor", formatMoney(report.sales.laborTotal)],
              ["Shop Supplies", formatMoney(report.sales.shopSuppliesTotal)], ["Sales Tax", formatMoney(report.sales.ordinarySalesTaxTotal)],
              ...(!report.sales.discountsTotal.isZero() ? [["Discounts / Reductions", formatMoney(report.sales.discountsTotal)] as [string, string]] : []),
              ["Total Sales", formatMoney(report.sales.grossSalesTotal)],
            ]} />
            <PdfSummary title="Payment Summary" rows={[
              ["Cash", formatMoney(report.payments.cashTotal)], ["Check", formatMoney(report.payments.checkTotal)],
              ["Card", formatMoney(report.payments.cardTotal)], ["Internal", formatMoney(otherInternalTotal)],
              ["Total Payments", formatMoney(report.payments.paymentTotal)],
            ]} />
          </View>
          <Text style={styles.reconciliation}>Sales − payments: {formatMoney(report.reconciliation.salesPaymentDifference)} · Invoice paid − payments: {formatMoney(report.reconciliation.invoicePaidPaymentDifference)} · Sales use invoice date; payments use payment date.</Text>
        </> : null}
        {report.invoices.length === 0 ? <Text style={styles.noData}>No sales were found for this date range.</Text> : <>
          <Text style={styles.detailTitle}>Invoice Detail — {report.invoices.length.toLocaleString()} invoices</Text>
          <View style={styles.table}>
            <PdfTableHeader />
            {rows.map((invoice) => <PdfInvoiceRow key={invoice.id} invoice={invoice} />)}
            {last ? <PdfTotalsRow report={report} /> : null}
          </View>
        </>}
        <Text fixed style={styles.pageNumber} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
      </Page>;
    })}
  </Document>;
}

function DailySalesSummaryPdf({ report }: { report: DailySalesReportModel }) {
  const internal = report.payments.internalTotal.plus(report.payments.otherTotal);
  return <Document title={`${report.shop.name} Daily Sales Summary`}>
    <Page size="LETTER" orientation="portrait" style={[styles.page, { padding: 36, fontSize: 9 }]}>
      <View style={styles.heading}>
        <View><Text style={styles.shop}>{report.shop.name}</Text><Text style={styles.title}>Daily Sales Summary</Text><Text style={styles.muted}>{formatReportDateRange(report.from, report.to)}</Text></View>
        <Text style={styles.generated}>{formatReportGeneratedAt(report.generatedAt)}</Text>
      </View>
      <View style={styles.summaries}>
        <PdfSummary title="Sales Summary" rows={[
          ["Parts", formatMoney(report.sales.partsTotal)], ["Labor", formatMoney(report.sales.laborTotal)],
          ["Shop Supplies", formatMoney(report.sales.shopSuppliesTotal)], ["Sales Tax", formatMoney(report.sales.ordinarySalesTaxTotal)],
          ...(!report.sales.discountsTotal.isZero() ? [["Discounts / Reductions", formatMoney(report.sales.discountsTotal)] as [string, string]] : []),
          ["Total Sales", formatMoney(report.sales.grossSalesTotal)],
        ]} />
        <PdfSummary title="Payment Summary" rows={[
          ["Cash", formatMoney(report.payments.cashTotal)], ["Check", formatMoney(report.payments.checkTotal)],
          ["Card", formatMoney(report.payments.cardTotal)], ["Internal", formatMoney(internal)],
          ["Total Payments", formatMoney(report.payments.paymentTotal)],
        ]} />
      </View>
      <Text style={styles.reconciliation}>Sales − payments: {formatMoney(report.reconciliation.salesPaymentDifference)} · Invoice paid − payments: {formatMoney(report.reconciliation.invoicePaidPaymentDifference)} · Sales use invoice date; payments use payment date.</Text>
      {report.invoices.length === 0 ? <Text style={styles.noData}>No sales were found for this date range.</Text> : null}
    </Page>
  </Document>;
}

function PdfSummary({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return <View style={styles.summary}><Text style={styles.summaryTitle}>{title}</Text>{rows.map(([label, value], index) => <View key={label} style={[styles.summaryRow, index === rows.length - 1 ? styles.summaryTotal : {}]}><Text>{label}</Text><Text>{value}</Text></View>)}</View>;
}

function PdfTableHeader() {
  return <View style={[styles.row, styles.header]}>{DAILY_SALES_COLUMNS.map((heading, index) => <Text key={heading} style={[styles.cell, styles.headingCell, { width: `${widths[index]}%` }, index >= 4 ? styles.money : {}]}>{heading}</Text>)}</View>;
}

function PdfInvoiceRow({ invoice }: { invoice: DailySalesReportModel["invoices"][number] }) {
  const values = [
    formatDate(invoice.invoiceDate), `RO #${invoice.repairOrderNumber ?? invoice.legacyRoNo ?? "Draft"}`,
    invoice.customer.displayName, vehicleLabel(invoice.vehicle), formatMoney(invoice.total), formatMoney(invoice.partsTotal),
    formatMoney(invoice.laborTotal), formatMoney(invoice.shopSuppliesAmount), formatMoney(invoice.taxTotal),
    formatMoney(invoice.cashTotal), formatMoney(invoice.checkTotal), formatMoney(invoice.cardTotal), formatMoney(invoice.otherInternalTotal),
  ];
  return <View wrap={false} style={styles.row}>{values.map((value, index) => <Text key={index} style={[styles.cell, { width: `${widths[index]}%` }, index >= 4 ? styles.money : {}]}>{value}</Text>)}</View>;
}

function PdfTotalsRow({ report }: { report: DailySalesReportModel }) {
  const internal = report.payments.internalTotal.plus(report.payments.otherTotal);
  const values = ["Totals", formatMoney(report.sales.grossSalesTotal), formatMoney(report.sales.partsTotal), formatMoney(report.sales.laborTotal), formatMoney(report.sales.shopSuppliesTotal), formatMoney(report.sales.ordinarySalesTaxTotal), formatMoney(report.payments.cashTotal), formatMoney(report.payments.checkTotal), formatMoney(report.payments.cardTotal), formatMoney(internal)];
  return <View wrap={false} style={[styles.row, styles.footer]}><Text style={[styles.cell, styles.total, { width: "40%" }]}>{values[0]}</Text>{values.slice(1).map((value, index) => <Text key={index} style={[styles.cell, styles.money, styles.total, { width: `${widths[index + 4]}%` }]}>{value}</Text>)}</View>;
}

function paginate<T>(rows: T[]) {
  if (rows.length === 0) return [[]] as T[][];
  const pages: T[][] = [rows.slice(0, ROWS_PER_FIRST_PAGE)];
  for (let index = ROWS_PER_FIRST_PAGE; index < rows.length; index += ROWS_PER_FOLLOWING_PAGE) pages.push(rows.slice(index, index + ROWS_PER_FOLLOWING_PAGE));
  return pages;
}

function vehicleLabel(vehicle: { year: number | null; make: string | null; model: string | null } | null) {
  if (!vehicle) return "—";
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable";
}

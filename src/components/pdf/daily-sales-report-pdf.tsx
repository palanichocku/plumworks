import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatMoney } from "@/lib/formatters";
import { formatReportDateRange, formatReportGeneratedTime } from "@/lib/daily-sales-report-model";
import type { DailySalesReportModel } from "@/lib/data/reports";

// Add the date props to your interface
interface DailySalesReportPDFProps {
  report: DailySalesReportModel;
  fromDate: string;
  toDate: string;
  reportTitle?: string;
}

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#111827", backgroundColor: "#ffffff" },
  header: { marginBottom: 16, borderBottom: "0.75pt solid #9ca3af", paddingBottom: 8 },
  title: { fontSize: 16, fontWeight: "bold", color: "#111827", marginBottom: 4 },
  subtitle: { fontSize: 9, color: "#4b5563", marginBottom: 2 },
  section: { marginBottom: 16 },
  sectionTitle: {
    fontSize: 11,
    fontWeight: "bold",
    color: "#111827",
    paddingBottom: 5,
    marginBottom: 3,
    borderBottom: "0.75pt solid #9ca3af",
  },
  row: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    paddingVertical: 4,
    borderBottom: "0.5pt solid #e5e7eb",
  },
  label: { color: "#374151" },
  value: { color: "#111827" },
  totalRow: { borderTop: "0.75pt solid #6b7280", borderBottom: "none", marginTop: 3, paddingTop: 6 },
  totalLabel: { fontWeight: "bold", color: "#111827" },
  totalValue: { fontWeight: "bold", color: "#111827" },
});

export function DailySalesReportPDF({ report, fromDate, toDate, reportTitle = "Daily Sales Report"}: DailySalesReportPDFProps) {
  const otherInternalTotal = report.payments.internalTotal.plus(report.payments.otherTotal);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>{reportTitle}</Text>
          <Text style={styles.subtitle}>{formatReportDateRange(fromDate, toDate)}</Text>
          <Text style={styles.subtitle}>Generated: {formatReportGeneratedTime(report.generatedAt)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sales Summary</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Invoices</Text>
            <Text style={styles.value}>{report.sales.invoiceCount.toLocaleString()}</Text>
          </View>
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Gross Sales</Text>
            <Text style={styles.totalValue}>{formatMoney(report.sales.grossSalesTotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Parts</Text>
            <Text style={styles.value}>{formatMoney(report.sales.partsTotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Labor</Text>
            <Text style={styles.value}>{formatMoney(report.sales.laborTotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Shop Supplies</Text>
            <Text style={styles.value}>{formatMoney(report.sales.shopSuppliesTotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Sales Tax</Text>
            <Text style={styles.value}>{formatMoney(report.sales.ordinarySalesTaxTotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Discounts / Reductions</Text>
            <Text style={styles.value}>{formatMoney(report.sales.discountsTotal)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Payment Summary</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Cash</Text>
            <Text style={styles.value}>{formatMoney(report.payments.cashTotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Check</Text>
            <Text style={styles.value}>{formatMoney(report.payments.checkTotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Card</Text>
            <Text style={styles.value}>{formatMoney(report.payments.cardTotal)}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Internal</Text>
            <Text style={styles.value}>{formatMoney(otherInternalTotal)}</Text>
          </View>
          <View style={[styles.row, styles.totalRow]}>
            <Text style={styles.totalLabel}>Payment Total</Text>
            <Text style={styles.totalValue}>{formatMoney(report.payments.paymentTotal)}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

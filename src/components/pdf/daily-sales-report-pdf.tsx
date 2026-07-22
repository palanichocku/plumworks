import React from "react";
import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { formatMoney } from "@/lib/formatters";
import { formatReportDateRange, formatReportGeneratedTime } from "@/lib/daily-sales-report-model";

// Add the date props to your interface
interface DailySalesReportPDFProps {
  report: any; // Use your actual report type here
  fromDate: string;
  toDate: string;
}

const styles = StyleSheet.create({
  page: { padding: 40, fontFamily: "Helvetica", fontSize: 10, color: "#1e293b" },
  header: { marginBottom: 20, borderBottom: "1pt solid #cbd5e1", paddingBottom: 10 },
  title: { fontSize: 18, fontWeight: "bold", color: "#0f172a", marginBottom: 4 },
  subtitle: { fontSize: 10, color: "#64748b" },
  section: { marginBottom: 20 },
  sectionTitle: { 
    fontSize: 12, 
    fontWeight: "bold", 
    backgroundColor: "#f8fafc", 
    padding: 6, 
    marginBottom: 8, 
    border: "1pt solid #e2e8f0" 
  },
  row: { 
    flexDirection: "row", 
    justifyContent: "space-between", 
    paddingVertical: 4, 
    borderBottom: "0.5pt solid #f1f5f9" 
  },
  label: { color: "#475569" },
  value: { fontWeight: "bold" },
  highlightValue: { fontWeight: "bold", color: "#0284c7" },
});

// Using 'any' for report to ensure drop-in compatibility, 
// replace with your DailySalesReportModel type if available.
export function DailySalesReportPDF({ report, fromDate, toDate}: DailySalesReportPDFProps) {
  const otherInternalTotal = report.payments.internalTotal + report.payments.otherTotal;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <Text style={styles.title}>Daily Sales Report</Text>
          <Text style={styles.subtitle}>{formatReportDateRange(fromDate, toDate)}</Text>
          <Text style={styles.subtitle}>Generated: {formatReportGeneratedTime(report.generatedAt)}</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Sales Summary</Text>
          <View style={styles.row}>
            <Text style={styles.label}>Invoices</Text>
            <Text style={styles.value}>{report.sales.invoiceCount.toLocaleString()}</Text>
          </View>
          <View style={styles.row}>
            <Text style={styles.label}>Gross Sales</Text>
            <Text style={styles.highlightValue}>{formatMoney(report.sales.grossSalesTotal)}</Text>
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
          <View style={styles.row}>
            <Text style={styles.label}>Payment Total</Text>
            <Text style={styles.highlightValue}>{formatMoney(report.payments.paymentTotal)}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
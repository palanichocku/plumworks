import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { InvoiceDocumentModel } from "@/lib/invoice-document";

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingRight: 32, paddingBottom: 32, paddingLeft: 32, fontFamily: "Helvetica", fontSize: 8.5, lineHeight: 1.28, color: "#000000" },
  repeatHeader: { position: "absolute", top: 16, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", borderBottom: "0.5pt solid #777777", paddingBottom: 4, fontSize: 7.5 },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 16, paddingBottom: 8, borderBottom: "1pt solid #000000" },
  shopName: { fontSize: 14, marginBottom: 2 },
  invoiceTitle: { fontSize: 16, textAlign: "right" },
  right: { textAlign: "right" },
  muted: { color: "#444444" },
  metaGrid: { flexDirection: "row", gap: 16, paddingVertical: 7, borderBottom: "0.5pt solid #777777" },
  metaColumn: { flexGrow: 1, flexBasis: 0 },
  section: { marginTop: 8 },
  sectionTitle: { fontSize: 9, marginBottom: 3, paddingBottom: 2, borderBottom: "0.5pt solid #777777" },
  note: { whiteSpace: "pre-wrap" },
  tableHeader: { flexDirection: "row", borderBottom: "0.75pt solid #000000", paddingVertical: 3, fontSize: 7.5 },
  tableRow: { flexDirection: "row", borderBottom: "0.35pt solid #aaaaaa", paddingVertical: 3 },
  description: { width: "55%", paddingRight: 5 },
  quantity: { width: "10%", textAlign: "right" },
  unit: { width: "16%", textAlign: "right" },
  amount: { width: "19%", textAlign: "right" },
  laborDescription: { width: "52%", paddingRight: 5 },
  laborAmount: { width: "19%", textAlign: "right" },
  technician: { width: "29%", textAlign: "right" },
  bottom: { marginTop: 10, flexDirection: "row", gap: 18, alignItems: "flex-start" },
  legal: { flexGrow: 1, flexBasis: 0 },
  legalBlock: { marginBottom: 6 },
  totals: { width: 190 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grandTotal: { borderTop: "1pt solid #000000", marginTop: 2, paddingTop: 4, fontSize: 10 },
  signature: { marginTop: 12, borderTop: "0.5pt solid #000000", paddingTop: 2 },
  footer: { marginTop: 10, paddingTop: 5, borderTop: "0.5pt solid #777777", textAlign: "center", fontSize: 7.5 },
  voidBanner: { border: "3pt solid #991b1b", color: "#991b1b", padding: 8, marginBottom: 10, textAlign: "center", fontSize: 22, fontWeight: 700, letterSpacing: 4 },
});

function locality(city: string | null, state: string | null, postalCode: string | null) {
  return [[city, state].filter(Boolean).join(", "), postalCode].filter(Boolean).join(" ");
}

function Value({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return <Text><Text style={styles.muted}>{label}: </Text>{String(value)}</Text>;
}

export function InvoiceDocumentPDF({ model }: { model: InvoiceDocumentModel }) {
  const shopLocality = locality(model.shop.city, model.shop.state, model.shop.postalCode);
  const customerLocality = locality(model.customer.city, model.customer.state, model.customer.postalCode);
  return <Document title={`Invoice ${model.invoiceNumber}`} author={model.shop.name}>
    <Page size="LETTER" style={styles.page} wrap>
      {model.status === "void" ? <View style={styles.voidBanner}><Text>VOID</Text><Text style={{ fontSize: 8, letterSpacing: 0, marginTop: 3 }}>Balance due: $0.00 · Voided {model.voidedDate ?? "date unavailable"}</Text></View> : null}
      <View fixed style={styles.repeatHeader}><Text>{model.shop.name}</Text><Text>Invoice {model.invoiceNumber}</Text></View>
      <View style={styles.header}>
        <View>
          <Text style={styles.shopName}>{model.shop.name}</Text>
          {model.shop.addressLine1 ? <Text>{model.shop.addressLine1}</Text> : null}
          {shopLocality ? <Text>{shopLocality}</Text> : null}
          {model.shop.phone ? <Text>{model.shop.phone}</Text> : null}
          {model.shop.repairFacilityRegistrationNumber ? <Text>Repair Facility Registration: {model.shop.repairFacilityRegistrationNumber}</Text> : null}
        </View>
        <View>
          <Text style={styles.invoiceTitle}>INVOICE</Text>
          <Text style={styles.right}>No. {model.invoiceNumber}</Text>
          <Text style={styles.right}>{model.invoiceDate}</Text>
          <Text style={styles.right}>{model.status.toUpperCase()}</Text>
        </View>
      </View>

      <View style={styles.metaGrid}>
        <View style={styles.metaColumn}>
          <Text style={styles.sectionTitle}>CUSTOMER</Text>
          <Text>{model.customer.name}</Text>
          {model.customer.addressLine1 ? <Text>{model.customer.addressLine1}</Text> : null}
          {model.customer.addressLine2 ? <Text>{model.customer.addressLine2}</Text> : null}
          {customerLocality ? <Text>{customerLocality}</Text> : null}
          <Value label="Phone" value={model.customer.phone} /><Value label="Email" value={model.customer.email} />
        </View>
        <View style={styles.metaColumn}>
          <Text style={styles.sectionTitle}>VEHICLE</Text>
          {model.vehicle ? <>
            <Text>{[model.vehicle.year, model.vehicle.make, model.vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable"}</Text>
            <Value label="VIN" value={model.vehicle.vin} />
            <Value label="License" value={model.vehicle.licensePlate} /><Value label="Miles out" value={model.vehicle.odometer?.toLocaleString()} />
          </> : <Text>Vehicle not linked</Text>}
        </View>
        <View style={styles.metaColumn}>
          <Text style={styles.sectionTitle}>INVOICE DETAILS</Text>
          <Value label="RO" value={model.repairOrderReference} /><Value label="Legacy RO" value={model.legacyRepairOrderReference} />
          <Value label="Created" value={model.createdDate} /><Value label="Closed" value={model.closedDate} />
          <Value label="Delivered" value={model.deliveredDate} /><Value label="Authorized by" value={model.shop.authorizedRepresentative} />
          <Value label="Performed by" value={model.shop.technicianName} /><Value label="Technician license" value={model.shop.technicianLicenseNumber} />
        </View>
      </View>

      {(model.complaint || model.recommendation) ? <View style={styles.section}>
        <Text style={styles.sectionTitle}>CUSTOMER CONCERNS &amp; RECOMMENDATIONS</Text>
        {model.complaint ? <View style={styles.legalBlock}><Text style={styles.muted}>Customer concerns</Text><Text style={styles.note}>{model.complaint}</Text></View> : null}
        {model.recommendation ? <View><Text style={styles.muted}>Recommendations</Text><Text style={styles.note}>{model.recommendation}</Text></View> : null}
      </View> : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>PARTS</Text>
        <View fixed style={styles.tableHeader}><Text style={styles.description}>Item Description</Text><Text style={styles.quantity}>Qty</Text><Text style={styles.unit}>Unit Price</Text><Text style={styles.amount}>Extended</Text></View>
        {model.parts.length ? model.parts.map((part, index) => <View key={`${part.description}-${index}`} style={styles.tableRow} wrap={false}><Text style={styles.description}>{part.description}{part.partNumber ? `\nPart #${part.partNumber}` : ""}</Text><Text style={styles.quantity}>{part.quantity}</Text><Text style={styles.unit}>{part.unitPrice}</Text><Text style={styles.amount}>{part.extendedAmount}</Text></View>) : <Text>No parts recorded.</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LABOR / SERVICES</Text>
        <View fixed style={styles.tableHeader}><Text style={styles.laborDescription}>Service Description</Text><Text style={styles.laborAmount}>Labor Amount</Text><Text style={styles.technician}>Technician</Text></View>
        {model.labor.length ? model.labor.map((labor, index) => <View key={`${labor.description}-${index}`} style={styles.tableRow} wrap={false}><Text style={styles.laborDescription}>{labor.description}{`\n${labor.hours} hr × ${labor.hourlyRate}`}</Text><Text style={styles.laborAmount}>{labor.amount}</Text><Text style={styles.technician}>{labor.technician ?? ""}</Text></View>) : <Text>No labor recorded.</Text>}
      </View>

      {model.complimentaryServices.length ? <View style={styles.section}><Text style={styles.sectionTitle}>COMPLIMENTARY SERVICES</Text>{model.complimentaryServices.map((service, index) => <Text key={`${service.description}-${index}`}>• {service.description} — No charge</Text>)}</View> : null}

      <View style={styles.bottom}>
        <View style={styles.legal}>
          {model.shop.laborWarrantyText ? <View style={styles.legalBlock}><Text style={styles.sectionTitle}>LABOR WARRANTY</Text><Text>{model.shop.laborWarrantyText}</Text></View> : null}
          {model.shop.partsWarrantyText ? <View style={styles.legalBlock}><Text style={styles.sectionTitle}>PARTS WARRANTY</Text><Text>{model.shop.partsWarrantyText}</Text></View> : null}
          {model.shop.authorizationText ? <View style={styles.legalBlock}><Text style={styles.sectionTitle}>CUSTOMER AUTHORIZATION</Text><Text>{model.shop.authorizationText}</Text></View> : null}
          {model.shop.certificationText ? <View style={styles.legalBlock}><Text style={styles.sectionTitle}>CERTIFICATION</Text><Text>{model.shop.certificationText}</Text></View> : null}
          <Text style={styles.signature}>Customer signature / date</Text>
          <Text style={styles.signature}>Authorized representative / date{model.shop.authorizedRepresentative ? ` — ${model.shop.authorizedRepresentative}` : ""}</Text>
        </View>
        <View style={styles.totals} wrap={false}>
          <Text style={styles.sectionTitle}>TOTALS</Text>
          <View style={styles.totalRow}><Text>Parts</Text><Text>{model.totals.parts}</Text></View>
          <View style={styles.totalRow}><Text>Labor</Text><Text>{model.totals.labor}</Text></View>
          <View style={styles.totalRow}><Text>Shop supplies</Text><Text>{model.totals.shopSupplies}</Text></View>
          <View style={styles.totalRow}><Text>Subtotal before tax</Text><Text>{model.totals.displaySubtotalBeforeTax}</Text></View>
          {model.totals.discount !== "$0.00" && model.totals.discount !== "-$0.00" ? <View style={styles.totalRow}><Text>Discount</Text><Text>{model.totals.discount}</Text></View> : null}
          {model.legacyCharges.map((charge) => <View key={charge.label} style={styles.totalRow}><Text>{charge.label}</Text><Text>{charge.amount}</Text></View>)}
          <View style={styles.totalRow}><Text>Tax</Text><Text>{model.totals.tax}</Text></View>
          <View style={[styles.totalRow, styles.grandTotal]}><Text>Total</Text><Text>{model.totals.total}</Text></View>
          <View style={styles.totalRow}><Text>Amount paid</Text><Text>{model.totals.amountPaid}</Text></View>
          <View style={styles.totalRow}><Text>Balance due</Text><Text>{model.totals.balanceDue}</Text></View>
          <View style={styles.totalRow}><Text>Payment status</Text><Text>{model.totals.paymentStatus}</Text></View>
          {model.paymentMethods.length ? <Text style={{ marginTop: 5 }}>Payments: {model.paymentMethods.map((payment) => `${payment.method} ${payment.amount}`).join("; ")}</Text> : null}
        </View>
      </View>
      {model.shop.footerMessage ? <Text style={styles.footer}>{model.shop.footerMessage}</Text> : null}
    </Page>
  </Document>;
}

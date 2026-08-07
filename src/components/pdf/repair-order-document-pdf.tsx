import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { RepairOrderDocumentModel } from "@/lib/repair-order-document";

const styles = StyleSheet.create({
  page: { paddingTop: 40, paddingRight: 32, paddingBottom: 32, paddingLeft: 32, fontFamily: "Helvetica", fontSize: 8.5, lineHeight: 1.28, color: "#000000" },
  repeatHeader: { position: "absolute", top: 16, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", borderBottom: "0.5pt solid #777777", paddingBottom: 4, fontSize: 7.5 },
  header: { flexDirection: "row", justifyContent: "space-between", gap: 16, paddingBottom: 8, borderBottom: "1pt solid #000000" },
  shopName: { fontSize: 14, marginBottom: 2 },
  title: { fontSize: 15, textAlign: "right" },
  right: { textAlign: "right" },
  muted: { color: "#444444" },
  estimateNotice: { marginTop: 7, padding: 5, border: "0.5pt solid #777777", textAlign: "center", fontSize: 8, fontWeight: 700 },
  metaGrid: { flexDirection: "row", gap: 16, paddingVertical: 7, borderBottom: "0.5pt solid #777777" },
  metaColumn: { flexGrow: 1, flexBasis: 0 },
  section: { marginTop: 8 },
  sectionTitle: { fontSize: 9, marginBottom: 3, paddingBottom: 2, borderBottom: "0.5pt solid #777777" },
  noteBlock: { marginBottom: 5 },
  tableHeader: { flexDirection: "row", borderBottom: "0.75pt solid #000000", paddingVertical: 3, fontSize: 7.5 },
  tableRow: { flexDirection: "row", borderBottom: "0.35pt solid #aaaaaa", paddingVertical: 3 },
  description: { width: "55%", paddingRight: 5 },
  quantity: { width: "10%", textAlign: "right" },
  unit: { width: "16%", textAlign: "right" },
  amount: { width: "19%", textAlign: "right" },
  bottom: { marginTop: 10, flexDirection: "row", gap: 18, alignItems: "flex-start" },
  legal: { flexGrow: 1, flexBasis: 0 },
  totals: { width: 190 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  grandTotal: { borderTop: "1pt solid #000000", marginTop: 2, paddingTop: 4, fontSize: 10 },
  footer: { marginTop: 10, paddingTop: 5, borderTop: "0.5pt solid #777777", textAlign: "center", fontSize: 7.5 },
});

function locality(city: string | null, state: string | null, postalCode: string | null) {
  return [[city, state].filter(Boolean).join(", "), postalCode].filter(Boolean).join(" ");
}

function Value({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return <Text><Text style={styles.muted}>{label}: </Text>{String(value)}</Text>;
}

export function RepairOrderDocumentPDF({ model }: { model: RepairOrderDocumentModel }) {
  const shopLocality = locality(model.shop.city, model.shop.state, model.shop.postalCode);
  const customerLocality = locality(model.customer.city, model.customer.state, model.customer.postalCode);
  const vehicleName = [model.vehicle.year, model.vehicle.make, model.vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable";

  return <Document title={`Repair Order ${model.repairOrderNumber}`} author={model.shop.name}>
    <Page size="LETTER" style={styles.page} wrap>
      <View fixed style={styles.repeatHeader}><Text>{model.shop.name}</Text><Text>Repair Order {model.repairOrderNumber}</Text></View>
      <View style={styles.header}>
        <View>
          <Text style={styles.shopName}>{model.shop.name}</Text>
          {model.shop.addressLine1 ? <Text>{model.shop.addressLine1}</Text> : null}
          {shopLocality ? <Text>{shopLocality}</Text> : null}
          {model.shop.phone ? <Text>{model.shop.phone}</Text> : null}
        </View>
        <View>
          <Text style={styles.title}>REPAIR ORDER / ESTIMATE</Text>
          <Text style={styles.right}>No. {model.repairOrderNumber}</Text>
          <Text style={styles.right}>Opened {model.openedDate}</Text>
          {model.closedDate ? <Text style={styles.right}>Closed {model.closedDate}</Text> : null}
          <Text style={styles.right}>{model.status.toUpperCase()}</Text>
        </View>
      </View>
      <Text style={styles.estimateNotice}>ESTIMATE ONLY — NOT A FINALIZED INVOICE</Text>

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
          <Text>{vehicleName}</Text>
          <Value label="VIN" value={model.vehicle.vin} />
          <Value label="License" value={model.vehicle.licensePlate} /><Value label="Mileage" value={model.vehicle.odometer?.toLocaleString()} />
        </View>
      </View>

      {(model.complaint || model.recommendation) ? <View style={styles.section} wrap={false}>
        <Text style={styles.sectionTitle}>CUSTOMER CONCERNS &amp; RECOMMENDATIONS</Text>
        {model.complaint ? <View style={styles.noteBlock}><Text style={styles.muted}>Customer complaint</Text><Text>{model.complaint}</Text></View> : null}
        {model.recommendation ? <View><Text style={styles.muted}>Service recommendation</Text><Text>{model.recommendation}</Text></View> : null}
      </View> : null}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>PARTS</Text>
        <View fixed style={styles.tableHeader}><Text style={styles.description}>Description</Text><Text style={styles.quantity}>Qty</Text><Text style={styles.unit}>Unit price</Text><Text style={styles.amount}>Amount</Text></View>
        {model.parts.length ? model.parts.map((part, index) => <View key={`${part.description}-${index}`} style={styles.tableRow} wrap={false}><Text style={styles.description}>{part.description}{part.partNumber ? `\nPart #${part.partNumber}` : ""}</Text><Text style={styles.quantity}>{part.quantity}</Text><Text style={styles.unit}>{part.unitPrice}</Text><Text style={styles.amount}>{part.amount}</Text></View>) : <Text>No parts recorded.</Text>}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LABOR / SERVICES</Text>
        <View fixed style={styles.tableHeader}><Text style={styles.description}>Description</Text><Text style={styles.quantity}>Hours</Text><Text style={styles.unit}>Rate</Text><Text style={styles.amount}>Amount</Text></View>
        {model.labor.length ? model.labor.map((labor, index) => <View key={`${labor.description}-${index}`} style={styles.tableRow} wrap={false}><Text style={styles.description}>{labor.description}</Text><Text style={styles.quantity}>{labor.hours}</Text><Text style={styles.unit}>{labor.hourlyRate}</Text><Text style={styles.amount}>{labor.amount}</Text></View>) : <Text>No labor recorded.</Text>}
      </View>

      {model.complimentaryServices.length ? <View style={styles.section}><Text style={styles.sectionTitle}>COMPLIMENTARY SERVICES</Text>{model.complimentaryServices.map((service, index) => <Text key={`${service.description}-${index}`}>• {service.description} — No charge</Text>)}</View> : null}

      <View style={styles.bottom} wrap={false}>
        <View style={styles.legal}>{model.shop.warrantyText ? <><Text style={styles.sectionTitle}>WARRANTY</Text><Text>{model.shop.warrantyText}</Text></> : null}</View>
        <View style={styles.totals}>
          <Text style={styles.sectionTitle}>ESTIMATE SUMMARY</Text>
          <View style={styles.totalRow}><Text>Parts</Text><Text>{model.totals.parts}</Text></View>
          <View style={styles.totalRow}><Text>Labor</Text><Text>{model.totals.labor}</Text></View>
          <View style={styles.totalRow}><Text>Subtotal</Text><Text>{model.totals.subtotal}</Text></View>
          {model.totals.shopSupplies ? <View style={styles.totalRow}><Text>Shop supplies</Text><Text>{model.totals.shopSupplies}</Text></View> : null}
          <View style={styles.totalRow}><Text>Estimated tax</Text><Text>{model.totals.tax}</Text></View>
          <View style={[styles.totalRow, styles.grandTotal]}><Text>Estimated total</Text><Text>{model.totals.estimatedTotal}</Text></View>
        </View>
      </View>
      <Text style={styles.footer}>{model.shop.invoiceFooterMessage ?? `Thank you for choosing ${model.shop.name}.`}\nThis repair order is an estimate and is not a finalized invoice.</Text>
    </Page>
  </Document>;
}

import type { RepairOrderDocumentModel } from "@/lib/repair-order-document";

function locality(city: string | null, state: string | null, postalCode: string | null) {
  return [[city, state].filter(Boolean).join(", "), postalCode].filter(Boolean).join(" ");
}

function Detail({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function SummaryRow({ label, value, emphasized = false }: { label: string; value: string | null | undefined; emphasized?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  const className = emphasized ? "invoice-document-total-emphasis" : undefined;
  return <><dt className={className}>{label}</dt><dd className={className}>{value}</dd></>;
}

export function RepairOrderDocumentHTML({ model }: { model: RepairOrderDocumentModel }) {
  const shopLocality = locality(model.shop.city, model.shop.state, model.shop.postalCode);
  const customerLocality = locality(model.customer.city, model.customer.state, model.customer.postalCode);
  const vehicleName = [model.vehicle.year, model.vehicle.make, model.vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable";

  return <article className="invoice-document repair-order-document">
    <div className="invoice-document-repeat"><span>{model.shop.name}</span><span>Repair Order Estimate {model.repairOrderNumber}</span></div>
    <header className="invoice-document-header">
      <address style={{ minWidth: 0, overflowWrap: "anywhere" }}><h1>{model.shop.name}</h1>{model.shop.addressLine1 && <span>{model.shop.addressLine1}</span>}{shopLocality && <span>{shopLocality}</span>}{model.shop.phone && <span>{model.shop.phone}</span>}</address>
      <div className="invoice-document-title" style={{ flexShrink: 0 }}><p>REPAIR ORDER ESTIMATE</p><span>No. {model.repairOrderNumber}</span><span>Opened {model.openedDate}</span>{model.closedDate && <span>Closed {model.closedDate}</span>}<span>{model.status.toUpperCase()}</span></div>
    </header>

    {model.status === "void" ? <section className="mb-4 rounded-lg border-4 border-red-800 bg-red-50 p-3 text-center text-red-900"><h2 className="text-xl font-black tracking-wide">VOID — RETAINED FOR AUDIT HISTORY</h2><p className="mt-1 text-sm font-semibold">Reason: {model.voidReasonLabel ?? "Unspecified"}{model.voidedDate ? ` · Voided ${model.voidedDate}` : ""}</p>{model.voidNote ? <p className="mt-1 whitespace-pre-wrap text-sm">{model.voidNote}</p> : null}</section> : null}
    <p className="repair-order-estimate-notice">ESTIMATE ONLY — NOT A FINALIZED INVOICE</p>

    <section className="invoice-document-meta repair-order-document-meta" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
      <div style={{ minWidth: 0, overflowWrap: "anywhere" }}><h2>Customer</h2><p>{model.customer.name}</p>{model.customer.addressLine1 && <p>{model.customer.addressLine1}</p>}{model.customer.addressLine2 && <p>{model.customer.addressLine2}</p>}{customerLocality && <p>{customerLocality}</p>}<dl><Detail label="Phone" value={model.customer.phone} /><Detail label="Email" value={model.customer.email} /></dl></div>
      <div style={{ minWidth: 0, overflowWrap: "anywhere" }}><h2>Vehicle</h2><p>{vehicleName}</p><dl><Detail label="VIN" value={model.vehicle.vin} /><Detail label="License" value={model.vehicle.licensePlate} /><Detail label="Mileage" value={model.odometer?.toLocaleString() ?? "—"} /></dl></div>
    </section>

    {(model.complaint || model.recommendation) && <section className="invoice-document-section invoice-document-notes" style={{ overflowWrap: "anywhere" }}><h2>Customer Concerns &amp; Recommendations</h2>{model.complaint && <div><h3>Customer complaint</h3><p>{model.complaint}</p></div>}{model.recommendation && <div><h3>Service recommendation</h3><p>{model.recommendation}</p></div>}</section>}

    <DocumentTable title="Parts" headings={["Description", "Qty", "Unit Price", "Amount"]} empty="No parts recorded.">
      {model.parts.map((part, index) => <tr key={`${part.description}-${index}`}><td style={{ overflowWrap: "anywhere" }}>{part.description}{part.partNumber && <small>Part #{part.partNumber}</small>}</td><td style={{ whiteSpace: "nowrap" }}>{part.quantity}</td><td style={{ whiteSpace: "nowrap" }}>{part.unitPrice}</td><td style={{ whiteSpace: "nowrap" }}>{part.amount}</td></tr>)}
    </DocumentTable>
    <DocumentTable title="Labor / Services" headings={["Description", "Hours", "Rate", "Amount"]} empty="No labor recorded.">
      {model.labor.map((labor, index) => <tr key={`${labor.description}-${index}`}><td style={{ overflowWrap: "anywhere" }}>{labor.description}</td><td style={{ whiteSpace: "nowrap" }}>{labor.hours}</td><td style={{ whiteSpace: "nowrap" }}>{labor.hourlyRate}</td><td style={{ whiteSpace: "nowrap" }}>{labor.amount}</td></tr>)}
    </DocumentTable>
    {model.complimentaryServices.length > 0 && <section className="invoice-document-section repair-order-complimentary"><h2>Complimentary Services</h2><ul>{model.complimentaryServices.map((service, index) => <li key={`${service.description}-${index}`}><span style={{ overflowWrap: "anywhere" }}>{service.description}</span><span style={{ whiteSpace: "nowrap" }}>No charge</span></li>)}</ul></section>}

    <section className="invoice-document-bottom repair-order-document-bottom" style={{ gridTemplateColumns: "minmax(0, 1fr) minmax(2.15in, 2.35in)" }}>
      <div className="invoice-document-legal">{model.shop.warrantyText && <section><h2>Warranty</h2><p style={{ overflowWrap: "anywhere" }}>{model.shop.warrantyText}</p></section>}</div>
      <div className="invoice-document-totals"><h2>Estimate Summary</h2><dl><SummaryRow label="Parts" value={model.totals.parts} /><SummaryRow label="Labor" value={model.totals.labor} /><SummaryRow label="Subtotal" value={model.totals.subtotal} /><SummaryRow label="Shop supplies" value={model.totals.shopSupplies} /><SummaryRow label="Estimated tax" value={model.totals.tax} /><SummaryRow label="Estimated total" value={model.totals.estimatedTotal} emphasized /></dl></div>
    </section>
    <footer><p>{model.shop.invoiceFooterMessage ?? `Thank you for choosing ${model.shop.name}.`}</p><p>This repair order is an estimate and is not a finalized invoice.</p></footer>
  </article>;
}

function DocumentTable({ title, headings, empty, children }: { title: string; headings: string[]; empty: string; children: React.ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <section className="invoice-document-section"><h2>{title}</h2>{hasRows ? <table><colgroup><col /><col style={{ width: "0.72in" }} /><col style={{ width: "0.9in" }} /><col style={{ width: "0.92in" }} /></colgroup><thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{children}</tbody></table> : <p>{empty}</p>}</section>;
}

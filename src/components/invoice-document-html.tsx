import type { InvoiceDocumentModel } from "@/lib/invoice-document";

function locality(city: string | null, state: string | null, postalCode: string | null) {
  return [[city, state].filter(Boolean).join(", "), postalCode].filter(Boolean).join(" ");
}

function Detail({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

export function InvoiceDocumentHTML({ model }: { model: InvoiceDocumentModel }) {
  const shopLocality = locality(model.shop.city, model.shop.state, model.shop.postalCode);
  const customerLocality = locality(model.customer.city, model.customer.state, model.customer.postalCode);
  return <article className="invoice-document">
    <div className="invoice-document-repeat"><span>{model.shop.name}</span><span>Invoice {model.invoiceNumber}</span></div>
    <header className="invoice-document-header">
      <address><h1>{model.shop.name}</h1>{model.shop.addressLine1 && <span>{model.shop.addressLine1}</span>}{shopLocality && <span>{shopLocality}</span>}{model.shop.phone && <span>{model.shop.phone}</span>}{model.shop.repairFacilityRegistrationNumber && <span>Repair Facility Registration: {model.shop.repairFacilityRegistrationNumber}</span>}</address>
      <div className="invoice-document-title"><p>INVOICE</p><span>No. {model.invoiceNumber}</span><span>{model.invoiceDate}</span><span>{model.status.toUpperCase()}</span></div>
    </header>

    <section className="invoice-document-meta">
      <div><h2>Customer</h2><p>{model.customer.name}</p>{model.customer.addressLine1 && <p>{model.customer.addressLine1}</p>}{model.customer.addressLine2 && <p>{model.customer.addressLine2}</p>}{customerLocality && <p>{customerLocality}</p>}<dl><Detail label="Phone" value={model.customer.phone} /><Detail label="Email" value={model.customer.email} /></dl></div>
      <div><h2>Vehicle</h2>{model.vehicle ? <><p>{[model.vehicle.year, model.vehicle.make, model.vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable"}</p><dl><Detail label="VIN" value={model.vehicle.vin} /><Detail label="License" value={model.vehicle.licensePlate} /><Detail label="Miles out" value={model.vehicle.odometer?.toLocaleString()} /></dl></> : <p>Vehicle not linked</p>}</div>
      <div><h2>Invoice details</h2><dl><Detail label="RO" value={model.repairOrderReference} /><Detail label="Legacy RO" value={model.legacyRepairOrderReference} /><Detail label="Created" value={model.createdDate} /><Detail label="Closed" value={model.closedDate} /><Detail label="Delivered" value={model.deliveredDate} /><Detail label="Authorized by" value={model.shop.authorizedRepresentative} /><Detail label="Performed by" value={model.shop.technicianName} /><Detail label="Technician license" value={model.shop.technicianLicenseNumber} /></dl></div>
    </section>

    {(model.complaint || model.recommendation) && <section className="invoice-document-section invoice-document-notes"><h2>Customer Concerns &amp; Recommendations</h2>{model.complaint && <div><h3>Customer concerns</h3><p>{model.complaint}</p></div>}{model.recommendation && <div><h3>Recommendations</h3><p>{model.recommendation}</p></div>}</section>}

    <DocumentTable title="Parts" headings={["Item Description", "Qty", "Unit Price", "Extended Amount"]} empty="No parts recorded.">
      {model.parts.map((part, index) => <tr key={`${part.description}-${index}`}><td>{part.description}{part.partNumber && <small>Part #{part.partNumber}</small>}</td><td>{part.quantity}</td><td>{part.unitPrice}</td><td>{part.extendedAmount}</td></tr>)}
    </DocumentTable>
    <DocumentTable title="Labor / Services" headings={["Service Description", "Labor Amount", "Technician"]} empty="No labor recorded.">
      {model.labor.map((labor, index) => <tr key={`${labor.description}-${index}`}><td>{labor.description}<small>{labor.hours} hr × {labor.hourlyRate}</small></td><td>{labor.amount}</td><td>{labor.technician}</td></tr>)}
    </DocumentTable>
    {model.complimentaryServices.length > 0 && <section className="invoice-document-section"><h2>Complimentary Services</h2><ul>{model.complimentaryServices.map((service, index) => <li key={`${service.description}-${index}`}>{service.description} — No charge</li>)}</ul></section>}

    <section className="invoice-document-bottom">
      <div className="invoice-document-legal">
        {model.shop.laborWarrantyText && <Legal title="Labor Warranty" text={model.shop.laborWarrantyText} />}
        {model.shop.partsWarrantyText && <Legal title="Parts Warranty" text={model.shop.partsWarrantyText} />}
        {model.shop.authorizationText && <Legal title="Customer Authorization" text={model.shop.authorizationText} />}
        {model.shop.certificationText && <Legal title="Certification" text={model.shop.certificationText} />}
        <p className="invoice-document-signature">Customer signature / date</p>
        <p className="invoice-document-signature">Authorized representative / date{model.shop.authorizedRepresentative ? ` — ${model.shop.authorizedRepresentative}` : ""}</p>
      </div>
      <div className="invoice-document-totals"><h2>Totals</h2><dl><Detail label="Parts" value={model.totals.parts} /><Detail label="Labor" value={model.totals.labor} /><Detail label="Shop supplies" value={model.totals.shopSupplies} /><Detail label="Subtotal before tax" value={model.totals.displaySubtotalBeforeTax} />{model.totals.discount !== "$0.00" && model.totals.discount !== "-$0.00" ? <Detail label="Discount" value={model.totals.discount} /> : null}{model.legacyCharges.map((charge) => <Detail key={charge.label} label={charge.label} value={charge.amount} />)}<Detail label="Tax" value={model.totals.tax} /><div className="invoice-document-grand-total"><dt>Total</dt><dd>{model.totals.total}</dd></div><Detail label="Amount paid" value={model.totals.amountPaid} /><Detail label="Balance due" value={model.totals.balanceDue} /></dl>{model.paymentMethods.length > 0 && <p>Payments: {model.paymentMethods.map((payment) => `${payment.method} ${payment.amount}`).join("; ")}</p>}</div>
    </section>
    {model.shop.footerMessage && <footer>{model.shop.footerMessage}</footer>}
  </article>;
}

function Legal({ title, text }: { title: string; text: string }) { return <section><h2>{title}</h2><p>{text}</p></section>; }

function DocumentTable({ title, headings, empty, children }: { title: string; headings: string[]; empty: string; children: React.ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <section className="invoice-document-section"><h2>{title}</h2>{hasRows ? <table><thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{children}</tbody></table> : <p>{empty}</p>}</section>;
}

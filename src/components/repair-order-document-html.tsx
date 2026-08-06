import type { RepairOrderDocumentModel } from "@/lib/repair-order-document";

function locality(city: string | null, state: string | null, postalCode: string | null) {
  return [[city, state].filter(Boolean).join(", "), postalCode].filter(Boolean).join(" ");
}

function Detail({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

export function RepairOrderDocumentHTML({ model }: { model: RepairOrderDocumentModel }) {
  const shopLocality = locality(model.shop.city, model.shop.state, model.shop.postalCode);
  const customerLocality = locality(model.customer.city, model.customer.state, model.customer.postalCode);
  const vehicleName = [model.vehicle.year, model.vehicle.make, model.vehicle.model].filter(Boolean).join(" ") || "Vehicle details unavailable";

  return <article className="invoice-document repair-order-document">
    <div className="invoice-document-repeat"><span>{model.shop.name}</span><span>Repair Order Estimate {model.repairOrderNumber}</span></div>
    <header className="invoice-document-header">
      <address><h1>{model.shop.name}</h1>{model.shop.addressLine1 && <span>{model.shop.addressLine1}</span>}{shopLocality && <span>{shopLocality}</span>}{model.shop.phone && <span>{model.shop.phone}</span>}</address>
      <div className="invoice-document-title"><p>REPAIR ORDER ESTIMATE</p><span>No. {model.repairOrderNumber}</span><span>Opened {model.openedDate}</span>{model.closedDate && <span>Closed {model.closedDate}</span>}<span>{model.status.toUpperCase()}</span></div>
    </header>

    <p className="repair-order-estimate-notice">ESTIMATE ONLY — NOT A FINALIZED INVOICE</p>

    <section className="invoice-document-meta repair-order-document-meta">
      <div><h2>Customer</h2><p>{model.customer.name}</p>{model.customer.addressLine1 && <p>{model.customer.addressLine1}</p>}{model.customer.addressLine2 && <p>{model.customer.addressLine2}</p>}{customerLocality && <p>{customerLocality}</p>}<dl><Detail label="Phone" value={model.customer.phone} /><Detail label="Email" value={model.customer.email} /></dl></div>
      <div><h2>Vehicle</h2><p>{vehicleName}</p><dl><Detail label="Engine" value={model.vehicle.engine} /><Detail label="VIN" value={model.vehicle.vin} /><Detail label="License" value={model.vehicle.licensePlate} /><Detail label="Mileage" value={model.vehicle.odometer?.toLocaleString()} /></dl></div>
    </section>

    {(model.complaint || model.recommendation) && <section className="invoice-document-section invoice-document-notes"><h2>Customer Concerns &amp; Recommendations</h2>{model.complaint && <div><h3>Customer complaint</h3><p>{model.complaint}</p></div>}{model.recommendation && <div><h3>Service recommendation</h3><p>{model.recommendation}</p></div>}</section>}

    <DocumentTable title="Parts" headings={["Description", "Qty", "Unit Price", "Amount"]} empty="No parts recorded.">
      {model.parts.map((part, index) => <tr key={`${part.description}-${index}`}><td>{part.description}{part.partNumber && <small>Part #{part.partNumber}</small>}</td><td>{part.quantity}</td><td>{part.unitPrice}</td><td>{part.amount}</td></tr>)}
    </DocumentTable>
    <DocumentTable title="Labor / Services" headings={["Description", "Hours", "Rate", "Amount"]} empty="No labor recorded.">
      {model.labor.map((labor, index) => <tr key={`${labor.description}-${index}`}><td>{labor.description}</td><td>{labor.hours}</td><td>{labor.hourlyRate}</td><td>{labor.amount}</td></tr>)}
    </DocumentTable>
    {model.complimentaryServices.length > 0 && <section className="invoice-document-section repair-order-complimentary"><h2>Complimentary Services</h2><ul>{model.complimentaryServices.map((service, index) => <li key={`${service.description}-${index}`}><span>{service.description}</span><span>No charge</span></li>)}</ul></section>}

    <section className="invoice-document-bottom repair-order-document-bottom">
      <div className="invoice-document-legal">{model.shop.warrantyText && <section><h2>Warranty</h2><p>{model.shop.warrantyText}</p></section>}</div>
      <div className="invoice-document-totals"><h2>Estimate Summary</h2><dl><Detail label="Parts" value={model.totals.parts} /><Detail label="Labor" value={model.totals.labor} /><Detail label="Subtotal" value={model.totals.subtotal} /><Detail label="Shop supplies" value={model.totals.shopSupplies} /><Detail label="Estimated tax" value={model.totals.tax} /><div className="invoice-document-grand-total"><dt>Estimated total</dt><dd>{model.totals.estimatedTotal}</dd></div></dl></div>
    </section>
    <footer><p>{model.shop.invoiceFooterMessage ?? `Thank you for choosing ${model.shop.name}.`}</p><p>This repair order is an estimate and is not a finalized invoice.</p></footer>
  </article>;
}

function DocumentTable({ title, headings, empty, children }: { title: string; headings: string[]; empty: string; children: React.ReactNode }) {
  const hasRows = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return <section className="invoice-document-section"><h2>{title}</h2>{hasRows ? <table><thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{children}</tbody></table> : <p>{empty}</p>}</section>;
}

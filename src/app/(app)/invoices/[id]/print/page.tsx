import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { getInvoiceForCurrentShop } from "@/lib/data/invoices";
import { formatDate, formatMoney } from "@/lib/formatters";

type PrintableInvoice = NonNullable<
  Awaited<ReturnType<typeof getInvoiceForCurrentShop>>
>;
type PrintablePayment = PrintableInvoice["payments"][number];
type PrintablePart = PrintableInvoice["parts"][number];
type PrintableLabor = PrintableInvoice["labor"][number];

export const dynamic = "force-dynamic";

export default async function PrintableInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const invoice = await getInvoiceForCurrentShop(id);

  if (!invoice) notFound();

  const vehicle = invoice.vehicle
    ? [invoice.vehicle.year, invoice.vehicle.make, invoice.vehicle.model]
        .filter(Boolean)
        .join(" ") || "Vehicle details unavailable"
    : "Vehicle not linked";
  const paymentTotal = invoice.payments.reduce(
    (total: number, payment: PrintablePayment) =>
      total + Number(payment.amount.toString()),
    0,
  );
  const receivable = invoice.accountsReceivable[0];
  const locality = [invoice.shop.city, invoice.shop.state, invoice.shop.postalCode]
    .filter(Boolean)
    .join(", ");

  return (
    <article className="print-page mx-auto max-w-4xl bg-white p-6 text-slate-950 shadow-sm print:p-0 print:shadow-none sm:p-10">
      <div className="print-hidden mb-8 flex items-center justify-between gap-4">
        <Link href={`/invoices/${invoice.id}`} className="text-sm font-semibold text-sky-700 hover:text-sky-800">
          ← Invoice
        </Link>
        <PrintButton />
      </div>

      <header className="flex flex-col gap-6 border-b-2 border-slate-900 pb-6 sm:flex-row sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{invoice.shop.name}</h1>
          <address className="mt-3 text-sm not-italic leading-6 text-slate-700">
            <span className="block">{invoice.shop.addressLine1 ?? "Address unavailable"}</span>
            <span className="block">{locality || "City and state unavailable"}</span>
            <span className="block">{invoice.shop.phone ?? "Phone unavailable"}</span>
          </address>
        </div>
        <div className="sm:text-right">
          <p className="text-sm font-semibold uppercase tracking-wider text-slate-500">Invoice</p>
          <p className="mt-2 text-2xl font-bold">RO #{invoice.legacyRoNo ?? "Not recorded"}</p>
          <p className="mt-1 text-sm text-slate-600">{formatDate(invoice.invoiceDate)}</p>
        </div>
      </header>

      <section className="grid gap-6 border-b border-slate-300 py-6 sm:grid-cols-2">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Customer</h2>
          <p className="mt-2 font-semibold">{invoice.customer?.displayName ?? "Customer unavailable"}</p>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-sm">
          <span className="text-slate-500">Vehicle</span><span>{vehicle}</span>
          <span className="text-slate-500">Mileage</span>
          <span>{invoice.vehicle?.odometer?.toLocaleString() ?? "Not recorded"}</span>
        </div>
      </section>

      <PrintLines title="Parts" empty="No parts recorded">
        {invoice.parts.map((part: PrintablePart) => (
          <tr key={part.id} className="border-b border-slate-200 align-top">
            <td className="py-3 pr-4">{part.description}</td>
            <td className="py-3 pr-4 text-right">{part.quantity.toString()}</td>
            <td className="py-3 text-right">{formatMoney(part.unitPrice)}</td>
          </tr>
        ))}
      </PrintLines>

      <PrintLines title="Labor" empty="No labor recorded">
        {invoice.labor.map((labor: PrintableLabor) => (
          <tr key={labor.id} className="border-b border-slate-200 align-top">
            <td className="py-3 pr-4">{labor.description}</td>
            <td className="py-3 pr-4 text-right">{labor.hours.toString()}</td>
            <td className="py-3 text-right">{formatMoney(labor.hourlyRate)}/hr</td>
          </tr>
        ))}
      </PrintLines>

      <section className="ml-auto mt-8 max-w-sm">
        <dl className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-3 text-sm">
          <dt className="text-slate-600">Subtotal</dt><dd>{formatMoney(invoice.subtotal)}</dd>
          <dt className="text-slate-600">Tax</dt><dd>{formatMoney(invoice.taxTotal)}</dd>
          <dt className="border-t border-slate-300 pt-3 font-bold">Total</dt>
          <dd className="border-t border-slate-300 pt-3 font-bold">{formatMoney(invoice.total)}</dd>
          <dt className="text-slate-600">Payments</dt><dd>{formatMoney(paymentTotal)}</dd>
          <dt className="text-base font-bold">Balance</dt>
          <dd className="text-base font-bold">{receivable ? formatMoney(receivable.balance) : "Unavailable"}</dd>
        </dl>
      </section>
    </article>
  );
}

function PrintLines({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <section className="mt-7 break-inside-avoid">
      <h2 className="text-lg font-bold">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">{empty}</p>
      ) : (
        <table className="mt-3 w-full border-collapse text-sm">
          <thead><tr className="border-y border-slate-300 text-left text-xs uppercase tracking-wider text-slate-500"><th className="py-2">Description</th><th className="py-2 text-right">Qty/Hours</th><th className="py-2 text-right">Rate</th></tr></thead>
          <tbody>{children}</tbody>
        </table>
      )}
    </section>
  );
}

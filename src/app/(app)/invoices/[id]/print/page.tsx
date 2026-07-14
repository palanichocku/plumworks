import Link from "next/link";
import { notFound } from "next/navigation";
import { PrintButton } from "@/components/print-button";
import { getInvoiceForCurrentShop } from "@/lib/data/invoices";
import {
  formatDate,
  formatLaborDescription,
  formatMoney,
} from "@/lib/formatters";

type PrintableInvoice = NonNullable<
  Awaited<ReturnType<typeof getInvoiceForCurrentShop>>
>;
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
  const receivable = invoice.accountsReceivable[0];
  const locality = [invoice.shop.city, invoice.shop.state, invoice.shop.postalCode]
    .filter(Boolean)
    .join(", ");

  return (
    <article className="print-page mx-auto max-w-5xl overflow-hidden rounded-2xl bg-white text-slate-950 shadow-xl print:rounded-none print:shadow-none">
      <div className="print-hidden flex items-center justify-between gap-4 border-b border-slate-200 px-6 py-4 sm:px-10">
        <Link
          href={`/invoices/${invoice.id}`}
          className="text-sm font-semibold text-sky-700 hover:text-sky-800"
        >
          ← Back to invoice
        </Link>
        <PrintButton />
      </div>

      <div className="h-2 bg-sky-700" />
      <div className="p-6 sm:p-10 print:p-0">
        <header className="flex flex-col gap-8 border-b-2 border-slate-900 pb-7 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-sky-700">
              Auto repair invoice
            </p>
            <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-4xl">
              {invoice.shop.name}
            </h1>
            <address className="mt-4 text-sm not-italic leading-6 text-slate-600">
              <span className="block">
                {invoice.shop.addressLine1 ?? "Address unavailable"}
              </span>
              <span className="block">{locality || "City and state unavailable"}</span>
              <span className="block">{invoice.shop.phone ?? "Phone unavailable"}</span>
            </address>
          </div>

          <div className="min-w-60 rounded-xl bg-slate-950 p-5 text-white print:border print:border-slate-300 print:bg-white print:text-slate-950 sm:text-right">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-300 print:text-slate-500">
              Repair order
            </p>
            <p className="mt-2 text-2xl font-black">
              #{invoice.legacyRoNo ?? "Not recorded"}
            </p>
            <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm sm:grid-cols-[1fr_auto]">
              <dt className="text-slate-400 print:text-slate-500">Invoice date</dt>
              <dd className="font-semibold">{formatDate(invoice.invoiceDate)}</dd>
              <dt className="text-slate-400 print:text-slate-500">Status</dt>
              <dd className="font-semibold capitalize">{invoice.status}</dd>
            </dl>
          </div>
        </header>

        <section className="grid gap-4 py-7 sm:grid-cols-2">
          <InfoCard title="Customer">
            <p className="font-bold text-slate-950">
              {invoice.customer?.displayName ?? "Customer unavailable"}
            </p>
          </InfoCard>
          <InfoCard title="Vehicle">
            <p className="font-bold text-slate-950">{vehicle}</p>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 text-sm">
              <dt className="text-slate-500">Mileage</dt>
              <dd>{invoice.vehicle?.odometer?.toLocaleString() ?? "Not recorded"}</dd>
            </dl>
          </InfoCard>
        </section>

        <InvoiceTable
          title="Parts"
          empty="No parts recorded"
          headings={["Description", "Qty", "Unit price", "Amount"]}
        >
          {invoice.parts.map((part: PrintablePart) => {
            const extension =
              Number(part.quantity.toString()) * Number(part.unitPrice.toString());
            return (
              <tr key={part.id}>
                <td>
                  <span className="font-semibold text-slate-900">{part.description}</span>
                  {part.partNumber && (
                    <span className="mt-1 block text-xs text-slate-500">
                      Part #{part.partNumber}
                    </span>
                  )}
                </td>
                <td className="text-right">{part.quantity.toString()}</td>
                <td className="text-right">{formatMoney(part.unitPrice)}</td>
                <td className="text-right font-semibold">{formatMoney(extension)}</td>
              </tr>
            );
          })}
        </InvoiceTable>

        <InvoiceTable
          title="Labor"
          empty="No labor recorded"
          headings={["Description", "Hours", "Rate", "Amount"]}
        >
          {invoice.labor.map((labor: PrintableLabor) => {
            const extension =
              Number(labor.hours.toString()) * Number(labor.hourlyRate.toString());
            return (
              <tr key={labor.id}>
                <td className="font-semibold text-slate-900">
                  {formatLaborDescription(labor.description)}
                </td>
                <td className="text-right">{labor.hours.toString()}</td>
                <td className="text-right">{formatMoney(labor.hourlyRate)}</td>
                <td className="text-right font-semibold">{formatMoney(extension)}</td>
              </tr>
            );
          })}
        </InvoiceTable>

        <section className="mt-8 flex justify-end break-inside-avoid">
          <div className="w-full max-w-md rounded-xl border border-slate-300 bg-slate-50 p-5 print:bg-white">
            <h2 className="text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
              Invoice summary
            </h2>
            <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-8 gap-y-2.5 text-sm">
              <dt className="text-slate-600">Parts total</dt>
              <dd>{formatMoney(invoice.partsTotal)}</dd>
              <dt className="text-slate-600">Labor total</dt>
              <dd>{formatMoney(invoice.laborTotal)}</dd>
              <dt className="border-t border-slate-300 pt-3 text-slate-600">Subtotal</dt>
              <dd className="border-t border-slate-300 pt-3">{formatMoney(invoice.subtotal)}</dd>
              <dt className="text-slate-600">Tax</dt>
              <dd>{formatMoney(invoice.taxTotal)}</dd>
              <dt className="border-t-2 border-slate-900 pt-3 text-base font-black">Total</dt>
              <dd className="border-t-2 border-slate-900 pt-3 text-base font-black">
                {formatMoney(invoice.total)}
              </dd>
              <dt className="text-slate-600">Paid</dt>
              <dd>{formatMoney(invoice.paidTotal)}</dd>
              <dt className="rounded-l-lg bg-sky-700 px-3 py-2 text-base font-black text-white print:border-y print:border-l print:border-slate-900 print:bg-white print:text-slate-950">
                Balance due
              </dt>
              <dd className="rounded-r-lg bg-sky-700 px-3 py-2 text-base font-black text-white print:border-y print:border-r print:border-slate-900 print:bg-white print:text-slate-950">
                {receivable ? formatMoney(receivable.balance) : "Unavailable"}
              </dd>
            </dl>
          </div>
        </section>

        <footer className="mt-10 border-t border-slate-300 pt-5 text-center text-xs leading-5 text-slate-500">
          <p className="font-semibold text-slate-700">
            Thank you for choosing {invoice.shop.name}.
          </p>
          <p>Please retain this invoice for your service records.</p>
        </footer>
      </div>
    </article>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-5 print:bg-white">
      <h2 className="mb-3 text-xs font-bold uppercase tracking-[0.18em] text-slate-500">
        {title}
      </h2>
      {children}
    </div>
  );
}

function InvoiceTable({
  title,
  empty,
  headings,
  children,
}: {
  title: string;
  empty: string;
  headings: string[];
  children: React.ReactNode;
}) {
  const items = Array.isArray(children) ? children : [children];
  return (
    <section className="invoice-section mt-7">
      <div className="mb-3 flex items-center justify-between border-b-2 border-slate-900 pb-2">
        <h2 className="text-lg font-black">{title}</h2>
      </div>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-4 py-5 text-sm text-slate-500">
          {empty}
        </p>
      ) : (
        <table className="invoice-table w-full border-collapse text-sm">
          <thead>
            <tr>
              {headings.map((heading, index) => (
                <th key={heading} className={index === 0 ? "text-left" : "text-right"}>
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      )}
    </section>
  );
}

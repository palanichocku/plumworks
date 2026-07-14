import { PageHeading } from "@/components/page-heading";

const summaryCards = [
  { label: "Open repair orders", value: "—", note: "No data connected" },
  { label: "Vehicles in shop", value: "—", note: "No data connected" },
  { label: "Outstanding balance", value: "—", note: "No data connected" },
];

export default function DashboardPage() {
  return (
    <>
      <PageHeading
        eyebrow="Overview"
        title="Dashboard"
        description="A simple overview of shop activity will appear here once the application is connected."
      />
      <section className="grid gap-4 md:grid-cols-3">
        {summaryCards.map((card) => (
          <article
            key={card.label}
            className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm"
          >
            <p className="text-sm font-medium text-slate-600">{card.label}</p>
            <p className="mt-4 text-3xl font-bold tracking-tight text-slate-950">
              {card.value}
            </p>
            <p className="mt-2 text-xs text-slate-500">{card.note}</p>
          </article>
        ))}
      </section>
      <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-lg font-semibold text-slate-950">Recent activity</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Shop activity will be displayed here. This shell does not use customer
          or vehicle data.
        </p>
      </section>
    </>
  );
}

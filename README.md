# PlumWorks

PlumWorks is serverless, cloud-first auto repair shop management software built with
Next.js, TypeScript, Tailwind CSS, and the App Router.

## Development

```bash
npm install
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000).

## Checks

```bash
npm run lint
npm run build
```

## Initial shop setup

After the shop fields have been migrated, run the idempotent setup seed:

~~~bash
npm run db:seed
~~~

The seed creates or updates only the configured current-tenant shop. It does not add
customers, vehicles, invoices, or legacy data.

## Legacy customer and vehicle staging

The first legacy import uses a reviewed two-step process:

1. Stage read-only snapshots from only `Cust.DBF` and `vehicles.DBF` in the
   `raw_legacy_customers` and `raw_legacy_vehicles` tables.
2. In a later reviewed change, validate and normalize staged rows into the
   application `customers` and `vehicles` tables.

After the raw-table migration is approved and applied, stage a specific shop
manually:

~~~bash
npm run legacy:import:customers-vehicles -- --shop-id <shop-uuid>
~~~

The command is never run automatically. It reads the two approved DBF paths
without changing them and reports counts/status only; it does not print record
contents. Memo pointers are staged without opening any related legacy files.

Preview raw-to-clean normalization without database writes:

~~~bash
npm run legacy:transform:customers-vehicles -- --dry-run
~~~

The transform reads only the latest raw customer/vehicle staging run for the Car
Doc shop. After the clean-field migration is approved, running the command
without `--dry-run` upserts customers by `legacy_custno` and vehicles by
`legacy_carno`.

The current project includes the application shell, Supabase authentication
foundation, and Prisma schema. Legacy data import is intentionally not included
yet.

# Car Doc

Build Car Doc as a serverless cloud-first auto repair shop application.

## Important
- Do not modify, delete, move, rename, or commit anything inside OriginalWinApp/.
- OriginalWinApp/ contains the legacy Windows Shopman32 app and private customer/shop data.
- Treat legacy files as read-only source material.
- Never commit DBF/FPT/CDX/FRX/FRT/EXE/DLL files or extracted customer sample JSON files.

## Product direction
- Serverless only.
- No Windows installer.
- No local production deployment.
- Target production stack: Vercel + Supabase.

## Tech stack
- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui
- Supabase Auth
- Supabase Postgres
- Supabase Storage
- Prisma for schema/migrations unless asked otherwise

## Legacy data model
The legacy app is Shopman32 / Visual FoxPro style.

Important legacy files:
- OriginalWinApp/Shopman32/data/Cust.DBF
- OriginalWinApp/Shopman32/data/vehicles.DBF
- OriginalWinApp/Shopman32/data/FINAL.DBF
- OriginalWinApp/Shopman32/data/laborfinal.DBF
- OriginalWinApp/Shopman32/data/ar.DBF
- OriginalWinApp/Shopman32/data/orders.DBF
- OriginalWinApp/Shopman32/data/LABORorder.DBF
- OriginalWinApp/Shopman32/data/company.dbf

Preserve legacy IDs in modern tables:
- legacy_custno
- legacy_carno
- legacy_ro_no
- legacy_source_table

## MVP priority
1. Login
2. Dashboard
3. Customer search
4. Customer detail
5. Vehicle detail
6. Service history
7. Invoice history
8. Accounts receivable / balance view

## Build approach
- Keep the new app inside app/.
- Make small, reviewable changes.
- Explain what changed.
- Run lint/type checks when available.
- Do not implement DBF import until explicitly asked.
- Do not use real customer data in seed files, tests, screenshots, or examples.

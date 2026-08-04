# Local marketing-content preview

Public marketing routes can preview a deployment-content JSON file without importing it or writing to a database.

Set `MARKETING_CONTENT_PREVIEW_FILE` to an absolute path when starting the development server:

```sh
MARKETING_CONTENT_PREVIEW_FILE="/absolute/path/to/deployment/content/marketing-content.json" npm run dev
```

Preview mode works only in local development. It is disabled when `NODE_ENV` is `production` or when a Vercel deployment environment is present. The file is read only on the server and must follow the marketing deployment-content JSON schema supported by `scripts/import-marketing-content.mjs`.

The preview replaces marketing settings, pages, services, coupons, testimonials, and gallery items for public rendering. Shop identity, address, and telephone still come from the selected shop database record. No database write or import occurs.

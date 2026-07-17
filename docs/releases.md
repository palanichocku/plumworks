# PlumWorks releases

## Unreleased / current development (`0.1.0`)

- Generic, dry-run-first client provisioning and first-owner bootstrap.
- Separate Vercel and Supabase projects per repair shop client.
- No database migration is included with this provisioning change.

## Release flow

Promote one immutable shared-code release through:

```text
local validation → shared staging → individual client production
```

1. Complete local Prisma validation/generation, lint, build, and relevant verification scripts.
2. Merge the reviewed commit and deploy it to the dedicated staging Vercel/Supabase projects using synthetic data.
3. Run migrations, setup dry-run, owner/access checks, and the smoke-test checklist in `docs/client-deployment-runbook.md`.
4. Choose a SemVer release number. For the first stable release:

```bash
git tag v1.0.0
git push origin v1.0.0
```

5. Deploy that exact tag to each approved client production project. Record the tag, commit SHA, Vercel deployment ID, migration status, backup evidence, and smoke-test result per client.
6. Patch, minor, and major releases use `vMAJOR.MINOR.PATCH`. Client names never appear in shared source tags.

An application rollback redeploys the prior known-good tag. It does not reverse a database migration or data import; those require the release-specific recovery plan and verified backup.

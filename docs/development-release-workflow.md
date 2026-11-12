# PlumWorks Development and Release Workflow

## Purpose

PlumWorks uses `main` as the single source of truth for application code. DEV, Preview, and Production are deployment/runtime environments, not long-lived code branches.

This workflow is designed to keep Car Doc production stable during UAT while allowing architecture hardening and new feature work to proceed safely against the development environment.

## Branch model

### `main`

`main` is the canonical integration and release branch.

Rules:
- Production releases are derived from an approved commit on `main`.
- Do not develop directly on `main` for non-trivial changes.
- Do not maintain client-specific source branches.
- A commit being present on `main` does not by itself authorize a production data migration; migration/release gates still apply.

### Short-lived branches

Use a short-lived branch for each focused change, for example:

- `feature/issue-123-description`
- `fix/issue-123-description`
- `chore/issue-123-description`

Rules:
- Branch from the latest `main`.
- Keep scope limited to the issue being implemented.
- Test the branch against DEV/Preview infrastructure.
- Rebase or merge current `main` before final verification if `main` advanced materially.
- Merge only after focused tests and the required smoke/regression checks pass.
- Delete or retire the branch after merge.

### `dev`

`dev` is no longer an independent development line.

It may temporarily remain as a compatibility/convenience ref, but it must not contain commits that are not already represented on `main` or an active short-lived branch. New development must not branch from stale `dev` history.

If `dev` exists, periodically verify that it has no unique commits. The preferred long-term state is to retire it after all automation and human workflows no longer reference it.

## Environment model

Code branch and runtime environment are separate concepts.

### Development

Use the guarded PlumWorks DEV commands and the development environment configuration to target the `plumworks-dev` Supabase project.

Typical local pattern:

```bash
# Start from current main
git checkout main
git pull origin main

# Create focused work branch
git checkout -b feature/issue-123-description

# Run against guarded DEV environment
npm run db:dev:status
npm run dev
```

Production database credentials must not be used for routine local development.

### Preview

Vercel Preview deployments may be used for browser/UAT verification of a feature branch. Preview environment variables must target approved non-production resources unless an explicitly reviewed exception exists.

### Production

Production is the Car Doc live environment. During active UAT:

- Do not promote structural refactors merely for cleanup.
- Do not run new migrations against Production until they have passed DEV verification and are explicitly approved for promotion.
- Prefer no Production release at all when an issue can be completed through DEV-only validation, tests, or documentation.

## Standard change flow

1. Update local `main` from `origin/main`.
2. Create a short-lived issue branch.
3. Implement the smallest coherent change.
4. Run focused tests locally against DEV/test resources.
5. Run lint/type/build checks appropriate to the change.
6. Run financial/regression checks when the change touches RO, invoice, payments, reports, authorization, tax, shop supplies, AR, or related calculations.
7. Verify the branch in DEV/Preview.
8. Run the standard smoke test for user-visible or deployment-sensitive changes.
9. Merge the reviewed branch to `main`.
10. Promote to Production only when the release is explicitly approved and current UAT/cutover safety permits it.
11. Verify Production after promotion and record the release SHA when operationally significant.

## UAT protection rule

Car Doc Production is currently under active UAT. Platform hardening work should follow this default:

```text
main
  -> short-lived issue branch
  -> DEV database / Preview verification
  -> focused regression tests
  -> smoke test
  -> merge when safe
  -> Production promotion only when explicitly approved
```

A refactor that has no urgent Production benefit may remain unpromoted until UAT sign-off.

## Database migration flow

For a change that introduces a Prisma/PostgreSQL migration:

1. Create/review the migration on the issue branch.
2. Apply it only to the DEV database first.
3. Run migration status verification.
4. Run focused data/workflow tests.
5. Run smoke/regression checks.
6. Review rollback/forward-fix implications.
7. Merge the reviewed migration with its application code.
8. Promote to Production only through an explicit release decision.
9. Verify Production migration status and the affected workflow immediately after deployment.

Never use a production migration as the first validation of a schema change.

## Hotfix flow

For a genuine Production incident:

1. Branch from current `main` using `fix/<issue>-...`.
2. Make the smallest safe fix.
3. Test against DEV/Preview when technically possible, even if the validation window is short.
4. Merge the fix back to `main` before or as part of Production promotion.
5. Verify Production.
6. Do not leave the hotfix only on an environment-specific branch.

The objective is that `main` always contains the exact intended Production code lineage.

## Client-specific configuration

Do not create a branch per client. Client identity, branding, legal copy, tax/settings, monitoring endpoints, domains, notification routing, and similar deployment differences belong in shop-scoped data or environment/configuration mechanisms.

A second client should use the same approved application release with isolated configuration and infrastructure rather than a fork of the PlumWorks source tree.

## Safety checks before work begins

Before a developer or AI agent modifies PlumWorks:

- confirm the current branch;
- confirm the intended issue;
- confirm whether the target is DEV, Preview, or Production;
- verify the database target before migrations or scripts;
- inspect whether `main` advanced since the branch was created;
- avoid touching Production during active UAT unless the issue explicitly requires a Production fix.

## Current transition

Issue #63 establishes this workflow. The previous `dev` branch had one apparently unique password-visibility commit, but the resulting login file was already present identically on `main`. The branch was therefore safely realigned to `main` without losing application behavior.

Future work should begin from `main` on short-lived branches and use the DEV environment for validation.
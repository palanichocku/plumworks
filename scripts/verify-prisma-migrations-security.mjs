import { Client } from "pg";

const directUrl = process.env.DIRECT_URL?.trim();

if (!directUrl) {
  throw new Error("DIRECT_URL is required to verify Prisma migration-table security.");
}

const client = new Client({ connectionString: directUrl });

try {
  await client.connect();

  const securityResult = await client.query(`
    SELECT
      c.relrowsecurity AS "rlsEnabled",
      (
        SELECT COUNT(*)::int
        FROM pg_policy AS policy
        WHERE policy.polrelid = c.oid
      ) AS "policyCount"
    FROM pg_class AS c
    JOIN pg_namespace AS namespace ON namespace.oid = c.relnamespace
    WHERE namespace.nspname = 'public'
      AND c.relname = '_prisma_migrations'
  `);

  const security = securityResult.rows[0];
  if (!security) {
    throw new Error('public."_prisma_migrations" was not found.');
  }
  if (!security.rlsEnabled) {
    throw new Error('RLS is not enabled on public."_prisma_migrations".');
  }
  if (security.policyCount !== 0) {
    throw new Error('public."_prisma_migrations" unexpectedly has RLS policies.');
  }

  const privilegesResult = await client.query(`
    SELECT
      role_name AS "roleName",
      has_table_privilege(role_name, 'public."_prisma_migrations"', 'SELECT')
        OR has_table_privilege(role_name, 'public."_prisma_migrations"', 'INSERT')
        OR has_table_privilege(role_name, 'public."_prisma_migrations"', 'UPDATE')
        OR has_table_privilege(role_name, 'public."_prisma_migrations"', 'DELETE')
        OR has_table_privilege(role_name, 'public."_prisma_migrations"', 'TRUNCATE')
        OR has_table_privilege(role_name, 'public."_prisma_migrations"', 'REFERENCES')
        OR has_table_privilege(role_name, 'public."_prisma_migrations"', 'TRIGGER')
        AS "hasAnyPrivilege"
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS roles(role_name)
    ORDER BY role_name
  `);

  const rolesWithPrivileges = privilegesResult.rows
    .filter((role) => role.hasAnyPrivilege)
    .map((role) => role.roleName);

  if (rolesWithPrivileges.length > 0) {
    throw new Error(`Migration-table privileges remain for: ${rolesWithPrivileges.join(", ")}.`);
  }

  const migrationStatusResult = await client.query(
    'SELECT COUNT(*)::int AS "migrationCount" FROM public."_prisma_migrations"',
  );

  console.log('RLS enabled on public."_prisma_migrations": yes');
  console.log("RLS policies present: 0");
  console.log("anon privileges: none");
  console.log("authenticated privileges: none");
  console.log("service_role privileges: none");
  console.log(
    `Direct Prisma migration connection can read migration status: yes (${migrationStatusResult.rows[0].migrationCount} migrations)`,
  );
} finally {
  await client.end();
}

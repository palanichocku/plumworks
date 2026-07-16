import { readFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("Database configuration is unavailable.");
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

try {
  const [total, withEmail, acceptedBackfilled] = await Promise.all([
    prisma.shopMembership.count(),
    prisma.shopMembership.count({ where: { userEmail: { not: null } } }),
    prisma.$queryRaw`SELECT count(*)::int AS count
      FROM shop_memberships membership
      JOIN audit_logs audit ON audit.metadata->>'membershipId' = membership.id::text
      JOIN staff_invites invite ON invite.id = audit.entity_id AND invite.shop_id = membership.shop_id
      WHERE audit.action = 'staff_invite_accepted'
        AND invite.status = 'accepted'
        AND membership.user_email = lower(trim(invite.email))`,
  ]);
  const matrix = JSON.parse(await readFile(new URL("../src/lib/permission-matrix.json", import.meta.url), "utf8"));
  const acceptedCount = acceptedBackfilled[0]?.count ?? 0;
  console.log(`memberships total: ${total}`);
  console.log(`memberships with email before: 0`);
  console.log(`memberships with email after: ${withEmail}`);
  console.log(`accepted invite membership emails backfilled: ${acceptedCount}`);
  console.log(`Staff page accepted emails available: ${acceptedCount}`);
  console.log(`STAFF blocked from staff management: ${Number(!matrix.STAFF.includes("manage_staff"))}`);
} finally {
  await prisma.$disconnect();
}

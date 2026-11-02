import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { resolveSingleShopId } from "./lib/single-shop.mjs";

export const FRESH_SLATE_CONFIRMATION = "CLEAR_UAT_RUNTIME_DATA";
export const FRESH_SLATE_SQL_TABLES = Object.freeze([
  "signature_evidence",
  "authorization_events",
  "authorization_requests",
  "document_revisions",
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1];
}

async function counts(prisma, shopId) {
  const [
    marketingLeads,
    marketingLeadNotifications,
    marketingLeadNotificationReads,
    publicLeadSubmissions,
  ] = await Promise.all([
    prisma.marketingLead.count({ where: { shopId } }),
    prisma.marketingLeadNotification.count({ where: { shopId } }),
    prisma.marketingLeadNotificationRead.count({ where: { shopId } }),
    prisma.publicLeadSubmission.count({ where: { shopId } }),
  ]);
  const result = {
    marketing_leads: marketingLeads,
    marketing_lead_notifications: marketingLeadNotifications,
    marketing_lead_notification_reads: marketingLeadNotificationReads,
    public_lead_submissions: publicLeadSubmissions,
  };
  for (const table of FRESH_SLATE_SQL_TABLES) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count FROM public.${table} WHERE shop_id = $1::uuid`,
      shopId,
    );
    result[table] = Number(rows[0]?.count ?? 0);
  }
  return result;
}

function total(values) {
  return Object.values(values).reduce((sum, value) => sum + Number(value), 0);
}

async function clearFreshSlateData(prisma, shopId) {
  return prisma.$transaction(async (transaction) => {
    // Marketing runtime/UAT activity. Website content and notification settings are intentionally preserved.
    await transaction.marketingLeadNotificationRead.deleteMany({ where: { shopId } });
    await transaction.marketingLeadNotification.deleteMany({ where: { shopId } });
    await transaction.publicLeadSubmission.deleteMany({ where: { shopId } });
    await transaction.marketingLead.deleteMany({ where: { shopId } });

    // Authorization/signature UAT evidence must be removed in dependency order.
    for (const table of FRESH_SLATE_SQL_TABLES) {
      await transaction.$executeRawUnsafe(
        `DELETE FROM public.${table} WHERE shop_id = $1::uuid`,
        shopId,
      );
    }
  }, { maxWait: 10_000, timeout: 120_000 });
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured.");
  const confirm = argument("--confirm");
  const execute = confirm === FRESH_SLATE_CONFIRMATION;
  if (confirm && !execute) throw new Error(`--confirm must equal ${FRESH_SLATE_CONFIRMATION}.`);

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
  try {
    const shopId = await resolveSingleShopId(prisma, argument("--shop-id"));
    const before = await counts(prisma, shopId);
    console.log(JSON.stringify({ mode: execute ? "confirmed-delete" : "preview", shopId, before, rowsToClear: total(before) }, null, 2));
    if (!execute) {
      console.log(`Preview only. To clear UAT/runtime data, rerun with --confirm ${FRESH_SLATE_CONFIRMATION}.`);
      return;
    }
    await clearFreshSlateData(prisma, shopId);
    const after = await counts(prisma, shopId);
    const remaining = total(after);
    console.log(JSON.stringify({ after, remaining }, null, 2));
    if (remaining !== 0) throw new Error(`Fresh-slate verification failed: ${remaining} targeted row(s) remain.`);
    console.log("Final cutover fresh-slate cleanup: PASS");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

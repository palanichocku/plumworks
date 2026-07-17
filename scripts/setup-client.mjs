import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

const CONFIRMATION = "SETUP_PLUMWORKS_CLIENT";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const options = new Map([
  ["--shop-name", "PLUMWORKS_SHOP_NAME"],
  ["--address", "PLUMWORKS_SHOP_ADDRESS"],
  ["--city", "PLUMWORKS_SHOP_CITY"],
  ["--state", "PLUMWORKS_SHOP_STATE"],
  ["--postal-code", "PLUMWORKS_SHOP_POSTAL_CODE"],
  ["--phone", "PLUMWORKS_SHOP_PHONE"],
  ["--owner-email", "PLUMWORKS_OWNER_EMAIL"],
  ["--shop-slug", "PLUMWORKS_SHOP_SLUG"],
]);

function parseArguments(argv, env) {
  const values = {};
  let confirmation;
  let forceDryRun = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      forceDryRun = true;
      continue;
    }
    if (argument === "--confirm") {
      confirmation = argv[++index];
      if (!confirmation) throw new Error("--confirm requires a value.");
      continue;
    }
    if (!options.has(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[++index];
    if (!value || value.startsWith("--")) throw new Error(`${argument} requires a value.`);
    values[argument] = value.trim();
  }

  for (const [argument, environmentName] of options) {
    values[argument] ||= env[environmentName]?.trim();
  }

  const required = [...options.keys()].filter((argument) => argument !== "--shop-slug");
  const missing = required.filter((argument) => !values[argument]);
  if (missing.length) throw new Error(`Missing required setup inputs: ${missing.join(", ")}.`);
  if (!EMAIL.test(values["--owner-email"])) throw new Error("--owner-email must be a valid email address.");
  if (values["--shop-slug"] && !SLUG.test(values["--shop-slug"])) {
    throw new Error("--shop-slug must contain lowercase letters, numbers, and single hyphens only.");
  }
  if (confirmation && confirmation !== CONFIRMATION) {
    throw new Error(`Write refused. Use --confirm ${CONFIRMATION} exactly.`);
  }

  return {
    dryRun: forceDryRun || confirmation !== CONFIRMATION,
    shopSlugSupplied: Number(Boolean(values["--shop-slug"])),
    ownerEmail: values["--owner-email"].toLowerCase(),
    shop: {
      name: values["--shop-name"],
      addressLine1: values["--address"],
      city: values["--city"],
      state: values["--state"],
      postalCode: values["--postal-code"],
      phone: values["--phone"],
    },
  };
}

async function findAuthUser(database, ownerEmail) {
  const users = await database.$queryRaw`
    SELECT id
    FROM auth.users
    WHERE lower(email) = lower(${ownerEmail})
    ORDER BY created_at ASC
    LIMIT 2
  `;
  if (users.length > 1) throw new Error("More than one matching Supabase Auth user was found.");
  return users[0] ?? null;
}

function printSummary(summary, dryRun) {
  console.log(`mode dry run: ${Number(dryRun)}`);
  console.log(`existing shop rows: ${summary.existingShops}`);
  console.log(`shop rows to create: ${summary.shopsToCreate}`);
  console.log(`shop rows to update: ${summary.shopsToUpdate}`);
  console.log(`matching auth users: ${summary.authUsers}`);
  console.log(`owner memberships to create: ${summary.membershipsToCreate}`);
  console.log(`owner memberships to update: ${summary.membershipsToUpdate}`);
  console.log(`shop slug supplied: ${summary.shopSlugSupplied}`);
  console.log(`database writes performed: ${summary.databaseWrites}`);
}

export async function setupClient(argv = process.argv.slice(2), env = process.env) {
  const input = parseArguments(argv, env);
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not configured.");

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const shops = await prisma.shop.findMany({
      orderBy: { createdAt: "asc" },
      take: 2,
      select: { id: true },
    });
    if (shops.length > 1) {
      throw new Error("Client setup requires a database with zero or one shop row.");
    }

    const authUser = await findAuthUser(prisma, input.ownerEmail);
    const membership = authUser && shops[0]
      ? await prisma.shopMembership.findUnique({
          where: { shopId_userId: { shopId: shops[0].id, userId: authUser.id } },
          select: { role: true, userEmail: true },
        })
      : null;
    const membershipNeedsUpdate = Boolean(
      membership && (membership.role !== "OWNER" || membership.userEmail?.toLowerCase() !== input.ownerEmail),
    );
    const summary = {
      existingShops: shops.length,
      shopsToCreate: Number(shops.length === 0),
      shopsToUpdate: Number(shops.length === 1),
      authUsers: Number(Boolean(authUser)),
      membershipsToCreate: Number(Boolean(authUser && !membership)),
      membershipsToUpdate: Number(membershipNeedsUpdate),
      shopSlugSupplied: input.shopSlugSupplied,
      databaseWrites: 0,
    };

    if (input.dryRun) {
      printSummary(summary, true);
    } else {
      await prisma.$transaction(async (transaction) => {
        const currentShops = await transaction.shop.findMany({
          orderBy: { createdAt: "asc" },
          take: 2,
          select: { id: true },
        });
        if (currentShops.length > 1) {
          throw new Error("Client setup requires a database with zero or one shop row.");
        }
        const shop = currentShops[0]
          ? await transaction.shop.update({
              where: { id: currentShops[0].id },
              data: input.shop,
              select: { id: true },
            })
          : await transaction.shop.create({ data: input.shop, select: { id: true } });

        if (authUser) {
          await transaction.shopMembership.upsert({
            where: { shopId_userId: { shopId: shop.id, userId: authUser.id } },
            create: {
              shopId: shop.id,
              userId: authUser.id,
              userEmail: input.ownerEmail,
              role: "OWNER",
            },
            update: { userEmail: input.ownerEmail, role: "OWNER" },
          });
        }
      }, { isolationLevel: "Serializable" });
      summary.databaseWrites = summary.shopsToCreate + summary.shopsToUpdate
        + summary.membershipsToCreate + summary.membershipsToUpdate;
      printSummary(summary, false);
    }

    if (!authUser) {
      console.log("Owner setup pending: create or sign up the owner in Supabase Auth first.");
      console.log("Owner setup next step: rerun this command with the same inputs and confirmation phrase.");
    } else {
      console.log("Owner setup ready: an OWNER membership exists or is planned for the matching Auth user.");
    }
    console.log("Owner safety: setup only creates or promotes an owner; it never demotes or removes an existing owner.");
  } finally {
    await prisma.$disconnect();
  }
}

const isDirectRun = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  setupClient().catch((error) => {
    console.error(`Client setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}

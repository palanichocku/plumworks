import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import {
  PRODUCTION_ENV_FILE, inProductionStage, installProductionSetupEnvironment,
  loadProductionSetupEnvironment, parseProductionSetup, productionFailureLines,
  setupProductionMonitor,
} from "./lib/prod-plumservice-setup.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

async function main() {
  const { env, target, isolatedEnv, input } = await inProductionStage("environment_validation", () => {
    const { env, target, isolatedEnv } = loadProductionSetupEnvironment(resolve(root, PRODUCTION_ENV_FILE));
    return { env, target, isolatedEnv, input: parseProductionSetup(process.argv.slice(2), env) };
  });
  installProductionSetupEnvironment(isolatedEnv);
  console.log(`Verified production project ref: ${target.projectRef}.`);
  const db = await inProductionStage("production_shop_lookup", () => new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) }));
  try {
    const auth = await inProductionStage("supabase_admin_client", () => createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
      auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    }).auth);
    const result = await setupProductionMonitor({ db, auth, verifiedProjectRef: target.projectRef, ...input });
    if (result.userId) console.log(`Production Auth user ID: ${result.userId.slice(0, 8)}…`);
  } finally { await db.$disconnect(); }
}

main().catch((error) => {
  for (const line of productionFailureLines(error)) console.error(line);
  process.exitCode = 1;
});

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { readFallbackEnvironmentNames } from "./lib/development-database-target.mjs";
import { inSetupStage, installDevelopmentSetupEnvironment, loadDevelopmentSetupEnvironment, parseMonitorSetup, setupDevMonitor, setupFailureLines } from "./lib/dev-plumservice-setup.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
async function main() {
  const { env, target, isolatedEnv, input } = await inSetupStage("environment_validation", () => {
    const { env, target, isolatedEnv } = loadDevelopmentSetupEnvironment(resolve(root, ".env.development.local"), process.env, readFallbackEnvironmentNames(root));
    const input = parseMonitorSetup(process.argv.slice(2), env);
    return { env, target, isolatedEnv, input };
  });
  // Remove ambient credentials and targets before constructing any client or making a lookup.
  installDevelopmentSetupEnvironment(isolatedEnv);
  console.log(`Verified development project ref: ${target.projectRef}.`);
  if (input.write && !env.SUPABASE_SECRET_KEY?.trim()) {
    await inSetupStage("environment_validation", () => { throw new Error("Missing DEV Supabase secret key."); });
  }
  const db = await inSetupStage("dev_shop_lookup", () => new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }) }));
  const auth = await inSetupStage("supabase_admin_client", () => env.SUPABASE_SECRET_KEY?.trim()
    ? createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }).auth
    : null);
  try {
    const result = await setupDevMonitor({ db, auth, ...input });
    if (result.userId) console.log(`DEV Auth user ID: ${result.userId.slice(0, 8)}…`);
  } finally { await db.$disconnect(); }
}

main().catch((error) => {
  for (const line of setupFailureLines(error)) console.error(line);
  process.exitCode = 1;
});

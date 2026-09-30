import { readFileSync } from "node:fs";

export const PRODUCTION_PROJECT_REF = "ouxlfjkklxlomnpoqrwy";
export const DEVELOPMENT_PROJECT_REF = "qchvjaqwanyimkidlqqu";
export const PRODUCTION_ENV_FILE = ".env.production.monitor.local";
export const PRODUCTION_MONITOR_EMAIL = "plumservice-prod@plumworksapp.com";
export const PRODUCTION_WRITE_CONFIRMATION = "CREATE_PROD_PLUMSERVICE";

const stages = new Set([
  "environment_validation", "supabase_admin_client", "auth_user_lookup",
  "production_shop_lookup", "existing_membership_lookup", "setup_plan",
  "auth_user_creation", "membership_write",
]);
const osEnvironmentNames = ["PATH", "HOME", "USER", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM", "CI", "SystemRoot", "ComSpec", "PATHEXT"];

export class ProductionSetupStageError extends Error {
  constructor(stage) {
    super("Production setup stage failed.");
    this.name = "ProductionSetupStageError";
    this.stage = stages.has(stage) ? stage : "setup_plan";
  }
}

export async function inProductionStage(stage, work) {
  try { return await work(); }
  catch { throw new ProductionSetupStageError(stage); }
}

export function productionFailureLines(error) {
  const stage = error instanceof ProductionSetupStageError ? error.stage : "setup_plan";
  return [
    `Production plumservice setup failed during: ${stage}`,
    "Production plumservice setup failed. Check the explicit target, required variables, and account state; no secret details were logged.",
  ];
}

function required(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new ProductionSetupStageError("environment_validation");
  return value;
}

function databaseRef(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new ProductionSetupStageError("environment_validation"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || !url.password) throw new ProductionSetupStageError("environment_validation");
  const direct = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  if (direct) return direct[1].toLowerCase();
  if (url.hostname.endsWith(".pooler.supabase.com")) {
    let username;
    try { username = decodeURIComponent(url.username); }
    catch { throw new ProductionSetupStageError("environment_validation"); }
    const pooled = username.match(/^postgres\.([a-z0-9]+)$/i);
    if (pooled) return pooled[1].toLowerCase();
  }
  throw new ProductionSetupStageError("environment_validation");
}

function apiRef(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new ProductionSetupStageError("environment_validation"); }
  const match = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
  if (url.protocol !== "https:" || !match || url.username || url.password || url.port || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new ProductionSetupStageError("environment_validation");
  }
  return match[1].toLowerCase();
}

export function validateProductionSetupTarget(env) {
  const values = [required(env, "DATABASE_URL"), required(env, "DIRECT_URL"), required(env, "NEXT_PUBLIC_SUPABASE_URL")];
  if (values.some((value) => value.toLowerCase().includes(DEVELOPMENT_PROJECT_REF))) throw new ProductionSetupStageError("environment_validation");
  if (databaseRef(values[0]) !== PRODUCTION_PROJECT_REF || databaseRef(values[1]) !== PRODUCTION_PROJECT_REF || apiRef(values[2]) !== PRODUCTION_PROJECT_REF) {
    throw new ProductionSetupStageError("environment_validation");
  }
  if (!required(env, "SUPABASE_SECRET_KEY").startsWith("sb_secret_")) throw new ProductionSetupStageError("environment_validation");
  if (required(env, "MONITOR_USER_EMAIL").toLowerCase() !== PRODUCTION_MONITOR_EMAIL) throw new ProductionSetupStageError("environment_validation");
  required(env, "MONITOR_USER_PASSWORD");
  return { projectRef: PRODUCTION_PROJECT_REF };
}

export function readProductionEnvironmentFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  const names = [...new Set([...source.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((match) => match[1]))];
  if (typeof process.loadEnvFile !== "function") throw new ProductionSetupStageError("environment_validation");
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.loadEnvFile(filePath);
    return Object.fromEntries(names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
  } finally {
    for (const name of names) {
      delete process.env[name];
      const value = previous.get(name);
      if (value !== undefined) process.env[name] = value;
    }
  }
}

export function loadProductionSetupEnvironment(filePath, ambientEnv = process.env) {
  const env = readProductionEnvironmentFile(filePath);
  const target = validateProductionSetupTarget(env);
  const isolatedEnv = Object.fromEntries(osEnvironmentNames.filter((name) => ambientEnv[name] !== undefined).map((name) => [name, ambientEnv[name]]));
  Object.assign(isolatedEnv, env, { NODE_ENV: "production" });
  return { env, target, isolatedEnv };
}

export function installProductionSetupEnvironment(isolatedEnv, runtimeEnv = process.env) {
  for (const name of Object.keys(runtimeEnv)) delete runtimeEnv[name];
  Object.assign(runtimeEnv, isolatedEnv);
}

export function parseProductionSetup(argv, env) {
  const confirmation = argv.length === 2 && argv[0] === "--confirm" ? argv[1] : null;
  if (argv.length && confirmation === null) throw new ProductionSetupStageError("environment_validation");
  if (confirmation && confirmation !== PRODUCTION_WRITE_CONFIRMATION) throw new ProductionSetupStageError("environment_validation");
  return { write: confirmation === PRODUCTION_WRITE_CONFIRMATION, email: required(env, "MONITOR_USER_EMAIL").toLowerCase(), password: required(env, "MONITOR_USER_PASSWORD") };
}

async function findProductionAuthUser(auth, email) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users) throw new ProductionSetupStageError("auth_user_lookup");
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 200) return null;
  }
  throw new ProductionSetupStageError("auth_user_lookup");
}

function membershipAction(rows, matchingEmail, shopId, userId, email) {
  if (rows.length > 1 || rows.some((row) => row.shopId !== shopId || row.role !== "MONITOR") || (matchingEmail && matchingEmail.userId !== userId)) {
    throw new ProductionSetupStageError("setup_plan");
  }
  return rows.length ? rows[0].userEmail?.toLowerCase() === email ? "none" : "update-email" : "create";
}

export async function setupProductionMonitor({ db, auth, verifiedProjectRef, email, password, write, logger = console.log }) {
  if (verifiedProjectRef !== PRODUCTION_PROJECT_REF || email !== PRODUCTION_MONITOR_EMAIL || !password || !auth) throw new ProductionSetupStageError("environment_validation");
  const shops = await inProductionStage("production_shop_lookup", () => db.shop.findMany({ take: 2, select: { id: true } }));
  if (shops.length !== 1) throw new ProductionSetupStageError("setup_plan");
  let user = await inProductionStage("auth_user_lookup", async () => {
    const found = await findProductionAuthUser(auth, email);
    if (found && (found.user_metadata?.account_type !== "monitoring" || found.user_metadata?.name !== "plumservice")) throw new ProductionSetupStageError("auth_user_lookup");
    return found;
  });
  const shopId = shops[0].id;
  const matchingEmail = await inProductionStage("existing_membership_lookup", () => db.shopMembership.findFirst({ where: { shopId, userEmail: { equals: email, mode: "insensitive" } }, select: { userId: true } }));
  if (!user && matchingEmail) throw new ProductionSetupStageError("setup_plan");
  const rows = user ? await inProductionStage("existing_membership_lookup", () => db.shopMembership.findMany({ where: { userId: user.id }, take: 2, select: { shopId: true, role: true, userEmail: true } })) : [];
  const action = user ? membershipAction(rows, matchingEmail, shopId, user.id, email) : "create";
  if (!write) {
    logger(`Dry run: Auth account ${user ? "exists" : "would be created"}; no writes performed.`);
    logger(`Dry run: MONITOR membership action ${user ? action : "would be created after Auth user creation"}.`);
    return { authCreated: false, membershipAction: "none", userId: user?.id ?? null };
  }
  let authCreated = false;
  if (!user) {
    const created = await inProductionStage("auth_user_creation", () => auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { account_type: "monitoring", name: "plumservice" } }));
    if (created.error || !created.data?.user?.id) throw new ProductionSetupStageError("auth_user_creation");
    user = created.data.user;
    authCreated = true;
  }
  const currentRows = await inProductionStage("existing_membership_lookup", () => db.shopMembership.findMany({ where: { userId: user.id }, take: 2, select: { shopId: true, role: true, userEmail: true } }));
  const currentEmail = await inProductionStage("existing_membership_lookup", () => db.shopMembership.findFirst({ where: { shopId, userEmail: { equals: email, mode: "insensitive" } }, select: { userId: true } }));
  const currentAction = membershipAction(currentRows, currentEmail, shopId, user.id, email);
  if (currentAction === "create") {
    await inProductionStage("membership_write", () => db.shopMembership.create({ data: { shopId, userId: user.id, userEmail: email, role: "MONITOR" } }));
  } else if (currentAction === "update-email") {
    const updated = await inProductionStage("membership_write", () => db.shopMembership.updateMany({ where: { shopId, userId: user.id, role: "MONITOR" }, data: { userEmail: email } }));
    if (updated.count !== 1) throw new ProductionSetupStageError("membership_write");
  }
  logger(`Production monitoring setup: Auth ${authCreated ? "created" : "reused"}; membership ${currentAction}.`);
  return { authCreated, membershipAction: currentAction, userId: user.id };
}

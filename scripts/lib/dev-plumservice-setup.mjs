import {
  createDevelopmentChildEnvironment,
  PROTECTED_SUPABASE_PROJECTS,
  readEnvironmentFile,
  validateDevelopmentDatabaseTarget,
} from "./development-database-target.mjs";

export const MONITOR_EMAIL = "plumservice-dev@plumworksapp.com";
export const WRITE_CONFIRMATION = "CREATE_DEV_PLUMSERVICE";
const SETUP_STAGES = new Set([
  "environment_validation", "supabase_admin_client", "dev_shop_lookup",
  "auth_user_lookup", "existing_membership_lookup", "setup_plan",
  "auth_user_creation", "membership_write",
]);

export class SetupStageError extends Error {
  constructor(stage) {
    super("DEV setup stage failed.");
    this.name = "SetupStageError";
    this.stage = SETUP_STAGES.has(stage) ? stage : "setup_plan";
  }
}

export async function inSetupStage(stage, work) {
  try { return await work(); }
  catch { throw new SetupStageError(stage); }
}

export function setupFailureLines(error) {
  const stage = error instanceof SetupStageError ? error.stage : "setup_plan";
  return [
    `DEV plumservice setup failed during: ${stage}`,
    "DEV plumservice setup failed. Check the guarded target, required variables, and account state; no secret details were logged.",
  ];
}

export function loadDevelopmentSetupEnvironment(filePath, ambientEnv = process.env, fallbackNames = []) {
  const env = readEnvironmentFile(filePath);
  const target = validateDevelopmentDatabaseTarget(env);
  for (const name of ["DATABASE_URL", "DIRECT_URL", "NEXT_PUBLIC_SUPABASE_URL"]) {
    if (env[name]?.toLowerCase().includes(PROTECTED_SUPABASE_PROJECTS.production)) {
      throw new SetupStageError("environment_validation");
    }
  }
  return { env, target, isolatedEnv: createDevelopmentChildEnvironment(env, ambientEnv, fallbackNames) };
}

export function installDevelopmentSetupEnvironment(isolatedEnv, runtimeEnv = process.env) {
  for (const name of Object.keys(runtimeEnv)) delete runtimeEnv[name];
  Object.assign(runtimeEnv, isolatedEnv);
}

export function parseMonitorSetup(argv, env) {
  const confirmation = argv.length === 2 && argv[0] === "--confirm" ? argv[1] : null;
  if (argv.length && confirmation === null) throw new Error("Use --confirm CREATE_DEV_PLUMSERVICE for write mode.");
  if (confirmation && confirmation !== WRITE_CONFIRMATION) throw new Error("Write confirmation phrase did not match.");
  const email = env.MONITOR_USER_EMAIL?.trim().toLowerCase();
  if (email && email !== MONITOR_EMAIL) throw new Error("MONITOR_USER_EMAIL must be the dedicated DEV plumservice address.");
  return { write: confirmation === WRITE_CONFIRMATION, email, password: env.MONITOR_USER_PASSWORD };
}

export function assertExistingMonitorUser(user) {
  if (user.user_metadata?.account_type !== "monitoring" || user.user_metadata?.name !== "plumservice") {
    throw new Error("The existing Auth email belongs to a non-monitoring account; no account was changed.");
  }
}

export function membershipPlan(rows, matchingEmail, shopId, userId, email) {
  if (rows.some((row) => row.shopId !== shopId || row.role !== "MONITOR")) {
    throw new Error("An existing non-monitoring membership would be affected; setup refused.");
  }
  if (matchingEmail && matchingEmail.userId !== userId) {
    throw new Error("The monitoring email belongs to another membership; setup refused.");
  }
  const current = rows[0];
  return current ? current.userEmail?.toLowerCase() === email ? "none" : "update-email" : "create";
}

export async function findAuthUser(auth, email) {
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data?.users) throw new Error("Could not inspect DEV Auth users.");
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 200) return null;
  }
  throw new Error("DEV Auth user search exceeded its safe page limit.");
}

export async function setupDevMonitor({ db, auth, email, password, write, logger = console.log }) {
  const shops = await inSetupStage("dev_shop_lookup", () => db.shop.findMany({ take: 2, select: { id: true } }));
  if (shops.length !== 1) throw new Error("DEV setup requires exactly one shop.");
  if (!email || email !== MONITOR_EMAIL) throw new Error("Add MONITOR_USER_EMAIL for the dedicated DEV plumservice address.");
  if (!password) throw new Error("Add MONITOR_USER_PASSWORD to .env.development.local.");
  if (write && !auth) throw new Error("Add SUPABASE_SECRET_KEY to .env.development.local before write mode.");

  let user = auth ? await inSetupStage("auth_user_lookup", async () => {
    const found = await findAuthUser(auth, email);
    if (found) assertExistingMonitorUser(found);
    return found;
  }) : null;
  const existingEmailMembership = await inSetupStage("existing_membership_lookup", () => db.shopMembership.findFirst({ where: { shopId: shops[0].id, userEmail: { equals: email, mode: "insensitive" } }, select: { userId: true } }));
  if (!user && existingEmailMembership) throw new Error("The monitoring email belongs to another membership; setup refused.");
  const existingRows = user ? await inSetupStage("existing_membership_lookup", () => db.shopMembership.findMany({ where: { userId: user.id }, take: 2, select: { shopId: true, role: true, userEmail: true } })) : [];
  if (user) membershipPlan(existingRows, existingEmailMembership, shops[0].id, user.id, email);
  if (!write) {
    logger(`Dry run: Auth account ${auth ? user ? "exists" : "would be created" : "not inspected (SUPABASE_SECRET_KEY missing)"}; no writes performed.`);
    if (user) {
      logger(`Dry run: membership action ${membershipPlan(existingRows, existingEmailMembership, shops[0].id, user.id, email)}.`);
    } else logger(auth ? "Dry run: MONITOR membership would be created after Auth user creation." : "Dry run: membership action awaits DEV Auth inspection.");
    return { authCreated: false, membershipAction: "none", userId: user?.id ?? null };
  }

  let authCreated = false;
  if (!user) {
    const created = await inSetupStage("auth_user_creation", () => auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { account_type: "monitoring", name: "plumservice" } }));
    if (created.error || !created.data?.user?.id) throw new Error("DEV monitoring Auth user could not be created.");
    user = created.data.user;
    authCreated = true;
  }
  const rows = await inSetupStage("existing_membership_lookup", () => db.shopMembership.findMany({ where: { userId: user.id }, take: 2, select: { shopId: true, role: true, userEmail: true } }));
  const matchingEmail = await inSetupStage("existing_membership_lookup", () => db.shopMembership.findFirst({ where: { shopId: shops[0].id, userEmail: { equals: email, mode: "insensitive" } }, select: { userId: true } }));
  const action = membershipPlan(rows, matchingEmail, shops[0].id, user.id, email);
  if (action === "create") {
    await inSetupStage("membership_write", () => db.shopMembership.create({ data: { shopId: shops[0].id, userId: user.id, userEmail: email, role: "MONITOR" } }));
  } else if (action === "update-email") {
    const result = await inSetupStage("membership_write", () => db.shopMembership.updateMany({ where: { shopId: shops[0].id, userId: user.id, role: "MONITOR" }, data: { userEmail: email } }));
    if (result.count !== 1) throw new Error("MONITOR membership changed during setup; no role was changed.");
  }
  logger(`DEV monitoring setup: Auth ${authCreated ? "created" : "reused"}; membership ${action}.`);
  return { authCreated, membershipAction: action, userId: user.id };
}

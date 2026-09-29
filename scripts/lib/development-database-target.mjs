import { readFileSync } from "node:fs";

export const DEVELOPMENT_ENV_FILE = ".env.development.local";
export const APPROVED_DEVELOPMENT_REF_VARIABLE = "PLUMWORKS_DEV_SUPABASE_PROJECT_REF";

export const PROTECTED_SUPABASE_PROJECTS = Object.freeze({
  production: "ouxlfjkklxlomnpoqrwy",
  "restore-rehearsal": "zrhmwclenchxouxbpljk",
});

const REQUIRED_VARIABLES = ["DATABASE_URL", "DIRECT_URL", "NEXT_PUBLIC_SUPABASE_URL"];
const OS_ENV_ALLOWLIST = [
  "PATH", "HOME", "USER", "TMPDIR", "TMP", "TEMP", "LANG", "LC_ALL", "TERM", "CI",
  "SystemRoot", "ComSpec", "PATHEXT", "PORT", "HOSTNAME",
];

function requiredValue(env, name) {
  const value = env[name]?.trim();
  if (!value) throw new Error(`Development database configuration is missing ${name}.`);
  return value;
}

function protectedEnvironment(ref) {
  for (const [environment, protectedRef] of Object.entries(PROTECTED_SUPABASE_PROJECTS)) {
    if (ref === protectedRef) return environment;
  }
  return null;
}

function parseUrl(value, variable) {
  try {
    return new URL(value);
  } catch {
    throw new Error(`${variable} is malformed; the development database target cannot be verified.`);
  }
}

function databaseProjectRef(value, variable) {
  const url = parseUrl(value, variable);
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.username || !url.password) {
    throw new Error(`${variable} must be a credentialed PostgreSQL URL for the approved Supabase project.`);
  }

  const directMatch = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  if (directMatch) return directMatch[1].toLowerCase();

  if (url.hostname.endsWith(".pooler.supabase.com")) {
    let username;
    try {
      username = decodeURIComponent(url.username);
    } catch {
      throw new Error(`${variable} does not expose a verifiable Supabase project identity.`);
    }
    const poolerMatch = username.match(/^postgres\.([a-z0-9]+)$/i);
    if (poolerMatch) return poolerMatch[1].toLowerCase();
  }

  throw new Error(`${variable} does not expose a verifiable Supabase project identity.`);
}

function apiProjectRef(value) {
  const url = parseUrl(value, "NEXT_PUBLIC_SUPABASE_URL");
  const match = url.hostname.match(/^([a-z0-9]+)\.supabase\.co$/i);
  if (url.protocol !== "https:" || !match || url.username || url.password || url.port || url.search || url.hash || !["", "/"].includes(url.pathname)) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be the HTTPS API URL of a verifiable Supabase project.");
  }
  return match[1].toLowerCase();
}

function assertNotProtected(ref, source) {
  const protectedName = protectedEnvironment(ref);
  if (protectedName === "production") {
    throw new Error(`Refusing protected production Supabase project target from ${source}.`);
  }
  if (protectedName === "restore-rehearsal") {
    throw new Error(`Refusing protected restore-rehearsal Supabase project target from ${source}.`);
  }
}

export function validateDevelopmentDatabaseTarget(env) {
  const approvedRef = requiredValue(env, APPROVED_DEVELOPMENT_REF_VARIABLE).toLowerCase();
  requiredValue(env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (!/^[a-z0-9]+$/.test(approvedRef)) {
    throw new Error(`${APPROVED_DEVELOPMENT_REF_VARIABLE} must contain the explicitly approved Supabase project ref.`);
  }
  assertNotProtected(approvedRef, APPROVED_DEVELOPMENT_REF_VARIABLE);

  const refs = Object.fromEntries(REQUIRED_VARIABLES.map((name) => {
    const value = requiredValue(env, name);
    return [name, name === "NEXT_PUBLIC_SUPABASE_URL"
      ? apiProjectRef(value)
      : databaseProjectRef(value, name)];
  }));

  for (const [name, ref] of Object.entries(refs)) {
    assertNotProtected(ref, name);
    if (ref !== approvedRef) {
      throw new Error(`${name} targets a different Supabase project than the explicitly approved development project.`);
    }
  }

  return { projectRef: approvedRef };
}

export function environmentVariableNames(source) {
  return [...new Set([...source.matchAll(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)].map((match) => match[1]))];
}

export function readEnvironmentFile(filePath) {
  const source = readFileSync(filePath, "utf8");
  const names = environmentVariableNames(source);
  if (typeof process.loadEnvFile !== "function") {
    throw new Error("This Node.js version cannot safely load the development environment file.");
  }

  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.loadEnvFile(filePath);
    return Object.fromEntries(names.filter((name) => process.env[name] !== undefined).map((name) => [name, process.env[name]]));
  } catch {
    throw new Error(`Unable to safely load ${DEVELOPMENT_ENV_FILE}.`);
  } finally {
    for (const name of names) {
      delete process.env[name];
      const value = previous.get(name);
      if (value !== undefined) process.env[name] = value;
    }
  }
}

export function createDevelopmentChildEnvironment(developmentEnv, ambientEnv = process.env, fallbackNames = []) {
  const childEnv = Object.fromEntries(OS_ENV_ALLOWLIST
    .filter((name) => ambientEnv[name] !== undefined)
    .map((name) => [name, ambientEnv[name]]));

  // Next.js loads fallback env files even in development. Empty sentinels prevent
  // their values from replacing absent development settings; ambient secrets are
  // never copied into this child process.
  for (const name of fallbackNames) {
    if (!(name in developmentEnv) && !["NODE_ENV", "PLUMWORKS_DEV_SUPABASE_PROJECT_REF"].includes(name)) {
      childEnv[name] = "";
    }
  }

  Object.assign(childEnv, developmentEnv, { NODE_ENV: "development" });
  return childEnv;
}

export function readFallbackEnvironmentNames(rootDirectory) {
  const names = new Set();
  for (const file of [".env.local", ".env.development", ".env"]) {
    try {
      for (const name of environmentVariableNames(readFileSync(`${rootDirectory}/${file}`, "utf8"))) names.add(name);
    } catch {
      // A missing fallback file contributes no variables.
    }
  }
  return [...names];
}

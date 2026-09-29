import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDevelopmentChildEnvironment,
  DEVELOPMENT_ENV_FILE,
  readEnvironmentFile,
  readFallbackEnvironmentNames,
  validateDevelopmentDatabaseTarget,
} from "./lib/development-database-target.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

export function commandPlan(operation, forwardedArgs = []) {
  const prismaCli = resolve(root, "node_modules/prisma/build/index.js");
  const setupScript = resolve(root, "scripts/setup-client.mjs");
  const nextCli = resolve(root, "node_modules/next/dist/bin/next");
  const plans = {
    status: [prismaCli, "migrate", "status"],
    migrate: [prismaCli, "migrate", "deploy"],
    generate: [prismaCli, "generate"],
    setup: [setupScript, ...forwardedArgs],
    app: [nextCli, "dev", ...forwardedArgs],
  };
  const args = plans[operation];
  if (!args) throw new Error("Choose a supported development command: status, migrate, generate, setup, or app.");
  if (["status", "migrate", "generate"].includes(operation) && forwardedArgs.length) {
    throw new Error("Prisma development commands do not accept argument overrides.");
  }
  return args;
}

export function runDevelopmentCommand(operation, forwardedArgs = []) {
  const envFile = resolve(root, DEVELOPMENT_ENV_FILE);
  if (!existsSync(envFile)) throw new Error(`${DEVELOPMENT_ENV_FILE} is required; no database command was started.`);

  const developmentEnv = readEnvironmentFile(envFile);
  const target = validateDevelopmentDatabaseTarget(developmentEnv);
  const args = commandPlan(operation, forwardedArgs);
  const env = createDevelopmentChildEnvironment(
    developmentEnv,
    process.env,
    readFallbackEnvironmentNames(root),
  );

  console.log(`Development database target verified: ${target.projectRef}.`);
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
  child.on("error", () => {
    console.error("Unable to start the guarded development command.");
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => child.kill(signal));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [operation, ...forwardedArgs] = process.argv.slice(2);
  try {
    runDevelopmentCommand(operation, forwardedArgs);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Development target validation failed.");
    process.exitCode = 1;
  }
}

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDevelopmentChildEnvironment,
  readEnvironmentFile,
  readFallbackEnvironmentNames,
  validateDevelopmentDatabaseTarget,
} from "./lib/development-database-target.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const operation = process.argv[2];
if (!["smoke", "report", "send"].includes(operation)) {
  console.error("Choose smoke, report, or send.");
  process.exitCode = 1;
} else {
  try {
    const developmentEnv = readEnvironmentFile(resolve(root, ".env.development.local"));
    const target = validateDevelopmentDatabaseTarget(developmentEnv);
    const env = createDevelopmentChildEnvironment(developmentEnv, process.env, readFallbackEnvironmentNames(root));
    env.MONITOR_BASE_URL ||= "http://localhost:3000";
    if (env.MONITOR_BASE_URL !== "http://localhost:3000") throw new Error("The dev monitor must target http://localhost:3000.");
    if (operation === "smoke" && !["MONITOR_HEALTH_TOKEN", "MONITOR_USER_EMAIL", "MONITOR_USER_PASSWORD"].every((name) => env[name]?.trim())) {
      throw new Error("Dev monitoring token or login credentials are missing.");
    }
    if (operation === "send") {
      if (!env.MONITOR_REPORT_EMAIL?.trim()) throw new Error("Dev monitoring report recipient is missing.");
      const local = readEnvironmentFile(resolve(root, ".env.local"));
      for (const name of ["RESEND_API_KEY", "TRANSACTIONAL_EMAIL_FROM"]) env[name] ||= local[name] || "";
      if (!env.RESEND_API_KEY || !env.TRANSACTIONAL_EMAIL_FROM) throw new Error("Local Resend configuration is missing.");
    }
    env.MONITOR_HEARTBEAT_URL = "";
    const args = operation === "smoke"
      ? [resolve(root, "node_modules/@playwright/test/cli.js"), "test", "--config=playwright.monitor.config.ts"]
      : [resolve(root, "scripts/monitor-report.ts"), "--dev", ...(operation === "send" ? ["--send"] : [])];
    console.log(`Verified dev monitoring target: ${target.projectRef}; origin: http://localhost:3000.`);
    const child = spawn(process.execPath, args, { cwd: root, env, stdio: "inherit" });
    child.on("error", () => { console.error("Dev monitoring command could not start."); process.exitCode = 1; });
    child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
    for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => child.kill(signal));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Dev monitoring setup failed.");
    process.exitCode = 1;
  }
}

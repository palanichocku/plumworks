import { mkdir, readFile, writeFile } from "node:fs/promises";
import { formatReport, measuredCheck, summarize, type MonitoringResult } from "../src/lib/monitoring/report.ts";
import { sendResendEmail } from "../src/lib/email/resend-core.ts";

async function main() {
  let result: MonitoringResult;
  try {
    result = JSON.parse(await readFile("artifacts/monitoring/result.json", "utf8"));
  } catch {
    result = summarize(new Date().toISOString(), new Date().toISOString(), [measuredCheck("Monitoring suite", "app", false, 0)]);
    await mkdir("artifacts/monitoring", { recursive: true });
    await writeFile("artifacts/monitoring/result.json", JSON.stringify(result, null, 2) + "\n", { mode: 0o600 });
    process.exitCode = 1;
  }
  const report = formatReport(result, process.argv.includes("--dev") ? "DEV / Stage 1A validation" : "Production");
  console.log(report.text);
  if (process.argv.includes("--send")) {
    const to = process.env.MONITOR_REPORT_EMAIL;
    if (!to) {
      console.error("MONITOR_REPORT_EMAIL is missing.");
      process.exitCode = 1;
    } else {
      const sent = await sendResendEmail({ to, ...report });
      if (!sent.ok) {
        console.error(`Monitoring email was not delivered (${sent.code}).`);
        process.exitCode = 1;
      } else console.log("Monitoring email accepted by Resend.");
    }
  }
  if (result.overall === "HEALTHY" && process.exitCode !== 1 && process.env.MONITOR_HEARTBEAT_URL) {
    try {
      const response = await fetch(process.env.MONITOR_HEARTBEAT_URL, { method: "GET", signal: AbortSignal.timeout(10000) });
      if (!response.ok) console.warn("Monitoring heartbeat delivery failed.");
    } catch { console.warn("Monitoring heartbeat delivery failed."); }
  }
  if (result.overall === "FAILED") process.exitCode = 1;
}

main().catch(() => { console.error("Monitoring report could not be completed."); process.exitCode = 1; });

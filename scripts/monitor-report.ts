import { mkdir, readFile, writeFile } from "node:fs/promises";
import { formatReport, measuredCheck, summarize, type MonitoringResult } from "../src/lib/monitoring/report.ts";
import { sendResendEmail } from "../src/lib/email/resend-core.ts";

const deliveryPath = "artifacts/monitoring/report-delivery.json";

async function recordDelivery(ok: boolean, detail: string) {
  await mkdir("artifacts/monitoring", { recursive: true });
  await writeFile(
    deliveryPath,
    JSON.stringify({ ok, detail, recordedAt: new Date().toISOString() }, null, 2) + "\n",
    { mode: 0o600 },
  );
}

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
      await recordDelivery(false, "MONITOR_REPORT_EMAIL is missing");
      process.exitCode = 1;
    } else {
      const sent = await sendResendEmail({ to, ...report });
      if (!sent.ok) {
        console.error(`Monitoring email was not delivered (${sent.code}).`);
        await recordDelivery(false, `Resend delivery failed (${sent.code})`);
        process.exitCode = 1;
      } else {
        console.log("Monitoring email accepted by Resend.");
        await recordDelivery(true, "Monitoring email accepted by Resend");
      }
    }
  }

  // Heartbeat delivery intentionally lives in the GitHub Actions workflow.
  // That keeps success/failure signaling independent from the application import tree.
  if (result.overall === "FAILED") process.exitCode = 1;
}

main().catch(async () => {
  console.error("Monitoring report could not be completed.");
  try {
    await recordDelivery(false, "Monitoring report could not be completed");
  } catch {
    // The workflow-level fallback remains responsible for alerting.
  }
  process.exitCode = 1;
});

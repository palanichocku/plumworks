import { mkdir, readFile, writeFile } from "node:fs/promises";
import { formatReport, measuredCheck, summarize, type MonitoringResult } from "../src/lib/monitoring/report.ts";

const deliveryPath = "artifacts/monitoring/report-delivery.json";

async function recordDelivery(ok: boolean, detail: string) {
  await mkdir("artifacts/monitoring", { recursive: true });
  await writeFile(
    deliveryPath,
    JSON.stringify({ ok, detail, recordedAt: new Date().toISOString() }, null, 2) + "\n",
    { mode: 0o600 },
  );
}

async function sendMonitoringEmail(to: string, report: { subject: string; text: string; html: string }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.TRANSACTIONAL_EMAIL_FROM;
  if (!apiKey || !from) return { ok: false, code: "email-config-missing" } as const;

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], ...report }),
      signal: AbortSignal.timeout(15000),
    });
    return response.ok
      ? ({ ok: true, code: "accepted" } as const)
      : ({ ok: false, code: `http-${response.status}` } as const);
  } catch {
    return { ok: false, code: "request-failed" } as const;
  }
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
      const sent = await sendMonitoringEmail(to, report);
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

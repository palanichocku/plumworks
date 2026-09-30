import type { MonitoringResult } from "../src/lib/monitoring/report.ts";

export function shouldSendHeartbeat(overall: MonitoringResult["overall"], exitCode: string | number | undefined, heartbeatUrl: string | undefined): boolean {
  return overall !== "FAILED" && exitCode !== 1 && Boolean(heartbeatUrl);
}

export async function deliverMonitoringHeartbeat(
  heartbeatUrl: string,
  fetchHeartbeat: typeof fetch = fetch,
  logger: Pick<Console, "log" | "warn"> = console,
): Promise<void> {
  try {
    const response = await fetchHeartbeat(heartbeatUrl, { method: "GET", signal: AbortSignal.timeout(10000) });
    if (response.ok) logger.log("Monitoring heartbeat delivered.");
    else logger.warn("Monitoring heartbeat delivery failed.");
  } catch {
    logger.warn("Monitoring heartbeat delivery failed.");
  }
}

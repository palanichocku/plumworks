import "server-only";

import { lookup } from "node:dns/promises";
import { Socket } from "node:net";

/** Safe diagnostic metadata for this single SMS feature Preview branch only.
 * Never prints credentials, full URLs, username, or database name.
 */
export async function logSmsFeaturePreviewDatabaseDiagnostics() {
  if (process.env.VERCEL_ENV !== "preview" ||
      process.env.VERCEL_GIT_COMMIT_REF !== "feature/dev-sms-estimate-authorization") return;
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    console.error("[sms-preview-db] missing DATABASE_URL");
    return;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    console.error("[sms-preview-db] malformed DATABASE_URL");
    return;
  }

  const host = url.hostname;
  const port = Number(url.port || 5432);
  const expectedDevProject = "qchvjaqwanyimkidlqqu";
  const result = {
    hostMatchesSupabasePooler: /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/.test(host),
    isTransactionPooler: port === 6543,
    isSessionPooler: port === 5432,
    hasPassword: Boolean(url.password),
    usernameMatchesDevProject: url.username.endsWith("." + expectedDevProject),
    usernameMatchesProdProject: url.username.endsWith(".ouxlfjkklxlomnpoqrwy"),
    hasExplicitSslMode: url.searchParams.has("sslmode"),
    hasUnescapedWhitespace: /\s/.test(raw),
  };
  console.info("[sms-preview-db] configuration", JSON.stringify(result));

  if (!result.hostMatchesSupabasePooler || !Number.isInteger(port) || port < 1 || port > 65535) return;
  try {
    await lookup(host);
    console.info("[sms-preview-db] DNS resolved");
  } catch (error) {
    console.error("[sms-preview-db] DNS failed", error instanceof Error && "code" in error ? String(error.code) : "unknown");
    return;
  }

  await new Promise<void>((resolve) => {
    const socket = new Socket();
    let finished = false;
    const done = (status: string) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      console.info("[sms-preview-db] TCP", status);
      resolve();
    };
    socket.setTimeout(3000);
    socket.once("connect", () => done("connected"));
    socket.once("timeout", () => done("timeout"));
    socket.once("error", (err: NodeJS.ErrnoException) => done("error:" + (err.code || "unknown")));
    socket.connect(port, host);
  });
}

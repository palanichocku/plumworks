import { setTimeout as delay } from "node:timers/promises";
import type { Page } from "@playwright/test";

type LoginOutcome = "success" | "credentials" | "service" | "timeout";
type LoginPage = Pick<Page, "goto" | "locator" | "getByRole" | "url">;

export type LoginResult =
  | { pass: true; retried: boolean }
  | { pass: false; error: "Login credentials rejected" | "Authentication service unavailable after retry" | "Login navigation timed out after retry" };

type LoginOptions = { outcomeTimeoutMs?: number; retryDelayMs?: number; pollIntervalMs?: number };

async function waitForOutcome(page: LoginPage, timeoutMs: number, pollIntervalMs: number): Promise<LoginOutcome> {
  const deadline = performance.now() + timeoutMs;

  try {
    const dashboard = page.getByRole("heading", { name: "Dashboard" });
    const rejected = page.getByRole("alert").filter({ hasText: "Invalid email or password." });
    const unavailable = page.getByRole("alert").filter({ hasText: "Unable to sign in right now. Please try again." });
    do {
      if (new URL(page.url()).pathname === "/dashboard" && await dashboard.isVisible()) return "success";
      if (await rejected.isVisible()) return "credentials";
      if (await unavailable.isVisible()) return "service";
      if (performance.now() >= deadline) break;
      await delay(pollIntervalMs);
    } while (true);
  } catch {
    // Browser exceptions are intentionally reduced to a fixed timeout outcome.
  }
  return "timeout";
}

async function attemptLogin(page: LoginPage, email: string, password: string, timeoutMs: number, pollIntervalMs: number, prefillDelayMs = 0): Promise<LoginOutcome> {
  try {
    await page.goto("/login", { waitUntil: "domcontentloaded" });
    if (prefillDelayMs) await delay(prefillDelayMs);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
  } catch {
    // Navigation and interaction failures are evaluated through the same safe UI outcomes.
  }
  return waitForOutcome(page, timeoutMs, pollIntervalMs);
}

export async function loginWithRetry(page: LoginPage, email: string, password: string, options: LoginOptions = {}): Promise<LoginResult> {
  const timeoutMs = options.outcomeTimeoutMs ?? 30_000;
  const pollIntervalMs = options.pollIntervalMs ?? 200;
  const first = await attemptLogin(page, email, password, timeoutMs, pollIntervalMs);
  if (first === "success") return { pass: true, retried: false };
  if (first === "credentials") return { pass: false, error: "Login credentials rejected" };

  const second = await attemptLogin(page, email, password, timeoutMs, pollIntervalMs, options.retryDelayMs ?? 1_500);
  if (second === "success") return { pass: true, retried: true };
  if (second === "credentials") return { pass: false, error: "Login credentials rejected" };
  return { pass: false, error: second === "service" ? "Authentication service unavailable after retry" : "Login navigation timed out after retry" };
}

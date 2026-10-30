import { test, expect } from "@playwright/test";
import { loginWithRetry } from "./login";

const baseUrl = process.env.MONITOR_BASE_URL;
const email = process.env.MONITOR_USER_EMAIL;
const password = process.env.MONITOR_USER_PASSWORD;

if (!baseUrl) throw new Error("MONITOR_BASE_URL is required");
if (!email) throw new Error("MONITOR_USER_EMAIL is required");
if (!password) throw new Error("MONITOR_USER_PASSWORD is required");

test.use({
  baseURL: baseUrl,
  trace: "retain-on-failure",
  screenshot: "only-on-failure",
});

async function verifyAppPage(page: import("@playwright/test").Page, path: string, heading: RegExp) {
  const response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 30_000 });
  expect(response, `${path} returned no HTTP response`).not.toBeNull();
  expect(response!.status(), `${path} returned HTTP ${response!.status()}`).toBeLessThan(400);
  expect(new URL(page.url()).pathname, `${path} redirected back to login`).not.toBe("/login");
  await expect(page.getByRole("heading", { name: heading }).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole("navigation").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: /access denied|permission denied|unable to load shop access/i })).toHaveCount(0);
}

test("Car Doc critical user journey", async ({ page }) => {
  await test.step("Login", async () => {
    const result = await loginWithRetry(page, email, password, {
      outcomeTimeoutMs: 20_000,
      retryDelayMs: 1_000,
    });
    expect(result.pass, result.pass ? undefined : result.error).toBe(true);
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({ timeout: 15_000 });
  });

  await test.step("Dashboard", async () => {
    await verifyAppPage(page, "/dashboard", /^Dashboard$/i);
  });

  await test.step("Repair Orders", async () => {
    await verifyAppPage(page, "/repair-orders", /Repair Orders/i);
  });

  await test.step("Invoices", async () => {
    await verifyAppPage(page, "/invoices", /Invoices/i);
  });
});

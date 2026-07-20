import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  deliverDailySalesReportEmail,
  isDailySalesPdfEncodedSizeAllowed,
  MAX_DAILY_SALES_PDF_BASE64_BYTES,
  validateDailySalesEmailRequest,
} from "../src/lib/email/daily-sales-report-email.ts";
import { sendResendEmail } from "../src/lib/email/resend-core.ts";
import { canEmailDailySalesReport, dailySalesReportFilename, normalizeDailySalesReportOutput } from "../src/lib/daily-sales-report-model.ts";

const validRequest = { authenticated: true, hasMembership: true, role: "OWNER", recipient: " Owner@Example.com ", from: "2026-01-01", to: "2026-01-31" };

test("OWNER and ADMIN may email while STAFF and unauthenticated requests are rejected", () => {
  assert.equal(canEmailDailySalesReport("OWNER"), true);
  assert.equal(canEmailDailySalesReport("ADMIN"), true);
  assert.equal(canEmailDailySalesReport("STAFF"), false);
  assert.equal(validateDailySalesEmailRequest(validRequest).ok, true);
  assert.equal(validateDailySalesEmailRequest({ ...validRequest, role: "ADMIN" }).ok, true);
  assert.equal(validateDailySalesEmailRequest({ ...validRequest, role: "STAFF" }).ok, false);
  assert.equal(validateDailySalesEmailRequest({ ...validRequest, authenticated: false }).ok, false);
  assert.equal(validateDailySalesEmailRequest({ ...validRequest, hasMembership: false }).ok, false);
});

test("recipient and date range are validated server-side", () => {
  const valid = validateDailySalesEmailRequest(validRequest);
  assert.deepEqual(valid, { ok: true, recipient: "owner@example.com", from: "2026-01-01", to: "2026-01-31", output: "detail" });
  assert.equal(validateDailySalesEmailRequest({ ...validRequest, recipient: "bad" }).ok, false);
  assert.equal(validateDailySalesEmailRequest({ ...validRequest, from: "not-a-date" }).ok, false);
  assert.equal(validateDailySalesEmailRequest({ ...validRequest, from: "2026-02-01", to: "2026-01-31" }).ok, false);
});

test("filenames are deterministic for single-day and ranged reports", () => {
  assert.equal(dailySalesReportFilename("2026-07-20", "2026-07-20"), "daily-sales-report-2026-07-20.pdf");
  assert.equal(dailySalesReportFilename("2026-01-01", "2026-06-30"), "daily-sales-report-2026-01-01-to-2026-06-30.pdf");
  assert.equal(dailySalesReportFilename("2026-07-20", "2026-07-20", "summary"), "daily-sales-summary-2026-07-20.pdf");
  assert.equal(dailySalesReportFilename("2026-01-01", "2026-01-31", "summary"), "daily-sales-summary-2026-01-01-to-2026-01-31.pdf");
});

test("report output defaults invalid and missing values to detail", () => {
  assert.equal(normalizeDailySalesReportOutput(undefined), "detail");
  assert.equal(normalizeDailySalesReportOutput("garbage"), "detail");
  assert.equal(normalizeDailySalesReportOutput("summary"), "summary");
  assert.equal(normalizeDailySalesReportOutput("detail"), "detail");
});

test("delivery sends the rendered PDF as Base64 to the requested recipient", async () => {
  let sent;
  const report = { shop: { id: "shop-1", name: "Car Doc" }, from: "2026-01-01", to: "2026-01-31", generatedAt: new Date("2026-02-01T01:00:00Z") };
  const result = await deliverDailySalesReportEmail(report, "recipient@example.com", "detail", {
    renderPdf: async (received, output) => { assert.equal(received, report); assert.equal(output, "detail"); return Buffer.from("pdf bytes"); },
    sendEmail: async (message) => { sent = message; return { ok: true, id: "email-1" }; },
  });
  assert.deepEqual(result, { ok: true });
  assert.equal(sent.to, "recipient@example.com");
  assert.equal(sent.subject, "Car Doc Daily Sales Report — January 1, 2026 – January 31, 2026");
  assert.equal(sent.attachments[0].filename, "daily-sales-report-2026-01-01-to-2026-01-31.pdf");
  assert.equal(Buffer.from(sent.attachments[0].content, "base64").toString(), "pdf bytes");
});

test("PDF failures and the conservative 35 MB encoded-size guard stop delivery", async () => {
  const report = { shop: { id: "shop-1", name: "Car Doc" }, from: "2026-01-01", to: "2026-01-31", generatedAt: new Date() };
  let sends = 0;
  const failed = await deliverDailySalesReportEmail(report, "recipient@example.com", "detail", {
    renderPdf: async () => { throw new Error("render failed"); },
    sendEmail: async () => { sends += 1; return { ok: true, id: "never" }; },
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "pdf_render_failed");
  assert.equal(sends, 0);
  assert.equal(isDailySalesPdfEncodedSizeAllowed(MAX_DAILY_SALES_PDF_BASE64_BYTES), true);
  assert.equal(isDailySalesPdfEncodedSizeAllowed(MAX_DAILY_SALES_PDF_BASE64_BYTES + 1), false);
});

test("summary email uses its summary subject, body, filename, and PDF variant", async () => {
  let sent;
  const report = { shop: { id: "shop-1", name: "Car Doc" }, from: "2026-01-01", to: "2026-01-31", generatedAt: new Date("2026-02-01T01:00:00Z") };
  const result = await deliverDailySalesReportEmail(report, "recipient@example.com", "summary", {
    renderPdf: async (_report, output) => { assert.equal(output, "summary"); return Buffer.from("summary"); },
    sendEmail: async (message) => { sent = message; return { ok: true, id: "email-2" }; },
  });
  assert.equal(result.ok, true);
  assert.equal(sent.subject, "Car Doc Daily Sales Summary — January 1, 2026 – January 31, 2026");
  assert.equal(sent.text, "The Daily Sales Summary for January 1, 2026 – January 31, 2026 is attached.");
  assert.equal(sent.attachments[0].filename, "daily-sales-summary-2026-01-01-to-2026-01-31.pdf");
});

test("Resend direct-fetch integration handles configuration, request, and HTTP failures without real email", async () => {
  const missing = await sendResendEmail({ to: "a@example.com", subject: "s", text: "t" }, { apiKey: "", from: "" });
  assert.equal(missing.code, "missing_configuration");
  let request;
  const success = await sendResendEmail({ to: "a@example.com", subject: "Subject", text: "Text", attachments: [{ filename: "report.pdf", content: "cGRm" }] }, {
    apiKey: "test-key", from: "Reports <reports@example.com>",
    fetchImpl: async (url, options) => { request = { url, options }; return new Response(JSON.stringify({ id: "resend-id" }), { status: 200 }); },
  });
  assert.equal(success.ok, true);
  assert.equal(request.url, "https://api.resend.com/emails");
  const body = JSON.parse(request.options.body);
  assert.deepEqual(body.to, ["a@example.com"]);
  assert.equal(body.attachments[0].content, "cGRm");
  const rejected = await sendResendEmail({ to: "a@example.com", subject: "s", text: "t" }, {
    apiKey: "test-key", from: "reports@example.com", fetchImpl: async () => new Response("rate", { status: 429 }),
  });
  assert.equal(rejected.code, "rate_limited");
});

test("screen, print, totals, summary, and PDF display Internal and preserve the approved columns", async () => {
  const files = await Promise.all([
    "../src/app/(app)/reports/page.tsx", "../src/app/(app)/reports/print/page.tsx",
    "../src/lib/reports/daily-sales-report-pdf.tsx", "../src/lib/daily-sales-report-model.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  const combined = files.join("\n");
  assert.doesNotMatch(combined, /Other \/ Internal/);
  assert.match(combined, /["']Internal["']/);
  assert.match(files[2], /orientation="landscape"/);
  assert.match(files[2], /orientation="portrait"/);
  assert.match(files[2], /DAILY_SALES_COLUMNS\.map/);
  assert.match(files[2], /PdfTotalsRow/);
  assert.match(files[2], /No sales were found for this date range/);
  assert.doesNotMatch(files[2], /slice\(0,\s*100\)|LIMIT\s+100/i);
});

test("server action reloads tenant-scoped report data and accepts no browser totals or rows", async () => {
  const action = await readFile(new URL("../src/app/(app)/reports/actions.ts", import.meta.url), "utf8");
  assert.match(action, /getCurrentMembership\(\)/);
  assert.match(action, /getDailySalesReportModel\(\{ from, to \}\)/);
  assert.match(action, /report\.shop\.id !== membership\.shopId/);
  assert.doesNotMatch(action, /formData\.get\(["'](?:shopId|shopName|sales|payments|invoices|rows|pdf)/);
  assert.doesNotMatch(action, /prisma\.(?:create|update|upsert|delete)/);
});

test("email UI keeps recipient in component state and disables duplicate pending submissions", async () => {
  const ui = await readFile(new URL("../src/components/email-daily-sales-report.tsx", import.meta.url), "utf8");
  assert.match(ui, /useState\(""\)/);
  assert.match(ui, /type="email"/);
  assert.match(ui, /disabled=\{pending\}/);
  assert.match(ui, /role="dialog"/);
  assert.doesNotMatch(ui, /localStorage|sessionStorage|document\.cookie/);
});

test("report filter and email submission are sibling forms with intentional button types", async () => {
  const [ui, controls] = await Promise.all([
    readFile(new URL("../src/components/email-daily-sales-report.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/components/daily-sales-report-controls.tsx", import.meta.url), "utf8"),
  ]);
  const filterStart = controls.indexOf("<form action={runReport}");
  const filterEnd = controls.indexOf("</form>", filterStart);
  const emailControl = controls.indexOf("<EmailDailySalesReport", filterStart);
  assert.ok(filterStart >= 0 && filterEnd > filterStart);
  assert.ok(emailControl > filterEnd, "email control must be outside the report filter form");
  assert.equal((ui.match(/<form\b/g) ?? []).length, 1);
  assert.match(ui, /<button\s+type="button"[\s\S]*?Email Report/);
  assert.match(ui, /<button type="button"[^>]*[\s\S]*?>Cancel<\/button>/);
  assert.match(ui, /<button type="submit" disabled=\{pending\}/);
  assert.match(controls.slice(filterStart, filterEnd), /type="submit"[\s\S]*?Run Report/);
  assert.match(ui, /<input type="hidden" name="from" value=\{from\}/);
  assert.match(ui, /<input type="hidden" name="to" value=\{to\}/);
  assert.match(ui, /<input type="hidden" name="output" value=\{output\}/);
  assert.doesNotMatch(ui, /\.submit\(|requestSubmit\(|preventDefault|stopPropagation/);
  assert.match(controls, /Report View/);
  assert.doesNotMatch(controls, /Controls what is shown, printed, and emailed\./);
  assert.match(controls, /\["summary", "detail"\]/);
  assert.match(controls, /searchParams\.set\("from", loadedFrom\)/);
  assert.match(controls, /searchParams\.set\("to", loadedTo\)/);
  assert.match(controls, /&output=\$\{output\}/);
});

test("on-screen report view, pending feedback, dirty dates, and safe actions share one control state", async () => {
  const controls = await readFile(new URL("../src/components/daily-sales-report-controls.tsx", import.meta.url), "utf8");
  assert.match(controls, /output === "detail" \? detail : null/);
  assert.match(controls, /\{summary\}/);
  assert.match(controls, /useTransition\(\)/);
  assert.match(controls, /disabled=\{isPending\}/);
  assert.match(controls, /Running…/);
  assert.match(controls, /aria-busy=\{isPending\}/);
  assert.match(controls, /from !== loadedFrom \|\| to !== loadedTo/);
  assert.match(controls, /Dates changed — run the report before printing or emailing\./);
  assert.match(controls, /Report updated •/);
  assert.match(controls, /No invoices found/);
  assert.match(controls, /invoices included/);
  assert.match(controls, /role="status" aria-live="polite"/);
  assert.match(controls, /const actionsDisabled = dirty \|\| isPending/);
  assert.match(controls, /disabled=\{actionsDisabled\}/);
  assert.match(controls, /router\.push\(`\/reports\?from=/);
});

test("summary print and PDF omit the detail table while detail retains approved output", async () => {
  const [printable, pdf, css] = await Promise.all([
    readFile(new URL("../src/app/(app)/reports/print/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/reports/daily-sales-report-pdf.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/app/globals.css", import.meta.url), "utf8"),
  ]);
  assert.match(printable, /output === "summary" \? "Daily Sales Summary" : "Daily Sales Report"/);
  assert.match(printable, /output === "detail" \? \(/);
  assert.match(printable, /DAILY_SALES_COLUMNS\.map/);
  assert.match(pdf, /if \(output === "summary"\) return <DailySalesSummaryPdf/);
  assert.doesNotMatch(pdf.slice(pdf.indexOf("function DailySalesSummaryPdf"), pdf.indexOf("function PdfSummary")), /PdfTableHeader|PdfInvoiceRow|DAILY_SALES_COLUMNS/);
  assert.match(css, /@page daily-sales-portrait\s*\{[^}]*size:\s*portrait;/s);
  assert.match(css, /@page daily-sales-landscape\s*\{[^}]*size:\s*landscape;/s);
});

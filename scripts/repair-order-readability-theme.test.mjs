import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Repair Order descriptions use wrapping, resizable multiline controls", async () => {
  const [combobox, lines] = await Promise.all([
    read("src/components/historical-description-combobox.tsx"),
    read("src/components/repair-order-line-items.tsx"),
  ]);
  assert.match(combobox, /multiline \? <textarea/);
  assert.match(lines, /min-h-24 resize-y whitespace-pre-wrap break-words leading-6/);
  assert.ok((lines.match(/multiline/g) ?? []).length >= 3);
  assert.doesNotMatch(lines, /truncate|line-clamp/);
});

test("major Repair Order headings and workspace surfaces have stronger hierarchy", async () => {
  const [lines, detail, concerns, workspace, styles] = await Promise.all([
    read("src/components/repair-order-line-items.tsx"),
    read("src/app/(app)/repair-orders/[id]/page.tsx"),
    read("src/components/repair-order-concerns-form.tsx"),
    read("src/components/repair-order-workspace.tsx"),
    read("src/app/globals.css"),
  ]);
  for (const heading of ["Parts", "Labor", "Complimentary Services"]) {
    assert.match(lines, new RegExp(`ro-section-heading[^>]*>${heading}<`));
  }
  for (const heading of ["Customer", "Vehicle", "Customer Concerns &amp; Recommendations", "Repair Order Summary"]) assert.match(detail, new RegExp(`ro-section-heading[^>]*>${heading}<`));
  assert.match(concerns, /ro-section-heading[^>]*>Customer Concerns &amp; Recommendations</);
  assert.match(workspace, /ro-screen[^"\n]*border-slate-300[^"\n]*bg-slate-100/);
  assert.match(styles, /\.ro-screen \.ro-section-heading/);
  for (const label of ["Description", "Vendor", "Quantity", "Unit price", "Hours", "Rate", "Common Service", "Apply Shop Supplies"]) assert.doesNotMatch(lines, new RegExp(`ro-section-heading[^>]*>${label}<`));
  assert.equal((styles.match(/--ro-heading-bg:/g) ?? []).length, 3);
  assert.equal((styles.match(/--ro-heading-border:/g) ?? []).length, 3);
  assert.equal((styles.match(/--ro-heading-text:/g) ?? []).length, 3);
});

test("Parts and Labor use explicit full-width description and compact desktop control rows", async () => {
  const [lines, styles] = await Promise.all([
    read("src/components/repair-order-line-items.tsx"),
    read("src/app/globals.css"),
  ]);
  assert.ok(lines.indexOf('rowKey={line.id}') < lines.indexOf('className="ro-part-controls'));
  assert.ok(lines.indexOf('<LaborDescription') < lines.indexOf('className="ro-labor-controls'));
  assert.ok(lines.indexOf('className="ro-labor-controls') < lines.indexOf('<CommonServiceSelect'));
  assert.match(styles, /\.ro-part-controls\s*\{[\s\S]*grid-template-columns: minmax\(11rem, 1fr\) 5\.5rem 7rem minmax\(12rem, auto\)/);
  assert.match(styles, /\.ro-labor-controls\s*\{[\s\S]*grid-template-columns: 5\.5rem 7rem minmax\(10rem, 1fr\) minmax\(12rem, auto\)/);
});

test("Complimentary Services remains inside Labor after ordinary line items", async () => {
  const lines = await read("src/components/repair-order-line-items.tsx");
  const laborHeading = lines.indexOf(">Labor</h2>");
  const complimentaryHeading = lines.indexOf(">Complimentary Services</h3>");
  assert.ok(laborHeading >= 0 && complimentaryHeading > laborHeading);
  assert.equal((lines.match(/>Complimentary Services<\/h3>/g) ?? []).length, 1);
});

test("the three persisted themes have visibly distinct screen chrome palettes", async () => {
  const [styles, settings, shell] = await Promise.all([
    read("src/app/globals.css"),
    read("src/app/(app)/admin/app-settings/page.tsx"),
    read("src/components/app-shell.tsx"),
  ]);
  assert.match(settings, /localStorage\.setItem\('plumworks_theme', themeId\)/);
  assert.match(settings, /document\.documentElement\.setAttribute\('data-theme', themeId\)/);
  assert.match(styles, /\[data-theme='classic'\][\s\S]*--primary: #1B365D/);
  assert.match(styles, /\[data-theme='detroit'\][\s\S]*--primary: #9f1239/);
  assert.match(styles, /\[data-theme='emerald'\][\s\S]*--primary: #064e3b/);
  assert.match(shell, /app-shell-canvas/);
  assert.match(shell, /app-shell-sidebar/);
});

test("screen theme selectors remain isolated from document renderers", async () => {
  const styles = await read("src/app/globals.css");
  const documentSources = await Promise.all([
    read("src/components/repair-order-document-html.tsx"),
    read("src/components/invoice-document-html.tsx"),
  ]);
  assert.doesNotMatch(documentSources.join("\n"), /ro-screen|app-shell-(?:canvas|chrome|sidebar)/);
  assert.doesNotMatch(styles.match(/@media print[\s\S]*/)?.[0] ?? "", /--app-canvas|--app-chrome|ro-screen/);
});

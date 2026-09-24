// Opt-in Playwright regression against a disposable LOCAL app and database only.
// Pass an installed Playwright module path and optional base URL. The local app
// must mock Siteverify: synthetic-SOURCE => success, hostname 127.0.0.1, action SOURCE.
// No live Cloudflare/Resend calls. See docs/public-lead-protection.md.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import pg from 'pg';
const require = createRequire(import.meta.url);
const [playwrightPath, base = 'http://127.0.0.1:3119'] = process.argv.slice(2);
const url = process.env.PUBLIC_LEAD_TEST_DATABASE_URL;
assert(url && ['127.0.0.1', 'localhost'].includes(new URL(url).hostname));
assert.equal(new URL(url).pathname, '/cardoc_public_leads_test');
assert.equal(new URL(base).hostname, '127.0.0.1');
assert(playwrightPath, 'Pass the installed Playwright module path');
const { chromium } = require(playwrightPath);
const db = new pg.Client({ connectionString: url }); await db.connect();
assert.equal((await db.query('SELECT count(*)::int AS n FROM shops')).rows[0].n, 0, 'Test database must contain no shops');
const shopId = (await db.query("INSERT INTO shops(name, updated_at, marketing_lead_email_notifications_enabled) VALUES('Synthetic Test Shop', now(), false) RETURNING id")).rows[0].id;
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(15000);
  page.on('console', message => { if (message.type() === 'error') console.error('Browser console:', message.text()); });
  page.on('requestfailed', request => console.error('Request failed:', request.url(), request.failure()));
  page.on('pageerror', error => console.error('Browser:', error.message));
  const widgetSizes = [];
  await page.exposeFunction('recordWidgetSize', size => widgetSizes.push(size));
  await page.route('https://challenges.cloudflare.com/turnstile/**', route => route.fulfill({ contentType: 'application/javascript', body: `
    window.turnstile = {
      render(element, options) {
        window.recordWidgetSize(options.size);
        element.innerHTML = '<div aria-label="Verification test widget" style="width:'+(options.size === 'compact' ? 150 : 300)+'px;height:65px">Verification ready</div>';
        const token = document.createElement('input'); token.type='hidden'; token.name='cf-turnstile-response'; token.value='synthetic-'+options.action; element.append(token);
        setTimeout(() => options.callback(token.value), 20);
        return 'test-widget';
      }, remove() {}, reset() {}
    };
  ` }));
  const counts = async () => (await db.query('SELECT (SELECT count(*)::int FROM marketing_leads WHERE shop_id=$1) AS leads, (SELECT count(*)::int FROM marketing_lead_notifications WHERE shop_id=$1) AS notifications', [shopId])).rows[0];
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const path of ['/contact', '/appointment', '/drop-off']) {
      await page.goto(base + path);
      await page.getByRole('button', { name: /^Send .* Request$/ }).waitFor();
      await page.waitForFunction(() => !document.querySelector('form button[type="submit"], form button:not([type])')?.disabled).catch(async error => { console.log(await page.locator('main').innerText()); console.log('Widget sizes', widgetSizes, await page.evaluate(() => ({ scripts: Array.from(document.scripts, s => s.src).filter(Boolean), turnstile: typeof window.turnstile }))); await page.screenshot({ path: '/private/tmp/cardoc-form-debug.png', fullPage: true }); throw error; });
      assert.equal(await page.locator('textarea').count(), 0);
      assert.equal(await page.locator('select[name=requestedService] option').count(), 12);
      assert.equal(await page.locator('input[name=message]').count(), 0);
      assert.equal(await page.locator('input[name=website]').isVisible(), false);
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} overflows at ${width}`);
      for (const name of ['name', 'phone', 'email']) assert(await page.locator(`[name="${name}"]`).isVisible());
      if (path === '/appointment') {
        const link = page.getByRole('link', { name: /Plan a Vehicle Drop-Off/ });
        await link.click(); await page.waitForURL('**/drop-off');
        assert.match(await page.locator('main').innerText(), /Do not leave keys or a vehicle/);
      }
      if (path === '/drop-off' && width === 320) await page.screenshot({ path: '/private/tmp/cardoc-drop-off-mobile.png', fullPage: true });
    }
  }
  assert(widgetSizes.includes('compact')); assert(widgetSizes.includes('flexible'));
  const fill = async (path, index = 0) => {
    await page.goto(base + path);
    await page.getByLabel('Name *', { exact: true }).fill('Synthetic Browser Visitor');
    await page.getByLabel('Phone *', { exact: true }).fill(`202555011${index}`);
    await page.getByLabel('Email *', { exact: true }).fill(`browser${index}@example.test`);
    await page.getByLabel('Text', { exact: true }).check();
    await page.getByLabel('Requested service *', { exact: true }).selectOption('brakes');
    if (path !== '/contact') {
      await page.getByLabel('Vehicle year *').fill('2021');
      await page.getByLabel('Vehicle make *').fill('Example Motors');
      await page.getByLabel('Vehicle model *').fill('Model 3 - S.E.');
      await page.locator('[name=preferredDate]').fill('2026-10-01');
    }
  };
  for (const [i, path] of ['/contact', '/appointment', '/drop-off'].entries()) {
    await fill(path, i); await page.getByRole('button', { name: /^Send .* Request$/ }).click(); await page.waitForURL('**?sent=1');
    assert.deepEqual(await counts(), { leads: i + 1, notifications: i + 1 });
    if (path === '/drop-off') assert.match(await page.getByRole('status').innerText(), /approved drop-off instructions/);
  }
  // Equivalent duplicate still uses a fresh widget token and succeeds without effects.
  await fill('/contact'); await page.getByLabel('Email *', { exact: true }).fill('BROWSER0@EXAMPLE.TEST'); await page.getByLabel('Phone *', { exact: true }).fill('+1 (202) 555-0110');
  await page.getByRole('button', { name: /^Send .* Request$/ }).click(); await page.waitForURL('**?sent=1');
  assert.deepEqual(await counts(), { leads: 3, notifications: 3 });
  // Direct form injection exercises the actual Server Action, not just client validation.
  await fill('/contact', 3);
  await page.locator('form').evaluate(form => { const field = document.createElement('input'); field.name = 'message'; field.value = 'Injected message'; form.append(field); });
  await page.getByRole('button', { name: /^Send .* Request$/ }).click(); await page.waitForURL('**?error=1');
  assert.deepEqual(await counts(), { leads: 3, notifications: 3 });
  await fill('/contact', 3);
  await page.locator('[name=cf-turnstile-response]').evaluate(input => { input.value = 'invalid'; });
  await page.getByRole('button', { name: /^Send .* Request$/ }).click(); await page.waitForURL('**?error=verification');
  assert.match(await page.locator('form').getByRole('alert').innerText(), /verify your request/);
  // Failure remounts a fresh widget so a customer can retry.
  await page.waitForFunction(() => document.querySelector('[name="cf-turnstile-response"]')?.value === 'synthetic-CONTACT');
  assert.deepEqual(await counts(), { leads: 3, notifications: 3 });
  await fill('/contact', 3);
  await page.locator('[name=website]').evaluate(input => { input.value = 'bot.example'; });
  await page.getByRole('button', { name: /^Send .* Request$/ }).click(); await page.waitForURL('**?sent=1');
  assert.deepEqual(await counts(), { leads: 3, notifications: 3 });
  assert.equal((await db.query('SELECT count(*)::int AS n FROM marketing_leads WHERE shop_id=$1 AND message IS NOT NULL', [shopId])).rows[0].n, 0);
  console.log('PASS: 320/390/1280px layouts, dropdowns, drop-off link and safety, all three real actions, duplicates, injection, verification retry, honeypot, database effects');
} finally {
  await browser.close(); await db.query('DELETE FROM shops WHERE id=$1', [shopId]); await db.end();
}

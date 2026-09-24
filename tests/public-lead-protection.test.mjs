import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { leadLoader, testEnvironment, validForm, formSources } from './helpers/public-lead-loader.mjs';

const load = leadLoader({}, testEnvironment);
const { parsePublicLead } = load('@/lib/public-lead-validation');
const { requestedServices } = load('@/lib/marketing-requested-services');
const verification = load('@/lib/public-lead-verification');
const { publicLeadFingerprint } = load('@/lib/public-lead-admission');

for (const service of requestedServices) test(`allowlisted service: ${service.label}`, () => {
  for (const source of Object.keys(formSources)) assert.equal(parsePublicLead(source, validForm(source, { requestedService: service.value })).requestedService, service.label);
});
for (const overrides of [{ requestedService: 'Sell you marketing' }, { requestedService: '__proto__' }, { requestedService: '' }, { message: 'Injected' }, { notes: 'Injected' }, { concern: 'Injected' }, { symptoms: 'Injected' }, { name: 'a'.repeat(121) }, { name: 'line\nbreak' }, { email: 'invalid' }, { phone: '555-1234' }, { preferredContactMethod: 'SMS' }]) test(`reject public input ${JSON.stringify(overrides)}`, () => {
  for (const source of Object.keys(formSources)) assert.throws(() => parsePublicLead(source, validForm(source, overrides)));
});
for (const overrides of [{ vehicleYear: '20211' }, { vehicleYear: '1899' }, { vehicleYear: '2999' }, { vehicleYear: '2e03' }, { vehicleMake: '' }, { vehicleModel: 'a'.repeat(81) }, { preferredDate: '' }, { preferredDate: '2026-02-30' }, { preferredDate: 'invalid' }, { preferredDate: '2026-13-01' }]) test(`vehicle/date validation ${JSON.stringify(overrides)}`, () => {
  for (const source of ['APPOINTMENT', 'DROP_OFF']) assert.throws(() => parsePublicLead(source, validForm(source, overrides)));
});
test('files, duplicate fields, oversized bodies and invalid optional time rejected', () => {
  const form = validForm('CONTACT'); form.append('name', 'second'); assert.throws(() => parsePublicLead('CONTACT', form));
  form.set('name', new Blob(['file'])); assert.throws(() => parsePublicLead('CONTACT', form));
  form.set('name', 'x'.repeat(9000)); assert.throws(() => parsePublicLead('CONTACT', form));
  assert.throws(() => parsePublicLead('APPOINTMENT', validForm('APPOINTMENT', { preferredTime: '24:00' })));
});
test('signed 500ms completion check: missing, tampered, future, old and wrong form rejected', () => {
  const now = Date.now();
  const token = verification.createFormStarted('CONTACT', now - 500);
  assert.equal(verification.validFormStarted(token, 'CONTACT', now), true);
  for (const [value, source] of [['', 'CONTACT'], [token.replace('.CONTACT.', '.DROP_OFF.') + 'a', 'CONTACT'], [token, 'DROP_OFF'], [verification.createFormStarted('CONTACT', now - 499), 'CONTACT'], [verification.createFormStarted('CONTACT', now + 1000), 'CONTACT'], [verification.createFormStarted('CONTACT', now - 8 * 86400000), 'CONTACT']]) assert.equal(verification.validFormStarted(value, source, now), false);
});
for (const scenario of [
  { label: 'success', result: { success: true, hostname: 'shop.example.test', action: 'CONTACT' }, expected: true },
  { label: 'invalid', result: { success: false } },
  { label: 'expired/duplicate', result: { success: false, 'error-codes': ['timeout-or-duplicate'] } },
  { label: 'wrong hostname', result: { success: true, hostname: 'attacker.example', action: 'CONTACT' } },
  { label: 'wrong action', result: { success: true, hostname: 'shop.example.test', action: 'DROP_OFF' } },
  { label: 'missing', token: '' }, { label: 'too long', token: 'x'.repeat(2049) },
  { label: 'network failure', throws: true }, { label: 'HTTP failure', http: false }, { label: 'malformed JSON', malformed: true },
]) test(`Turnstile ${scenario.label}`, async () => {
  let requests = 0;
  const loaded = leadLoader({}, testEnvironment, { fetch: async (url, options) => {
    requests++; assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(JSON.parse(options.body).secret, testEnvironment.TURNSTILE_SECRET_KEY);
    assert.equal(options.cache, 'no-store'); assert.ok(options.signal);
    if (scenario.throws) throw Error('unavailable');
    return { ok: scenario.http ?? true, json: async () => { if (scenario.malformed) throw Error('json'); return scenario.result; } };
  } })('@/lib/public-lead-verification');
  assert.equal(await loaded.verifyLeadTurnstile(scenario.token ?? 'XXXX.DUMMY.TOKEN.XXXX', 'CONTACT'), scenario.expected ?? false);
  if (scenario.token !== undefined) assert.equal(requests, 0);
});
test('missing secrets fail closed and only Vercel IP header is trusted', async () => {
  const loaded = leadLoader({}, {})('@/lib/public-lead-verification');
  assert.equal(await loaded.verifyLeadTurnstile('token', 'CONTACT'), false);
  assert.equal(loaded.createFormStarted('CONTACT'), '');
  const vercel = leadLoader({}, { ...testEnvironment, VERCEL: '1' })('@/lib/public-lead-verification');
  assert.throws(() => vercel.publicLeadIp(new Headers({ 'x-forwarded-for': '192.0.2.1' })));
  assert.equal(vercel.publicLeadIp(new Headers({ 'x-vercel-forwarded-for': '192.0.2.1', 'cf-connecting-ip': 'spoofed' })), '192.0.2.1');
  assert.equal(vercel.publicLeadIp(new Headers({ 'x-vercel-forwarded-for': '2001:0db8:0:0:0:0:0:1' })), '[2001:db8::1]');
});

function memoryDb() {
  const state = { leads: [], notifications: [], admissions: [] }; let tail = Promise.resolve(); let now = new Date();
  const matches = (row, where) => Object.entries(where).every(([key, value]) => key === 'id' && value.in ? value.in.includes(row.id) : key === 'createdAt' ? (value.gt ? row[key] > value.gt : row[key] <= value.lte) : row[key] === value);
  return { state, advance: (ms) => { now = new Date(now.getTime() + ms); }, shop: { findMany: async () => [{ id: 'shop-a' }] },
    $transaction(callback) {
      const run = tail.then(async () => {
        const staged = structuredClone(state);
        const result = await callback({
          $queryRaw: async (strings) => strings.join('').includes('clock_timestamp') ? [{ now }] : [{ locked: 1 }],
          publicLeadSubmission: {
            findMany: async ({ where, take }) => staged.admissions.filter(r => matches(r, where)).sort((a, b) => a.createdAt - b.createdAt).slice(0, take),
            deleteMany: async ({ where }) => { staged.admissions = staged.admissions.filter(r => !matches(r, where)); },
            findFirst: async ({ where }) => staged.admissions.find(r => matches(r, where)),
            count: async ({ where }) => staged.admissions.filter(r => matches(r, where)).length,
            create: async ({ data }) => { staged.admissions.push({ id: `admission-${staged.admissions.length}`, ...data }); },
          },
          shop: { findUniqueOrThrow: async () => ({ marketingLeadInAppNotificationsEnabled: true }) },
          marketingLead: { create: async ({ data }) => { const lead = { id: `lead-${staged.leads.length}`, ...data }; staged.leads.push(lead); return lead; } },
          marketingLeadNotification: { create: async ({ data }) => { staged.notifications.push(data); } },
        });
        Object.assign(state, staged); return result;
      });
      tail = run.catch(() => {}); return run;
    },
  };
}
function harness({ turnstile = true, db = memoryDb() } = {}) {
  const emails = [];
  const loader = leadLoader({
    '@/lib/prisma': { prisma: db },
    '@/lib/marketing-lead-notifications': { notifyNewMarketingLead: async lead => emails.push(lead) },
    'next/navigation': { redirect: url => { throw Error(url); } },
    'next/headers': { cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() },
  }, testEnvironment, { fetch: async () => ({ ok: true, json: async () => ({ success: turnstile, hostname: 'shop.example.test', action: harness.source }) }) });
  const actions = loader('@/app/(marketing)/lead-actions');
  return { db, emails, async submit(source = 'CONTACT', overrides = {}) {
    harness.source = source;
    const [action] = formSources[source];
    try { await actions[action](validForm(source, overrides, loader)); } catch (e) { return e.message; }
  } };
}
for (const source of Object.keys(formSources)) test(`${source} legitimate action creates one lead, notification and email with null message`, async () => {
  const h = harness();
  assert.equal(await h.submit(source), `${formSources[source][1]}?sent=1`);
  assert.equal(h.db.state.leads.length, 1); assert.equal(h.db.state.notifications.length, 1); assert.equal(h.emails.length, 1);
  const lead = h.db.state.leads[0];
  assert.equal(lead.message, null); assert.equal(lead.email, 'visitor@example.test'); assert.equal(lead.phone, '2025550123');
  assert.equal(lead.requestedService, 'Brake Inspection / Service');
  if (source !== 'CONTACT') assert.equal(lead.preferredDate.toISOString(), '2026-10-01T00:00:00.000Z');
});
for (const scenario of [
  { label: 'honeypot', overrides: { website: 'https://bot.example' }, success: true },
  { label: 'missing token', overrides: { 'cf-turnstile-response': '' } },
  { label: 'failed token', turnstile: false }, { label: 'missing completion time', overrides: { formStarted: '' } },
  { label: 'message injection', overrides: { message: 'Never stored' } },
  { label: 'arbitrary service', overrides: { requestedService: 'Never stored' } },
]) test(`blocked ${scenario.label} has zero lead, email, notification or admission effects on all endpoints`, async () => {
  const h = harness(scenario);
  for (const source of Object.keys(formSources)) assert.match(await h.submit(source, scenario.overrides), scenario.success ? /sent=1$/ : /error=/);
  assert.deepEqual(h.db.state, { leads: [], notifications: [], admissions: [] }); assert.equal(h.emails.length, 0);
});
for (const variation of [{}, { email: 'VISITOR@EXAMPLE.TEST' }, { phone: '+1 202.555.0123' }]) test(`duplicate returns success once: ${JSON.stringify(variation)}`, async () => {
  const h = harness(); await h.submit(); assert.equal(await h.submit('CONTACT', variation), '/contact?sent=1');
  assert.equal(h.db.state.leads.length, 1); assert.equal(h.db.state.notifications.length, 1); assert.equal(h.emails.length, 1);
});
test('two simultaneous identical submissions create one lead and one set of effects', async () => {
  const h = harness(); assert.deepEqual(await Promise.all([h.submit(), h.submit()]), ['/contact?sent=1', '/contact?sent=1']);
  assert.equal(h.db.state.leads.length, 1); assert.equal(h.db.state.notifications.length, 1); assert.equal(h.emails.length, 1);
});
test('different form types never deduplicate each other', async () => {
  const h = harness(); for (const source of Object.keys(formSources)) await h.submit(source);
  assert.equal(h.db.state.leads.length, 3);
});
test('fingerprint normalizes whitespace and case; shop, dates and times distinguish requests', () => {
  const base = parsePublicLead('APPOINTMENT', validForm('APPOINTMENT'));
  const equivalent = parsePublicLead('APPOINTMENT', validForm('APPOINTMENT', { vehicleMake: ' example   MOTORS ', vehicleModel: ' model 3 - s.e. ', phone: '+1 202-555-0123', email: 'VISITOR@EXAMPLE.TEST' }));
  assert.equal(publicLeadFingerprint('a', base), publicLeadFingerprint('a', equivalent));
  assert.notEqual(publicLeadFingerprint('a', base), publicLeadFingerprint('b', base));
  for (const patch of [{ preferredTime: '11:00' }, { preferredDate: new Date('2026-10-02') }, { requestedService: 'Other / Not Sure' }]) assert.notEqual(publicLeadFingerprint('a', base), publicLeadFingerprint('a', { ...base, ...patch }));
});
for (const dimension of ['email', 'phone', 'ip']) test(`persistent rolling ${dimension} limit and expiry; rejection has no workflow effects`, async () => {
  const h = harness(); const limit = dimension === 'ip' ? 5 : 3;
  for (let i = 0; i <= limit; i++) {
    const overrides = { requestedService: requestedServices[i].value, ...(dimension !== 'email' ? { email: `visitor${i}@example.test` } : {}), ...(dimension !== 'phone' ? { phone: `202555010${i}` } : {}) };
    assert.match(await h.submit('CONTACT', overrides), i < limit ? /sent=1$/ : /error=1$/);
  }
  assert.equal(h.db.state.leads.length, limit); assert.equal(h.db.state.notifications.length, limit); assert.equal(h.emails.length, limit);
  h.db.advance((dimension === 'ip' ? 10 : 30) * 60000 + 1);
  assert.match(await h.submit('CONTACT', { requestedService: 'other' }), /sent=1$/);
});
test('duplicate window expires after 30 minutes and old hashes are pruned', async () => {
  const h = harness(); await h.submit(); h.db.advance(30 * 60000 + 1); await h.submit();
  assert.equal(h.db.state.leads.length, 2); assert.equal(h.db.state.admissions.length, 1);
  for (const key of ['ipHash', 'emailHash', 'phoneHash', 'fingerprint']) assert.match(h.db.state.admissions[0][key], /^[a-f0-9]{64}$/);
});

test('forms render canonical selects, no textareas; appointment offers drop-off; mobile uses a single base column', async () => {
  const jsx = (type, props) => ({ type, props });
  const ui = leadLoader({ 'react/jsx-runtime': { jsx, jsxs: jsx }, '@/app/(marketing)/lead-actions': {}, '@/components/marketing/lead-verification': { LeadVerification: 'verification' } }, testEnvironment);
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  for (const source of Object.keys(formSources)) {
    const tree = ui('@/components/marketing/lead-form').LeadForm({ source }); const rendered = nodes(tree);
    const service = rendered.find(n => n.props?.name === 'requestedService');
    assert.equal(service.type, 'select'); assert.equal(service.props.required, true);
    assert.deepEqual(nodes(service).filter(n => n.type === 'option').slice(1).map(n => n.props.value), requestedServices.map(s => s.value));
    assert.ok(!rendered.some(n => n.type === 'textarea' || n.props?.name === 'message'));
    assert.match(tree.props.className, /sm:grid-cols-2/); assert.doesNotMatch(tree.props.className, /(?:^| )grid-cols-2/);
    assert.equal(rendered.some(n => n.props?.name === 'preferredDate'), source !== 'CONTACT');
  }
  const page = await readFile(new URL('../src/app/(marketing)/appointment/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /href="\/drop-off"/); assert.match(page, /Plan a Vehicle Drop-Off/); assert.match(page, /approved instructions/);
});

test('bounded indexed retention deletes at most 100 expired rows and preserves active windows', async () => {
  const h = harness(); await h.submit();
  const active = structuredClone(h.db.state.admissions[0]);
  const old = new Date(Date.now() - 60 * 60000);
  for (let i = 0; i < 250; i++) h.db.state.admissions.push({ ...active, id: `expired-${i}`, createdAt: old });
  // A successful duplicate commits cleanup without adding a marker/lead.
  await h.submit();
  assert.equal(h.db.state.admissions.length, 151);
  assert.ok(h.db.state.admissions.some(r => r.id === active.id));
  await h.submit(); assert.equal(h.db.state.admissions.length, 51);
  await h.submit(); assert.equal(h.db.state.admissions.length, 1);
  assert.equal(h.db.state.leads.length, 1);
  assert.equal(h.emails.length, 1);
});

test('unverified repeated victim identifiers cannot reserve or exhaust their quota', async () => {
  const db = memoryDb(); const bot = harness({ turnstile: false, db });
  for (let i = 0; i < 12; i++) assert.match(await bot.submit('CONTACT'), /error=verification/);
  assert.equal(db.state.admissions.length, 0);
  const human = harness({ db });
  assert.equal(await human.submit('CONTACT'), '/contact?sent=1');
  assert.equal(db.state.leads.length, 1);
});

test('hostname allowlist never implicitly admits localhost, previews or suffix matches', async () => {
  for (const hostname of ['localhost', '127.0.0.1', 'preview.vercel.app', 'shop.example.test.attacker.test']) {
    const verify = leadLoader({}, testEnvironment, { fetch: async () => ({ ok: true, json: async () => ({ success: true, hostname, action: 'CONTACT' }) }) })('@/lib/public-lead-verification');
    assert.equal(await verify.verifyLeadTurnstile('XXXX.DUMMY.TOKEN.XXXX', 'CONTACT'), false);
  }
});

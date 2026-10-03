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
for (const field of ['vehicleMake', 'vehicleModel']) {
  for (const value of ['.', '-', '--', '...', '___', '!!!', '   ']) test(`reject punctuation-only ${field}: ${JSON.stringify(value)}`, () => {
    for (const source of Object.keys(formSources)) assert.throws(() => parsePublicLead(source, validForm(source, { [field]: value })));
  });
  for (const value of ['BMW', 'Ford', 'F-150', 'CX-5', '500', 'C-HR', 'FJ Cruiser', '4Runner', 'E-350', 'MX-5 Miata', '911', 'Model 3', 'トヨタ', '٣']) test(`accept vehicle ${field}: ${value}`, () => {
    for (const source of Object.keys(formSources)) assert.equal(parsePublicLead(source, validForm(source, { [field]: `  ${value}  ` }))[field], value);
  });
}
test('files, duplicate fields, oversized bodies and invalid optional time rejected', () => {
  const form = validForm('CONTACT'); form.append('name', 'second'); assert.throws(() => parsePublicLead('CONTACT', form));
  form.set('name', new Blob(['file'])); assert.throws(() => parsePublicLead('CONTACT', form));
  form.set('name', 'x'.repeat(9000)); assert.throws(() => parsePublicLead('CONTACT', form));
  assert.throws(() => parsePublicLead('APPOINTMENT', validForm('APPOINTMENT', { preferredTime: '24:00' })));
});
test('signed three-second completion check: threshold passes; missing, tampered, future, too-fast, old and wrong form rejected', () => {
  const now = Date.now();
  const token = verification.createFormStarted('CONTACT', now - 3000);
  assert.equal(verification.validFormStarted(token, 'CONTACT', now), true);
  for (const [value, source] of [['', 'CONTACT'], [token.replace('.CONTACT.', '.DROP_OFF.') + 'a', 'CONTACT'], [token, 'DROP_OFF'], [verification.createFormStarted('CONTACT', now - 2999), 'CONTACT'], [verification.createFormStarted('CONTACT', now + 1000), 'CONTACT'], [verification.createFormStarted('CONTACT', now - 8 * 86400000), 'CONTACT']]) assert.equal(verification.validFormStarted(value, source, now), false);
});
for (const scenario of [
  { label: 'success', result: { success: true, hostname: 'shop.example.test', action: 'CONTACT' }, expected: { valid: true, reason: 'none', requestCompleted: true, success: true, hostnameMatched: true, actionMatched: true } },
  { label: 'invalid', result: { success: false }, expected: { reason: 'verification_failed', requestCompleted: true } },
  { label: 'expired/duplicate', result: { success: false, 'error-codes': ['timeout-or-duplicate'] }, expected: { reason: 'verification_failed', requestCompleted: true } },
  { label: 'wrong hostname', result: { success: true, hostname: 'attacker.example', action: 'CONTACT' }, expected: { reason: 'hostname_mismatch', requestCompleted: true, success: true, hostnameMatched: false, actionMatched: true } },
  { label: 'wrong action', result: { success: true, hostname: 'shop.example.test', action: 'DROP_OFF' }, expected: { reason: 'action_mismatch', requestCompleted: true, success: true, hostnameMatched: true, actionMatched: false } },
  { label: 'missing', token: '', expected: { reason: 'missing_token' } }, { label: 'too long', token: 'x'.repeat(2049), expected: { reason: 'invalid_token' } },
  { label: 'malformed token', token: 'bad\ntoken', expected: { reason: 'invalid_token' } },
  { label: 'network failure', throws: true, expected: { reason: 'unavailable' } }, { label: 'timeout', timeout: true, expected: { reason: 'timeout' } },
  { label: 'HTTP failure', http: false, expected: { reason: 'http_error', requestCompleted: true } }, { label: 'malformed JSON', malformed: true, expected: { reason: 'invalid_response', requestCompleted: true } },
]) test(`Turnstile ${scenario.label}`, async () => {
  let requests = 0;
  const loaded = leadLoader({}, testEnvironment, { fetch: async (url, options) => {
    requests++; assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(JSON.parse(options.body).secret, testEnvironment.TURNSTILE_SECRET_KEY);
    assert.equal(options.cache, 'no-store'); assert.ok(options.signal);
    if (scenario.throws) throw Error('unavailable');
    if (scenario.timeout) throw new DOMException('timed out', 'TimeoutError');
    return { ok: scenario.http ?? true, json: async () => { if (scenario.malformed) throw Error('json'); return scenario.result; } };
  } })('@/lib/public-lead-verification');
  const result = await loaded.verifyLeadTurnstile(scenario.token ?? 'XXXX.DUMMY.TOKEN.XXXX', 'CONTACT');
  assert.deepEqual({ ...result, ...scenario.expected }, result);
  assert.equal(result.valid, scenario.expected?.valid ?? false);
  if (scenario.token !== undefined) assert.equal(requests, 0);
});
test('missing secrets fail closed and only Vercel IP header is trusted', async () => {
  const loaded = leadLoader({}, {})('@/lib/public-lead-verification');
  assert.equal((await loaded.verifyLeadTurnstile('token', 'CONTACT')).reason, 'missing_config');
  assert.equal(loaded.createFormStarted('CONTACT'), '');
  const vercel = leadLoader({}, { ...testEnvironment, VERCEL: '1' })('@/lib/public-lead-verification');
  assert.throws(() => vercel.publicLeadIp(new Headers({ 'x-forwarded-for': '192.0.2.1' })));
  assert.equal(vercel.publicLeadIp(new Headers({ 'x-vercel-forwarded-for': '192.0.2.1', 'cf-connecting-ip': 'spoofed' })), '192.0.2.1');
  assert.equal(vercel.publicLeadIp(new Headers({ 'x-vercel-forwarded-for': '2001:0db8:0:0:0:0:0:1' })), '[2001:db8::1]');
});
test('missing Turnstile hostname allowlist fails closed', async () => {
  const verify = leadLoader({}, { TURNSTILE_SECRET_KEY: testEnvironment.TURNSTILE_SECRET_KEY })('@/lib/public-lead-verification');
  assert.equal((await verify.verifyLeadTurnstile('token', 'CONTACT')).reason, 'missing_config');
});
test('blocked-domain configuration uses exact domains and descendants after whitespace/case normalization', () => {
  const { isBlockedLeadEmailDomain: blocked } = load('@/lib/public-lead-blocked-domains');
  const config = '  EXAMPLE-SPAMMER.test, , GeTdAnDyNoW.test  ';
  assert.equal(blocked('user@getdandynow.test', config), true);
  assert.equal(blocked('user@mail.getdandynow.test', config), true);
  assert.equal(blocked('user@notgetdandynow.test', config), false);
  assert.equal(blocked('user@example-spammer.test', config), true);
  for (const empty of [undefined, '', '  , , ']) assert.equal(blocked('user@getdandynow.test', empty), false);
});
test('blocked domains canonicalize trailing DNS dots on both sides without suffix overblocking', () => {
  const { isBlockedLeadEmailDomain: blocked } = load('@/lib/public-lead-blocked-domains');
  const blockedAddresses = [
    'user@getdandynow.com', 'user@getdandynow.com.', 'user@mail.getdandynow.com',
    'user@mail.getdandynow.com.', 'user@getdandynow.com..', 'user@MAIL.GETDANDYNOW.COM.',
  ];
  const allowedAddresses = [
    'user@notgetdandynow.com', 'user@getdandynow.com.example.com',
    'user@getdandynow.com.example.com.', 'user@dandynow.com',
  ];
  for (const config of ['getdandynow.com', 'GETDANDYNOW.COM', 'getdandynow.com.', ' getdandynow.com. ', ' , GETDANDYNOW.COM., getdandynow.com, , ']) {
    for (const email of blockedAddresses) assert.equal(blocked(email, config), true, `${email} with ${config}`);
    for (const email of allowedAddresses) assert.equal(blocked(email, config), false, `${email} with ${config}`);
  }
  assert.equal(blocked('user@getdandynow.com', ' , . , .. , '), false);
});

function memoryDb({ admissionFails = false, storageFails = false, notificationFails = false } = {}) {
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
            count: async ({ where }) => { if (admissionFails) throw Error('private admission detail'); return staged.admissions.filter(r => matches(r, where)).length; },
            create: async ({ data }) => { staged.admissions.push({ id: `admission-${staged.admissions.length}`, ...data }); },
          },
          shop: { findUniqueOrThrow: async () => ({ marketingLeadInAppNotificationsEnabled: true }) },
          marketingLead: { create: async ({ data }) => { if (storageFails) throw Error('private storage detail'); const lead = { id: `lead-${staged.leads.length}`, ...data }; staged.leads.push(lead); return lead; } },
          marketingLeadNotification: { create: async ({ data }) => { if (notificationFails) throw Error('private notification detail'); staged.notifications.push(data); } },
        });
        Object.assign(state, staged); return result;
      });
      tail = run.catch(() => {}); return run;
    },
  };
}
function harness({ turnstile = true, db = memoryDb(), environment = testEnvironment, attributionFails = false } = {}) {
  const emails = [];
  const logs = [];
  const loader = leadLoader({
    '@/lib/prisma': { prisma: db },
    '@/lib/marketing-lead-notifications': { notifyNewMarketingLead: async lead => emails.push(lead) },
    'next/navigation': { redirect: url => { throw Error(url); } },
    'next/headers': { cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() },
    ...(attributionFails ? { '@/lib/marketing-attribution': { marketingAttributionCookie: 'synthetic-cookie', leadAttributionData: () => { throw Error('private attribution detail'); } } } : {}),
  }, environment, { fetch: async () => ({ ok: true, json: async () => ({ success: turnstile, hostname: 'shop.example.test', action: harness.source }) }), console: { info: (...args) => logs.push(args), error() {} } });
  const actions = loader('@/app/(marketing)/lead-actions');
  return { db, emails, logs, async submit(source = 'CONTACT', overrides = {}) {
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
  assert.equal(lead.vehicleYear, 2021); assert.equal(lead.vehicleMake, 'Example Motors'); assert.equal(lead.vehicleModel, 'Model 3 - S.E.');
  if (source !== 'CONTACT') assert.equal(lead.preferredDate.toISOString(), '2026-10-01T00:00:00.000Z');
});
test('blocked exact and subdomain return ordinary success with zero effects and categorical logs', async () => {
  const h = harness({ environment: { ...testEnvironment, PUBLIC_LEAD_BLOCKED_EMAIL_DOMAINS: '  BLOCKED.test  ' } });
  for (const email of ['user@blocked.test', 'user@blocked.test.', 'user@mail.blocked.test', 'user@mail.blocked.test.', 'user@blocked.test..']) {
    assert.equal(await h.submit('CONTACT', { email }), '/contact?sent=1');
    assert.deepEqual(h.logs.at(-1)[1], {
      source: 'CONTACT', submissionPath: '/contact', outcome: 'rejected', stage: 'blocked_domain', reason: 'blocked_domain',
      turnstile: { valid: true, requestCompleted: true, success: true, hostnameMatched: true, actionMatched: true, reason: 'none' },
      formStartValid: true, honeypotTriggered: false, validationPassed: true, blockedDomainMatched: true, admission: null,
    });
  }
  assert.deepEqual(h.db.state, { leads: [], notifications: [], admissions: [] });
  assert.equal(h.emails.length, 0);
  assert.equal(await h.submit('CONTACT', { email: 'user@notblocked.test' }), '/contact?sent=1');
  assert.equal(h.db.state.leads.length, 1); assert.equal(h.emails.length, 1);
  assert.equal(h.logs.at(-1)[1].blockedDomainMatched, false);
});
test('unexpected failures report attribution, admission, or storage stage without private details', async () => {
  for (const [options, stage] of [
    [{ attributionFails: true }, 'attribution'],
    [{ db: memoryDb({ admissionFails: true }) }, 'admission'],
    [{ db: memoryDb({ storageFails: true }) }, 'storage'],
    [{ db: memoryDb({ notificationFails: true }) }, 'storage'],
  ]) {
    const h = harness(options);
    assert.equal(await h.submit(), '/contact?error=1');
    assert.equal(h.logs.length, 1);
    assert.equal(h.logs[0][0], 'public_lead_protection');
    assert.equal(h.logs[0][1].stage, stage);
    assert.equal(h.logs[0][1].outcome, 'rejected');
    assert.equal(h.logs[0][1].reason, 'unavailable');
    assert.deepEqual(h.db.state, { leads: [], notifications: [], admissions: [] });
    assert.equal(h.emails.length, 0);
    for (const sensitive of ['private attribution detail', 'private admission detail', 'private storage detail', 'private notification detail', 'visitor@example.test', '2025550123']) assert.equal(JSON.stringify(h.logs[0][1]).includes(sensitive), false);
  }
});
test('missing and empty domain configuration allow valid submissions', async () => {
  for (const value of [undefined, '', ' , ']) {
    const h = harness({ environment: { ...testEnvironment, PUBLIC_LEAD_BLOCKED_EMAIL_DOMAINS: value } });
    assert.equal(await h.submit(), '/contact?sent=1');
    assert.equal(h.db.state.leads.length, 1);
  }
});
test('structured event allowlists metadata and omits customer and request secrets', async () => {
  const h = harness();
  await h.submit('CONTACT', { name: 'Sensitive Synthetic Name', email: 'sensitive@example.test', phone: '2025550198', vehicleMake: 'Private Make', vehicleModel: 'Private Model', 'cf-turnstile-response': 'private-token' });
  assert.equal(h.logs.length, 1);
  assert.equal(h.logs[0][0], 'public_lead_protection');
  const payload = JSON.stringify(h.logs[0][1]);
  for (const secret of ['Sensitive Synthetic Name', 'sensitive@example.test', '2025550198', 'Private Make', 'Private Model', 'private-token', testEnvironment.TURNSTILE_SECRET_KEY, testEnvironment.LEAD_ABUSE_HASH_SECRET]) assert.equal(payload.includes(secret), false);
  assert.equal(h.logs[0][1].outcome, 'accepted');
});
test('structured logger discards extra sensitive properties even if supplied at runtime', () => {
  const logs = [];
  const log = leadLoader({}, testEnvironment, { console: { info: (...args) => logs.push(args) } })('@/lib/public-lead-observability').logLeadProtection;
  log({ source: 'CONTACT', submissionPath: '/contact', outcome: 'rejected', stage: 'validation', reason: 'invalid_input', turnstile: null, formStartValid: null, honeypotTriggered: false, validationPassed: false, blockedDomainMatched: null, admission: null, email: 'secret@example.test', token: 'private-token', headers: { authorization: 'secret-authorization' } });
  assert.equal(logs[0][0], 'public_lead_protection');
  for (const value of ['secret@example.test', 'private-token', 'secret-authorization']) assert.equal(JSON.stringify(logs[0][1]).includes(value), false);
});
for (const scenario of [
  { label: 'honeypot', overrides: { website: 'https://bot.example' }, success: true },
  { label: 'missing token', overrides: { 'cf-turnstile-response': '' } },
  { label: 'failed token', turnstile: false }, { label: 'missing completion time', overrides: { formStarted: '' } },
  { label: 'message injection', overrides: { message: 'Never stored' } },
  { label: 'arbitrary service', overrides: { requestedService: 'Never stored' } },
  { label: 'missing intent confirmation', overrides: { vehicleServiceIntent: undefined } },
  { label: 'falsified intent confirmation', overrides: { vehicleServiceIntent: 'no' } },
  { label: 'contact missing vehicle year', overrides: { vehicleYear: undefined } },
  { label: 'contact missing vehicle make', overrides: { vehicleMake: undefined } },
  { label: 'contact missing vehicle model', overrides: { vehicleModel: undefined } },
]) test(`blocked ${scenario.label} has zero lead, email, notification or admission effects on all endpoints`, async () => {
  const h = harness(scenario);
  for (const source of Object.keys(formSources)) assert.match(await h.submit(source, scenario.overrides), scenario.success ? /sent=1$/ : /error=/);
  assert.deepEqual(h.db.state, { leads: [], notifications: [], admissions: [] }); assert.equal(h.emails.length, 0);
});
test('submission below the signed three-second minimum creates no protected effects', async () => {
  const h = harness();
  const tooFast = load('@/lib/public-lead-verification').createFormStarted('CONTACT', Date.now() - 2999);
  assert.match(await h.submit('CONTACT', { formStarted: tooFast }), /error=verification/);
  assert.deepEqual(h.db.state, { leads: [], notifications: [], admissions: [] });
  assert.equal(h.emails.length, 0);
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
  assert.equal(h.logs.at(-1)[1].stage, 'admission');
  assert.equal(h.logs.at(-1)[1].admission, `${dimension}_threshold`);
  assert.equal(h.logs.at(-1)[1].reason, `${dimension}_threshold`);
  h.db.advance((dimension === 'ip' ? 10 : 30) * 60000 + 1);
  assert.match(await h.submit('CONTACT', { requestedService: 'other' }), /sent=1$/);
});
test('duplicate admission is classified without another lead', async () => {
  const h = harness(); await h.submit(); await h.submit();
  assert.equal(h.logs.at(-1)[1].outcome, 'duplicate');
  assert.equal(h.logs.at(-1)[1].admission, 'duplicate');
  assert.equal(h.db.state.leads.length, 1);
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
    for (const name of ['vehicleYear', 'vehicleMake', 'vehicleModel']) assert.equal(rendered.some(n => n.props?.name === name), true);
    const fields = [...new Set(rendered.filter(n => n.props?.name).map(n => n.props.name))];
    const contactOrder = ['name', 'phone', 'email', 'preferredContactMethod', 'requestedService', 'vehicleYear', 'vehicleMake', 'vehicleModel'];
    if (source === 'CONTACT') assert.deepEqual(fields.filter(name => contactOrder.includes(name)), contactOrder);
  }
  const page = await readFile(new URL('../src/app/(marketing)/appointment/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /href="\/drop-off"/); assert.match(page, /Plan a Vehicle Drop-Off/); assert.match(page, /approved instructions/);
});

for (const key of ['vehicleYear', 'vehicleMake', 'vehicleModel']) test(`Contact requires ${key}`, () => {
  assert.throws(() => parsePublicLead('CONTACT', validForm('CONTACT', { [key]: undefined })));
});
test('Contact accepts structured vehicle details and does not persist intent as business data', () => {
  const parsed = parsePublicLead('CONTACT', validForm('CONTACT'));
  assert.equal(parsed.vehicleYear, 2021); assert.equal(parsed.vehicleMake, 'Example Motors'); assert.equal(parsed.vehicleModel, 'Model 3 - S.E.');
  assert.equal(Object.hasOwn(parsed, 'vehicleServiceIntent'), false);
});
test('historical Contact lead without vehicle values still renders', async () => {
  const jsx = (type, props) => ({ type, props });
  const ui = leadLoader({
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': { default: 'link' },
    '@/generated/prisma/client': { MarketingLeadStatus: { NEW: 'NEW' } },
    '@/components/lead-management-form': { LeadManagementForm: 'management' },
    '@/lib/marketing-lead-context': { callClickMessage: 'call click' },
    '@/components/lead-read-control': { LeadReadControl: 'read-control' },
    '@/lib/marketing-lead-contact': { leadContactMethodLabels: { TEXT: 'Text' } },
  }, testEnvironment);
  const tree = ui('@/components/marketing-lead-card').MarketingLeadCard({ lead: {
    id: 'historical-contact', name: 'Synthetic Visitor', source: 'CONTACT', message: null, status: 'NEW',
    phone: '2025550123', email: 'visitor@example.test', preferredContactMethod: 'TEXT', vehicleYear: null,
    vehicleMake: null, vehicleModel: null, preferredDate: null, preferredTime: null, scheduledDate: null,
    scheduledTime: null, requestedService: 'Brake Inspection / Service', createdAt: new Date('2025-01-01T00:00:00Z'), internalNote: null,
  }, notification: null, canManage: false });
  assert.equal(tree.type, 'article');
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
    assert.equal((await verify.verifyLeadTurnstile('XXXX.DUMMY.TOKEN.XXXX', 'CONTACT')).valid, false);
  }
});

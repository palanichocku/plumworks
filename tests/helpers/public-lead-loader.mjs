import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
export function leadLoader(overrides = {}, environment = {}, extra = {}) {
  const cache = new Map();
  function load(path) {
    if (Object.hasOwn(overrides, path)) return overrides[path];
    if (path === 'server-only') return {};
    if (!path.startsWith('@/')) return require(path);
    if (cache.has(path)) return cache.get(path);
    const stem = new URL(`../../src/${path.slice(2)}`, import.meta.url);
    let source;
    try { source = readFileSync(`${stem.pathname}.ts`, 'utf8'); }
    catch { source = readFileSync(`${stem.pathname}.tsx`, 'utf8'); }
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } });
    const loaded = { exports: {} };
    new Function('require', 'module', 'exports', 'process', 'fetch', 'console', outputText)(load, loaded, loaded.exports, { env: environment }, extra.fetch ?? (() => { throw Error('Network forbidden in test'); }), { error() {}, info() {} });
    cache.set(path, loaded.exports);
    return loaded.exports;
  }
  return load;
}
export const testEnvironment = {
  LEAD_ABUSE_HASH_SECRET: 'synthetic-local-test-secret-32-characters-only',
  TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
  TURNSTILE_ALLOWED_HOSTNAMES: 'shop.example.test',
};
export const formSources = { CONTACT: ['submitContactLead', '/contact'], APPOINTMENT: ['submitAppointmentLead', '/appointment'], DROP_OFF: ['submitDropOffLead', '/drop-off'] };
export function validForm(source, overrides = {}, load = leadLoader({}, testEnvironment)) {
  const form = new FormData();
  const values = { name: 'Example Visitor', phone: '(202) 555-0123', email: ' Visitor@Example.test ', preferredContactMethod: 'TEXT', requestedService: 'brakes', website: '', formStarted: load('@/lib/public-lead-verification').createFormStarted(source, Date.now() - 1000), 'cf-turnstile-response': 'XXXX.DUMMY.TOKEN.XXXX',
    ...(source === 'CONTACT' ? {} : { vehicleYear: '2021', vehicleMake: 'Example Motors', vehicleModel: 'Model 3 - S.E.', preferredDate: '2026-10-01' }),
    ...(source === 'APPOINTMENT' ? { preferredTime: '10:30' } : {}), ...overrides };
  for (const [key, value] of Object.entries(values)) if (value !== undefined) form.set(key, value);
  return form;
}

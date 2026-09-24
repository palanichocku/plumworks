import assert from 'node:assert/strict';
import test from 'node:test';
import { leadLoader, testEnvironment } from './helpers/public-lead-loader.mjs';

// Focused component lifecycle test: retain the mounted widget while the form
// transitions idle -> pending -> idle (e.g. a recoverable transport failure).
// No browser, Cloudflare request or production key is used.
test('mounted widget invalidates submitted token and resets on completion; expiration offers retry', () => {
  const refs = [], states = [], dependencies = [], cleanups = [], effects = [];
  let refIndex = 0, stateIndex = 0, effectIndex = 0, pending = false, resets = 0, options;
  const listeners = new Map();
  const form = { addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: event => listeners.delete(event) };
  const element = { clientWidth: 240, closest: () => form };
  const previous = globalThis.window;
  globalThis.window = {
    setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, location: { reload() {} },
    turnstile: { render: (_, value) => { options = value; return 'widget'; }, reset: id => { assert.equal(id, 'widget'); resets++; }, remove() {} },
  };
  const jsx = (type, props) => ({ type, props });
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  let memoCallback;
  const load = leadLoader({
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/script': { default: 'script' }, 'react-dom': { useFormStatus: () => ({ pending }) },
    react: {
      useRef: initial => refs[refIndex++] ??= { current: initial },
      useState: initial => { const i = stateIndex++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
      useCallback: fn => memoCallback ??= fn,
      useEffect: (fn, deps) => { const i = effectIndex++; if (!dependencies[i] || deps.some((d, j) => d !== dependencies[i][j])) effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); dependencies[i] = deps; }); },
    },
  }, { ...testEnvironment, NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA' });
  // Preserve callback identity just as useCallback does, so widget lifecycle
  // does not rerun on every test render.
  let callback;
  const component = load('@/components/marketing/lead-verification');
  const render = () => {
    refIndex = 0; stateIndex = 0; effectIndex = 0;
    const result = component.LeadVerification({ source: 'CONTACT' });
    refs[0].current = element;
    for (const effect of effects.splice(0)) effect();
    callback = options.callback;
    return nodes(result);
  };
  try {
    render(); callback();
    assert.equal(render().find(n => n.type === 'button' && !n.props.type).props.disabled, false);
    listeners.get('submit')(); pending = true;
    assert.equal(render().find(n => n.type === 'button' && !n.props.type).props.disabled, true);
    pending = false;
    assert.equal(render().find(n => n.type === 'button' && !n.props.type).props.disabled, true);
    assert.equal(resets, 1);
    options.callback();
    assert.equal(render().find(n => n.type === 'button' && !n.props.type).props.disabled, false);
    options['expired-callback']();
    const expired = render();
    const retry = expired.find(n => n.props?.children === 'Try verification again');
    assert.ok(retry); retry.props.onClick(); assert.equal(resets, 2);
    const honeypot = expired.find(n => n.props?.name === 'website');
    assert.equal(honeypot.props.autoComplete, 'off'); assert.equal(honeypot.props.tabIndex, -1);
    assert.ok(expired.some(n => n.props?.['aria-hidden'] === 'true' && n.props.className === 'hidden'));
  } finally {
    for (const cleanup of cleanups) cleanup?.();
    if (previous === undefined) delete globalThis.window; else globalThis.window = previous;
  }
});

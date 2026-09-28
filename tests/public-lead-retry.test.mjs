import assert from 'node:assert/strict';
import test from 'node:test';
import { leadLoader, testEnvironment } from './helpers/public-lead-loader.mjs';

function setup(source = 'CONTACT') {
  const refs = [], states = [], callbacks = [], callbackDeps = [], cleanups = [], effects = [], effectDeps = [];
  let refIndex = 0, stateIndex = 0, callbackIndex = 0, effectIndex = 0;
  let options, executes = 0, resets = 0, submissions = 0;
  const listeners = new Map();
  const form = {
    addEventListener() { listeners.set('submit', arguments[1]); },
    removeEventListener() { listeners.delete('submit'); },
    querySelector: () => ({ value: `CONTACT.${Date.now() - 5000}.synthetic.unsigned` }),
    reportValidity: () => true,
    requestSubmit: () => { submissions++; listeners.get('submit')?.({ preventDefault() {}, stopImmediatePropagation() {} }); },
  };
  const element = { clientWidth: 320, closest: () => form };
  const previous = globalThis.window;
  globalThis.window = {
    setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, location: { reload() {} },
    turnstile: {
      render: (_element, value) => { options = value; return 'widget'; },
      execute: id => { assert.equal(id, 'widget'); executes++; },
      reset: id => { assert.equal(id, 'widget'); resets++; },
      remove() {},
    },
  };
  const jsx = (type, props) => ({ type, props });
  const load = leadLoader({
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/script': { default: 'script' },
    'react-dom': { useFormStatus: () => ({ pending: false }) },
    react: {
      useRef: initial => refs[refIndex++] ??= { current: initial },
      useState: initial => { const index = stateIndex++; if (!(index in states)) states[index] = initial; return [states[index], value => { states[index] = value; }]; },
      useCallback: (fn, deps) => {
        const index = callbackIndex++;
        if (!callbackDeps[index] || deps.some((dep, i) => dep !== callbackDeps[index][i])) {
          callbacks[index] = fn; callbackDeps[index] = deps;
        }
        return callbacks[index];
      },
      useEffect: (fn, deps) => {
        const index = effectIndex++;
        if (!effectDeps[index] || deps.some((dep, i) => dep !== effectDeps[index][i])) {
          effects.push(() => { cleanups[index]?.(); cleanups[index] = fn(); effectDeps[index] = deps; });
        }
      },
    },
  }, { ...testEnvironment, NEXT_PUBLIC_TURNSTILE_SITE_KEY: 'test-site-key' });
  const component = load('@/components/marketing/lead-verification').LeadVerification;
  const nodes = tree => !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)];
  const textContent = tree => typeof tree === 'string' ? tree : Array.isArray(tree) ? tree.map(textContent).join(' ') : tree && typeof tree === 'object' ? textContent(tree.props?.children) : '';
  const confirmationImmediatelyBeforeSubmit = tree => {
    if (Array.isArray(tree)) {
      const index = tree.findIndex(node => node?.type === 'label' && textContent(node).includes('I am contacting Car Doc about service for a vehicle.'));
      if (index >= 0 && tree[index + 1]?.props?.type === 'submit') return true;
      return tree.some(confirmationImmediatelyBeforeSubmit);
    }
    return tree && typeof tree === 'object' ? confirmationImmediatelyBeforeSubmit(tree.props?.children) : false;
  };
  const render = () => {
    refIndex = stateIndex = callbackIndex = effectIndex = 0;
    const tree = component({ source });
    refs[0].current = element;
    for (const effect of effects.splice(0)) effect();
    return nodes(tree);
  };
  const submit = () => listeners.get('submit')?.({ preventDefault() {}, stopImmediatePropagation() {} });
  return {
    render, submit, textContent, confirmationImmediatelyBeforeSubmit, get options() { return options; }, get executes() { return executes; }, get resets() { return resets; },
    get submissions() { return submissions; }, form,
    restore() { for (const cleanup of cleanups) cleanup?.(); if (previous === undefined) delete globalThis.window; else globalThis.window = previous; },
  };
}

test('Turnstile waits for Submit, executes once, and only then submits through the existing form action', () => {
  const h = setup();
  try {
    const initial = h.render();
    assert.equal(h.executes, 0, 'page load must not execute or consume a token');
    assert.equal(h.submissions, 0);
    assert.equal(h.options.execution, 'execute');
    assert.equal(h.options.appearance, 'interaction-only');
    assert.equal(h.options.action, 'CONTACT');
    h.submit();
    assert.equal(h.executes, 1, 'valid Submit initiates Turnstile');
    h.submit();
    assert.equal(h.executes, 1, 'rapid duplicate submit is ignored while verification is pending');
    h.options.callback('synthetic-fresh-token');
    assert.equal(h.submissions, 1, 'successful verification resubmits through the same server action');
    h.submit();
    assert.equal(h.executes, 1, 'submissions stay locked while the server action is pending');
    assert.equal(h.submissions, 1);
    assert.equal(initial.find(node => node.props?.name === 'website').props.tabIndex, -1);
    assert.equal(initial.find(node => node.props?.type === 'checkbox' && node.props?.name === 'vehicleServiceIntent').props.required, true);
    const renderedText = h.textContent(initial);
    assert.ok(renderedText.includes('I am contacting Car Doc about service for a vehicle.'));
    assert.ok(renderedText.includes('This form is for vehicle service requests only. Sales, marketing, and other solicitations will be discarded.'));
    assert.equal(h.confirmationImmediatelyBeforeSubmit(initial[0]), true);
  } finally { h.restore(); }
});

test('expired/failed Turnstile execution permits retry with a fresh execution', () => {
  const h = setup();
  try {
    h.render();
    h.submit();
    assert.equal(h.executes, 1);
    h.options['expired-callback']();
    const failed = h.render();
    const retry = failed.find(node => node.props?.children === 'Try verification again');
    assert.ok(retry, 'failed verification exposes a retry action');
    retry.props.onClick();
    assert.equal(h.executes, 2);
    assert.equal(h.resets, 2, 'both attempts start from a reset widget');
    h.options.callback('another-fresh-token');
    assert.equal(h.submissions, 1);
  } finally { h.restore(); }
});

for (const source of ['CONTACT', 'APPOINTMENT', 'DROP_OFF']) test(`${source} form renders the required vehicle-service intent confirmation`, () => {
  const h = setup(source);
  try {
    const rendered = h.render();
    const confirmation = rendered.find(node => node.props?.name === 'vehicleServiceIntent');
    assert.equal(confirmation?.props?.required, true);
    assert.equal(confirmation?.props?.value, 'yes');
  } finally { h.restore(); }
});

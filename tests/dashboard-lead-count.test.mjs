import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma } from '@prisma/client';
import { leadLoader } from './helpers/public-lead-loader.mjs';

const shopId = 'synthetic-shop-a';
const statuses = Object.fromEntries(['NEW', 'CONTACTED', 'SCHEDULED', 'CONVERTED', 'CLOSED'].map(status => [status, status]));
const jsx = (type, props) => ({ type, props });
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...nodes(tree.props?.children)];
}
// SQL three-valued logic: NOT(message = marker) cannot match a null message.
const and = values => values.includes(false) ? false : values.includes(null) ? null : true;
const or = values => values.includes(true) ? true : values.includes(null) ? null : false;
function matches(row, where) {
  return and(Object.entries(where).map(([key, value]) => {
    if (key === 'AND') return and((Array.isArray(value) ? value : [value]).map(w => matches(row, w)));
    if (key === 'OR') return or(value.map(w => matches(row, w)));
    if (key === 'NOT') return and((Array.isArray(value) ? value : [value]).map(w => { const match = matches(row, w); return match === null ? null : !match; }));
    if (value === null) return row[key] === null;
    if (value && typeof value === 'object' && 'not' in value) {
      const match = matches(row, { [key]: value.not }); return match === null ? null : !match;
    }
    if (row[key] === null) return null;
    return row[key] === value;
  }));
}
const fixture = (source = 'CONTACT', message = null, status = 'NEW', id = 'synthetic-lead') => ({ id, shopId, source, message, status, name: 'Synthetic visitor', notification: null });
async function render(records, canViewLeads = true, query = { status: 'NEW' }) {
  const queries = [];
  const select = where => records.filter(row => matches(row, where) === true);
  const prisma = {
    marketingLead: {
      count: async ({ where }) => { queries.push(where); return select(where).length; },
      findMany: async ({ where }) => { queries.push(where); return select(where); },
    },
    repairOrder: { count: async ({ where }) => where.openedAt ? 2 : 7 },
    customer: { count: async () => 11 }, vehicle: { count: async () => 13 },
    invoice: {
      aggregate: async () => ({ _count: { _all: 3 }, _sum: { total: new Prisma.Decimal(120) } }),
      findMany: async ({ where }) => [{ id: `synthetic-${where.status}-invoice` }],
    },
  };
  const load = leadLoader({
    '@/lib/prisma': { prisma },
    './membership': { getCurrentMembership: async () => ({ membership: { shopId, role: 'OWNER' } }) },
    '@/lib/permissions': { hasPermission: () => canViewLeads, requirePermission: async () => ({ user: { id: 'synthetic-user' }, membership: { shopId, role: 'OWNER' } }) },
    './customer-activity': { getCurrentMonthCustomerActivityForShop: async () => ({ returningCustomers: 4, newCustomerCount: 5, customersServiced: 9, returningCustomerRate: 44.4 }) },
    '@/lib/invoice-lifecycle': { OPEN_INVOICE_STATUS: 'open', CLOSED_INVOICE_STATUS: 'closed' },
    '@/generated/prisma/client': { MarketingLeadStatus: statuses },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/link': 'a',
    '@/components/page-heading': { PageHeading: 'heading' },
    '@/components/marketing-lead-card': { MarketingLeadCard: 'lead-card' },
  });
  const dashboard = await load('@/lib/data/dashboard').getDashboardSummary();
  const tree = await load('@/app/(app)/leads/page').default({ searchParams: Promise.resolve(query) });
  const rendered = nodes(tree);
  const badge = rendered.find(node => node.type === 'a' && node.props.href === '/leads?status=NEW' && Array.isArray(node.props.children));
  return { dashboard, leadCount: badge.props.children[0], leadIds: rendered.filter(node => node.type === 'lead-card').map(node => node.props.lead.id), queries };
}

for (const [label, record, expected] of [
  ['NEW structured Contact with null message', fixture(), 1],
  ['NEW historical Contact with non-null message', fixture('CONTACT', 'Synthetic historical concern'), 1],
  ['NEW Appointment', fixture('APPOINTMENT'), 1],
  ['NEW Drop-Off', fixture('DROP_OFF'), 1],
  ['Call Now tracking', fixture('CONTACT', 'Visitor clicked Call Now'), 0],
  ['Appointment with marker-like historical message', fixture('APPOINTMENT', 'Visitor clicked Call Now'), 1],
  ['Drop-Off with marker-like historical message', fixture('DROP_OFF', 'Visitor clicked Call Now'), 1],
  ...['CONTACTED', 'SCHEDULED', 'CONVERTED', 'CLOSED'].map(status => [`${status} lead`, fixture('CONTACT', null, status), 0]),
  ['different shop', { ...fixture(), shopId: 'synthetic-shop-b' }, 0],
]) {
  test(`${label}: Dashboard and NEW Leads agree`, async () => {
    const result = await render([record]);
    assert.equal(result.dashboard.newLeadCount, expected);
    assert.equal(result.leadCount, expected);
    assert.equal(result.leadIds.length, expected);
    assert.deepEqual(result.queries[0], result.queries[1]);
    assert.deepEqual(result.queries[0], result.queries[2]);
  });
}

test('mixed sources, historical messages, statuses and shops agree without changing other Dashboard metrics', async () => {
  const baseline = await render([]);
  const records = [fixture(), fixture('CONTACT', 'Historical concern', 'NEW', 'history'), fixture('APPOINTMENT', null, 'NEW', 'appointment'), fixture('DROP_OFF', null, 'NEW', 'drop-off'), fixture('CONTACT', null, 'CLOSED', 'closed'), { ...fixture(), shopId: 'synthetic-shop-b' }];
  const result = await render(records);
  assert.equal(result.dashboard.newLeadCount, 4);
  assert.equal(result.leadCount, 4);
  assert.deepEqual(result.leadIds, ['synthetic-lead', 'history', 'appointment', 'drop-off']);
  const before = { ...baseline.dashboard }, after = { ...result.dashboard };
  delete before.newLeadCount;
  delete after.newLeadCount;
  assert.deepEqual(after, before);
  assert.equal(after.openRepairOrders, 7);
  assert.equal(after.customers, 11);
  assert.equal(after.vehicles, 13);
  assert.equal(after.monthlyInvoiceCount, 3);
  assert.equal(after.monthlyInvoiceTotal.toString(), '120');
  assert.equal(after.businessOverview.agedOpenRepairOrders, 2);
});

test('Dashboard still hides its count from users without lead permission', async () => {
  const result = await render([fixture()], false);
  assert.equal(result.dashboard.newLeadCount, null);
  assert.equal(result.queries.length, 2);
});

for (const status of [...Object.keys(statuses), 'ALL']) {
  test(`call-click tracking is excluded from the ${status} operational list`, async () => {
    const record = fixture('CONTACT', 'Visitor clicked Call Now', status === 'ALL' ? 'NEW' : status);
    const result = await render([record], true, { status });
    assert.equal(result.dashboard.newLeadCount, 0);
    assert.equal(result.leadCount, 0);
    assert.deepEqual(result.leadIds, []);
  });
}

test('direct operational detail lookup excludes call-clicks while retaining null and historical messages', async () => {
  const id = '10000000-0000-4000-8000-000000000001';
  for (const message of [null, 'Synthetic historical concern', 'Visitor clicked Call Now']) {
    const record = fixture('CONTACT', message, 'NEW', id);
    const load = leadLoader({
      '@/lib/data/membership': { getCurrentMembership: async () => ({ user: { id: 'synthetic-user' }, membership: { shopId, role: 'OWNER' } }) },
      '@/lib/permissions': { hasPermission: () => true },
      '@/lib/prisma': { prisma: { marketingLead: { findFirst: async ({ where }) => matches(record, where) === true ? record : null } } },
    });
    const result = await load('@/lib/marketing-lead-notification-center').getOperationalLead(id);
    assert.equal(result.lead, message === 'Visitor clicked Call Now' ? null : record);
    const list = await render([record], true, { lead: id });
    assert.equal(list.leadIds.length, message === 'Visitor clicked Call Now' ? 0 : 1);
  }
});

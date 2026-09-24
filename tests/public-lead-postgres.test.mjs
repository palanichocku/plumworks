// Opt-in real Postgres regression. Must use a disposable loopback database named
// cardoc_public_leads_test, prepared with prisma db push. No production URLs.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { leadLoader, testEnvironment, validForm } from './helpers/public-lead-loader.mjs';

const url = process.env.PUBLIC_LEAD_TEST_DATABASE_URL;
test('real Postgres: migration, concurrent deduplication, rolling limits, atomic rollback and historical preservation', { skip: !url }, async () => {
  const target = new URL(url);
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname));
  assert.equal(target.pathname, '/cardoc_public_leads_test');
  const db = new pg.Client({ connectionString: url }); await db.connect();
  // Deliberately use a non-UTC session to catch raw timestamp offset loss.
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: "-c timezone=America/Detroit" }) });
  const prisma2 = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, options: "-c timezone=America/Detroit" }) });
  const shops = [];
  const emails = [];
  try {
    // Rehearse the exact additive migration; this table is synthetic test state only.
    await db.query('DROP TABLE IF EXISTS public_lead_submissions');
    await db.query("DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$");
    await db.query(await readFile(new URL('../prisma/migrations/20260924120000_public_lead_protection/migration.sql', import.meta.url), 'utf8'));
    const security = (await db.query("SELECT relrowsecurity FROM pg_class WHERE oid='public_lead_submissions'::regclass")).rows[0];
    assert.equal(security.relrowsecurity, true);
    for (const role of ['anon', 'authenticated']) assert.equal((await db.query("SELECT has_table_privilege($1, 'public_lead_submissions', 'SELECT,INSERT,UPDATE,DELETE') AS allowed", [role])).rows[0].allowed, false);
    const newShop = async () => { const s = await prisma.shop.create({ data: { name: 'Synthetic protection test shop' } }); shops.push(s.id); return s.id; };
    const create = (client, shopId, source = 'CONTACT', changes = {}, ip = '192.0.2.1') => {
      const load = leadLoader({ '@/lib/prisma': { prisma: client }, '@/lib/marketing-lead-notifications': { notifyNewMarketingLead: async lead => emails.push(lead.id) } }, testEnvironment);
      const data = load('@/lib/public-lead-validation').parsePublicLead(source, validForm(source, changes, load));
      const admit = load('@/lib/public-lead-admission').publicLeadAdmission(shopId, data, ip);
      return load('@/lib/marketing-lead-submission').storeMarketingLead({ ...data, shopId }, admit);
    };
    const shop = await newShop();
    const historic = await prisma.marketingLead.create({ data: { shopId: shop, source: 'DROP_OFF', name: 'Synthetic historical visitor', requestedService: 'Old symptom text', message: 'Historical message remains intact' } });
    const before = await prisma.marketingLead.findUnique({ where: { id: historic.id } });
    const results = await Promise.all([create(prisma, shop), create(prisma2, shop, 'CONTACT', { email: 'VISITOR@EXAMPLE.TEST', phone: '+1 202.555.0123' })]);
    assert.equal(results.filter(Boolean).length, 1);
    assert.equal(await prisma.marketingLead.count({ where: { shopId: shop } }), 2);
    assert.equal(await prisma.marketingLeadNotification.count({ where: { shopId: shop } }), 1);
    assert.equal(await prisma.publicLeadSubmission.count({ where: { shopId: shop } }), 1);
    assert.equal(emails.length, 1);
    await create(prisma, shop, 'APPOINTMENT'); await create(prisma2, shop, 'DROP_OFF');
    assert.equal(await prisma.marketingLeadNotification.count({ where: { shopId: shop } }), 3);
    await assert.rejects(create(prisma, shop, 'CONTACT', { requestedService: 'engine' }));
    assert.equal(await prisma.marketingLeadNotification.count({ where: { shopId: shop } }), 3);
    assert.equal(emails.length, 3);
    assert.deepEqual(await prisma.marketingLead.findUnique({ where: { id: historic.id } }), before);
    // A backlog is drained in bounded batches without removing any active
    // rate-limit/dedup marker, including when cleanup accompanies a duplicate.
    const activeMarkers = await prisma.publicLeadSubmission.findMany({ where: { shopId: shop } });
    assert.ok(activeMarkers.every(row => Math.abs(Date.now() - row.createdAt.getTime()) < 30_000), "successful marker timestamps must represent current UTC time");
    const { fingerprint, ipHash, emailHash, phoneHash } = activeMarkers[0];
    await prisma.publicLeadSubmission.createMany({ data: Array.from({ length: 250 }, () => ({ shopId: shop, fingerprint, ipHash, emailHash, phoneHash, createdAt: new Date(Date.now() - 60 * 60000) })) });
    for (const remaining of [150, 50, 0]) {
      assert.equal(await create(prisma2, shop), null);
      assert.equal(await prisma.publicLeadSubmission.count({ where: { shopId: shop } }), activeMarkers.length + remaining);
      assert.equal(await prisma.publicLeadSubmission.count({ where: { id: { in: activeMarkers.map(row => row.id) } } }), activeMarkers.length);
    }
    assert.equal(emails.length, 3);
    const rollbackShop = await newShop();
    // Failure after admission must roll back both ledger reservation and lead.
    const load = leadLoader({ '@/lib/prisma': { prisma } }, testEnvironment);
    const data = load('@/lib/public-lead-validation').parsePublicLead('CONTACT', validForm('CONTACT'));
    await assert.rejects(prisma.$transaction(async tx => {
      assert.equal(await load('@/lib/public-lead-admission').publicLeadAdmission(rollbackShop, data, '192.0.2.3')(tx), true);
      await tx.marketingLead.create({ data: { ...data, shopId: rollbackShop } });
      throw Error('Synthetic notification write failure');
    }));
    assert.equal(await prisma.publicLeadSubmission.count({ where: { shopId: rollbackShop } }), 0);
    assert.equal(await prisma.marketingLead.count({ where: { shopId: rollbackShop } }), 0);
    for (const kind of ['ip', 'email', 'phone']) {
      const shopId = await newShop(); const limit = kind === 'ip' ? 5 : 3;
      const changes = i => ({ requestedService: i % 2 ? 'engine' : 'other', email: kind === 'email' ? ' SAME@example.test ' : `visitor${i}@example.test`, phone: kind === 'phone' ? '+1 (202) 555-0199' : `202555010${i}` });
      // Distinct DB connections race for the final available slot.
      for (let i = 0; i < limit - 1; i++) await create(prisma, shopId, 'CONTACT', changes(i), kind === 'ip' ? '192.0.2.1' : `192.0.2.${i + 1}`);
      const raced = await Promise.allSettled([create(prisma, shopId, 'CONTACT', changes(limit - 1), '192.0.2.1'), create(prisma2, shopId, 'CONTACT', changes(limit), kind === 'ip' ? '192.0.2.1' : '192.0.2.2')]);
      assert.equal(raced.filter(r => r.status === 'fulfilled').length, 1);
      assert.equal(await prisma.marketingLead.count({ where: { shopId } }), limit);
      assert.equal(await prisma.marketingLeadNotification.count({ where: { shopId } }), limit);
    }
    console.log('PASS real independent-connection races, all rate limits, bounded retention, rollback, RLS and historical data');
  } finally {
    for (const id of shops) await prisma.shop.delete({ where: { id } });
    await Promise.all([prisma.$disconnect(), prisma2.$disconnect(), db.end()]);
  }
});

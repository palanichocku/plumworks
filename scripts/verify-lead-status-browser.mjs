// Opt-in real browser regression. Run ONLY against an isolated, migrated local app.
// Args: existing Playwright module path, synthetic test-users JSON, optional local base URL.
// DATABASE_URL must be loopback. Email must be intercepted by the local rehearsal launcher.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { Client } from 'pg';
const require=createRequire(import.meta.url);
const [playwrightPath,usersPath,base='http://127.0.0.1:3107']=process.argv.slice(2);
const local=url=>['127.0.0.1','localhost','[::1]'].includes(new URL(url).hostname);
assert(local(base)&&local(process.env.DATABASE_URL),'Local isolated app/database required');
assert(playwrightPath&&usersPath,'Provide existing Playwright module and synthetic credentials paths');
const {chromium}=require(playwrightPath),users=JSON.parse(await readFile(usersPath,'utf8'));
const db=new Client({connectionString:process.env.DATABASE_URL});await db.connect();
const browser=await chromium.launch({headless:true,channel:'chrome'});
try {
  const shop=(await db.query('SELECT shop_id FROM shop_memberships WHERE user_id=$1',[users.STAFF.id])).rows[0].shop_id;
  const items=[];
  for(const source of ['list','detail']){
    const row=(await db.query("INSERT INTO marketing_leads(shop_id,source,name,status,preferred_contact_method,message) VALUES($1,'CONTACT',$2,'NEW','TEXT','Synthetic local status verification') RETURNING id",[shop,`LOCAL STATUS ${source} ${Date.now()}`])).rows[0];
    const notification=(await db.query('INSERT INTO marketing_lead_notifications(shop_id,marketing_lead_id) VALUES($1,$2) RETURNING id',[shop,row.id])).rows[0];items.push({...row,notificationId:notification.id,source});
  }
  const page=await browser.newPage({viewport:{width:1440,height:1100}});page.setDefaultTimeout(15000);
  await page.goto(base+'/login');await page.getByLabel('Email',{exact:true}).fill(users.STAFF.email);await page.getByLabel('Password',{exact:true}).fill(users.STAFF.password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await page.waitForURL('**/dashboard');
  const dashboardCount=async()=>{await page.goto(base+'/dashboard');return Number((await page.locator('a[href="/leads?status=NEW"]').innerText()).match(/\d+/)[0])};
  const before=await dashboardCount();const posts=[];page.on('request',r=>{if(r.method()==='POST'&&r.postData()?.includes('CLOSED'))posts.push({serverAction:Boolean(r.headers()['next-action'])})});
  const status=async id=>(await db.query('SELECT status,preferred_contact_method FROM marketing_leads WHERE id=$1',[id])).rows[0];
  for(const item of items){
    await page.goto(base+(item.source==='list'?'/leads':'/leads/'+item.id));await page.getByRole('button',{name:/^Lead notifications,/}).waitFor();const card=page.locator('#lead-'+item.id);
    // Wait for hydration through a real UI event before testing the action.
    await card.locator('[name=status]').selectOption('CLOSED');
    await card.getByRole('button',{name:'Save lead',exact:true}).click();
    await page.getByText('Lead saved.',{exact:true}).first().waitFor();
    assert.equal((await status(item.id)).status,'CLOSED');
    await page.goto(base+'/leads/'+item.id);await page.reload();await page.locator('#lead-'+item.id).waitFor();assert.equal(await page.locator('[name=status]').inputValue(),'CLOSED');
    await page.goto(base+'/leads?status=CLOSED');await page.locator('#lead-'+item.id).waitFor();await page.goto(base+'/leads?status=NEW');assert.equal(await page.locator('#lead-'+item.id).count(),0);
    console.log('PASS '+item.source+' NEW → CLOSED, reload and filters');
  }
  assert.equal(await dashboardCount(),before-2);console.log('PASS Dashboard NEW count decreased by two');
  const item=items[1];await page.goto(base+'/leads/'+item.id);const card=page.locator('#lead-'+item.id);
  for(const next of ['NEW','CONTACTED','CLOSED']){await card.locator('[name=status]').selectOption(next);await card.getByRole('button',{name:'Save lead',exact:true}).click();await card.getByRole('status').filter({hasText:'Lead saved.'}).waitFor();await page.waitForFunction(()=>document.querySelector('[aria-busy="true"]')===null);assert.equal((await status(item.id)).status,next);await page.reload();await card.waitFor()}
  await card.locator('[name=status]').selectOption('SCHEDULED');await card.getByRole('button',{name:'Save lead',exact:true}).click();await card.getByRole('status').filter({hasText:'Could not save'}).waitFor();assert.equal((await status(item.id)).status,'CLOSED');console.log('PASS missing schedule rejected with feedback');
  // Hold the real action POST pending; rapid submits must not issue another write.
  let release;const gate=new Promise(resolve=>{release=resolve});let held=0;
  const route='**/leads/'+item.id;
  await page.route(route,async r=>{if(r.request().method()==='POST'&&r.request().postData()?.includes('CONTACTED')){held++;await gate}await r.continue()});
  await card.locator('[name=status]').selectOption('CONTACTED');await card.getByRole('button',{name:'Save lead',exact:true}).click();await card.getByRole('button',{name:'Saving…',exact:true}).waitFor();assert.equal(await card.getByRole('button',{name:'Saving…',exact:true}).isEnabled(),false);
  await card.locator('form').evaluate(f=>f.requestSubmit());assert.equal(held,1);release();await card.getByRole('status').filter({hasText:'Lead saved.'}).waitFor();await page.unroute(route);assert.equal((await status(item.id)).status,'CONTACTED');
  // Exercise actual browser transport failure locally; never induce production failure.
  await page.route(route,r=>r.request().method()==='POST'?r.fulfill({status:500,body:'Local synthetic transport failure'}):r.continue());await card.locator('[name=status]').selectOption('CLOSED');await card.getByRole('button',{name:'Save lead',exact:true}).click();await card.getByRole('status').filter({hasText:'Could not save'}).waitFor();assert.equal((await status(item.id)).status,'CONTACTED');await page.unroute(route);
  assert.equal((await status(item.id)).preferred_contact_method,'TEXT');assert.equal((await db.query('SELECT count(*)::int AS n FROM marketing_lead_notification_reads WHERE notification_id=ANY($1::uuid[])',[items.map(i=>i.notificationId)])).rows[0].n,0);
  assert(posts.some(p=>p.serverAction));console.log('PASS real Server Action transport, duplicate guard, failure feedback, unchanged preferences/reads');
} finally {await browser.close();await db.end()}

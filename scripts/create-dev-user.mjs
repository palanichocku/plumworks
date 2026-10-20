import { createClient } from '@supabase/supabase-js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const DEV_PROJECT_REF = 'qchvjaqwanyimkidlqqu';
const ALLOWED_ROLES = new Set(['OWNER', 'ADMIN', 'STAFF']);

function fail(message) {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

function getArg(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  if (index >= 0) return process.argv[index + 1];
  return undefined;
}

function getProjectRef(url) {
  try {
    return new URL(url).hostname.split('.')[0] || null;
  } catch {
    return null;
  }
}

async function promptHidden(promptText) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail('Password entry requires an interactive terminal.');
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const wasRaw = Boolean(stdin.isRaw);
    let value = '';

    stdout.write(promptText);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    const cleanup = () => {
      stdin.setRawMode(wasRaw);
      stdin.pause();
      stdin.removeListener('data', onData);
    };

    const onData = (char) => {
      if (char === '\u0003') {
        cleanup();
        stdout.write('\n');
        reject(new Error('Cancelled'));
        return;
      }
      if (char === '\r' || char === '\n') {
        cleanup();
        stdout.write('\n');
        resolve(value);
        return;
      }
      if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1);
        return;
      }
      if (char >= ' ') value += char;
    };

    stdin.on('data', onData);
  });
}

async function findAuthUser(supabase, email) {
  let page = 1;
  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`Unable to list Auth users: ${error.message}`);
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 1000) return null;
    page += 1;
  }
}

async function main() {
  const email = (getArg('email') || '').trim().toLowerCase();
  const role = (getArg('role') || 'OWNER').trim().toUpperCase();

  if (!email || !email.includes('@')) fail('Provide a valid --email address.');
  if (!ALLOWED_ROLES.has(role)) fail('Use --role OWNER, ADMIN, or STAFF.');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = process.env.DATABASE_URL;

  if (!supabaseUrl) fail('NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is missing.');
  if (!serviceRoleKey) fail('SUPABASE_SERVICE_ROLE_KEY is missing.');
  if (!databaseUrl) fail('DATABASE_URL is missing.');

  const projectRef = getProjectRef(supabaseUrl);
  if (projectRef !== DEV_PROJECT_REF) {
    fail(`DEV safety check failed. Expected ${DEV_PROJECT_REF}, but environment points to ${projectRef || 'unknown project'}.`);
  }

  console.log('\nTarget: DEV');
  console.log(`Supabase project: ${projectRef}`);
  console.log(`User: ${email}`);
  console.log(`Role: ${role}`);

  const password = await promptHidden('Initial password: ');
  const confirmPassword = await promptHidden('Confirm password: ');
  if (password !== confirmPassword) fail('Passwords do not match.');
  if (password.length < 8) fail('Password must be at least 8 characters.');

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const existing = await findAuthUser(supabase, email);
  if (existing) fail(`An Auth user already exists for ${email} in DEV. Use password:dev if you only need to reset it.`);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  let createdUserId = null;
  try {
    const shops = await prisma.shop.findMany({
      orderBy: { createdAt: 'asc' },
      take: 2,
      select: { id: true, name: true },
    });
    if (shops.length !== 1) fail(`Expected exactly one DEV shop, found ${shops.length}.`);

    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) fail(`Auth user creation failed: ${error?.message || 'unknown error'}`);
    createdUserId = data.user.id;

    await prisma.shopMembership.create({
      data: {
        shopId: shops[0].id,
        userId: createdUserId,
        userEmail: email,
        role,
      },
    });

    console.log(`\nSUCCESS: DEV user created for ${email}.`);
    console.log(`Shop: ${shops[0].name}`);
    console.log(`Role: ${role}`);
    console.log('Email is pre-confirmed for DEV testing.');
    console.log('The password itself was not printed or stored.');
  } catch (error) {
    if (createdUserId) {
      await supabase.auth.admin.deleteUser(createdUserId).catch(() => {});
    }
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  if (error?.message === 'Cancelled') process.exit(130);
  fail(error instanceof Error ? error.message : String(error));
});

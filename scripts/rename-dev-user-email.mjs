import { createClient } from '@supabase/supabase-js';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const DEV_PROJECT_REF = 'qchvjaqwanyimkidlqqu';

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
  const fromEmail = (getArg('from') || '').trim().toLowerCase();
  const toEmail = (getArg('to') || '').trim().toLowerCase();

  if (!fromEmail || !fromEmail.includes('@')) fail('Provide a valid --from email address.');
  if (!toEmail || !toEmail.includes('@')) fail('Provide a valid --to email address.');
  if (fromEmail === toEmail) fail('Old and new email addresses are the same.');

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

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const oldUser = await findAuthUser(supabase, fromEmail);
  if (!oldUser) fail(`No DEV Auth user found for ${fromEmail}.`);

  const existingNewUser = await findAuthUser(supabase, toEmail);
  if (existingNewUser) fail(`A DEV Auth user already exists for ${toEmail}.`);

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: databaseUrl }),
  });

  try {
    const memberships = await prisma.shopMembership.findMany({
      where: { userId: oldUser.id },
      select: { id: true, shopId: true, userEmail: true, role: true, shop: { select: { name: true } } },
    });

    if (memberships.length !== 1) {
      fail(`Expected exactly one DEV shop membership for ${fromEmail}, found ${memberships.length}.`);
    }

    const membership = memberships[0];
    if (membership.userEmail.toLowerCase() !== fromEmail) {
      fail(`Membership email mismatch. Auth has ${fromEmail}, membership has ${membership.userEmail}.`);
    }

    console.log('\nTarget: DEV');
    console.log(`Supabase project: ${projectRef}`);
    console.log(`Shop: ${membership.shop.name}`);
    console.log(`Role: ${membership.role}`);
    console.log(`Current email: ${fromEmail}`);
    console.log(`New email: ${toEmail}`);

    const { error: authUpdateError } = await supabase.auth.admin.updateUserById(oldUser.id, {
      email: toEmail,
      email_confirm: true,
    });
    if (authUpdateError) fail(`Auth email update failed: ${authUpdateError.message}`);

    try {
      await prisma.shopMembership.update({
        where: { id: membership.id },
        data: { userEmail: toEmail },
      });
    } catch (dbError) {
      await supabase.auth.admin.updateUserById(oldUser.id, {
        email: fromEmail,
        email_confirm: true,
      }).catch(() => {});
      throw dbError;
    }

    console.log(`\nSUCCESS: DEV user email changed from ${fromEmail} to ${toEmail}.`);
    console.log(`Shop: ${membership.shop.name}`);
    console.log(`Role: ${membership.role}`);
    console.log('Auth user ID was preserved.');
    console.log('Password was not changed.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  fail(error instanceof Error ? error.message : String(error));
});

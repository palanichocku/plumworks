import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline';

const TARGETS = {
  dev: {
    label: 'DEV',
    expectedProjectRef: 'qchvjaqwanyimkidlqqu',
  },
  prod: {
    label: 'PROD',
    expectedProjectRef: 'ouxlfjkklxlomnpoqrwy',
  },
};

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
    const hostname = new URL(url).hostname;
    return hostname.split('.')[0] || null;
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

async function confirmProd(email) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => {
    rl.question(`Type PROD to confirm password reset for ${email}: `, resolve);
  });
  rl.close();
  return answer.trim() === 'PROD';
}

async function main() {
  const targetName = getArg('target');
  const email = (getArg('email') || '').trim().toLowerCase();
  const target = TARGETS[targetName];

  if (!target) fail('Use --target dev or --target prod.');
  if (!email || !email.includes('@')) fail('Provide a valid --email address.');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl) fail('NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is missing.');
  if (!serviceRoleKey) fail('SUPABASE_SERVICE_ROLE_KEY is missing.');

  const actualProjectRef = getProjectRef(supabaseUrl);
  if (actualProjectRef !== target.expectedProjectRef) {
    fail(
      `${target.label} safety check failed. Expected Supabase project ${target.expectedProjectRef}, ` +
        `but the loaded environment points to ${actualProjectRef || 'an unknown project'}.`,
    );
  }

  console.log(`\nTarget: ${target.label}`);
  console.log(`Supabase project: ${actualProjectRef}`);
  console.log(`User: ${email}`);

  if (targetName === 'prod' && !(await confirmProd(email))) {
    fail('Production reset cancelled.');
  }

  const password = await promptHidden('New password: ');
  const confirmPassword = await promptHidden('Confirm password: ');

  if (password !== confirmPassword) fail('Passwords do not match.');
  if (password.length < 8) fail('Password must be at least 8 characters.');

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let page = 1;
  let user = null;
  while (!user) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail(`Unable to list Auth users: ${error.message}`);

    user = data.users.find((candidate) => candidate.email?.toLowerCase() === email) || null;
    if (user || data.users.length < 1000) break;
    page += 1;
  }

  if (!user) fail(`No Auth user found for ${email} in ${target.label}.`);

  const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password });
  if (updateError) fail(`Password reset failed: ${updateError.message}`);

  console.log(`\nSUCCESS: ${target.label} password reset for ${email}.`);
  console.log('The password itself was not printed or stored.');
}

main().catch((error) => {
  if (error?.message === 'Cancelled') process.exit(130);
  fail(error instanceof Error ? error.message : String(error));
});

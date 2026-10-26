// Runs the full local test suite with a fake database and fake Razorpay (no real money, no real DB).
//   npm test            -> SQL + API tests
//   npm run test:ui     -> also drives the real pages in headless Edge/Chrome
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const withUi = process.argv.includes('--ui');
const children = [];

const env = {
  ...process.env,
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-test-key',
  RAZORPAY_KEY_ID: 'rzp_test_fake',
  RAZORPAY_KEY_SECRET: 'fake_secret_123',
  RAZORPAY_API_BASE: 'http://127.0.0.1:54322/v1',
  RAZORPAY_WEBHOOK_SECRET: 'whsec_test',
  ADMIN_PASSWORD: 'TestPass#2026',
  ADMIN_SESSION_SECRET: '0123456789abcdef0123456789abcdef0123',
  CRON_SECRET: 'cron_test',
  PORT: '3099',
  DOTENV_CONFIG_PATH: 'tests/.no-env'
};

function start(args) {
  const p = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stderr.on('data', d => process.env.DEBUG && process.stderr.write(d));
  children.push(p);
  return p;
}

function run(args) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, args, { cwd: root, env, stdio: 'inherit' });
    p.on('exit', code => resolve(code));
  });
}

async function waitFor(url) {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Timed out waiting for ' + url);
}

let code = 0;
try {
  console.log('\n== SQL tests ==');
  code ||= await run(['tests/sql.test.mjs']);

  start(['tests/fakes.mjs']);
  await waitFor('http://127.0.0.1:54322/');
  start(['server.js']);
  await waitFor('http://127.0.0.1:3099/api/config');

  console.log('\n== API tests ==');
  code ||= await run(['tests/api.test.mjs']);

  if (withUi) {
    console.log('\n== UI tests ==');
    code ||= await run(['tests/ui.test.mjs']);
  }
} catch (e) {
  console.error(e);
  code = 1;
} finally {
  children.forEach(c => c.kill());
}
console.log(code ? '\nSOME TESTS FAILED' : '\nEVERYTHING PASSED');
process.exit(code);

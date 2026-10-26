// End-to-end API test against server.js + fakes.mjs
import crypto from 'node:crypto';
const B = 'http://127.0.0.1:3099';
const RZ = 'http://127.0.0.1:54322';
let fails = 0;
const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 300))); if (!c) fails++; };
const j = async (method, path, body, headers = {}) => {
  // Each call looks like a different visitor unless the test sets x-forwarded-for itself
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const r = await fetch(B + path, { method, headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip, ...headers }, body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)) });
  return { status: r.status, body: await r.json().catch(() => null), headers: r.headers };
};
const pay = async (order_id, extra = {}) => (await fetch(RZ + '/__pay', { method: 'POST', body: JSON.stringify({ order_id, ...extra }) })).json();

const athlete = (n, extra = {}) => ({ fullName: `Test Shooter ${n}`, fatherName: 'Father', clubName: 'BBC Academy', phone: `98${String(n).padStart(8, '0')}`, dob: '2011-05-14', gender: 'Male', eventCode: 'AR-04', matchDate: '2026-11-25', relayNo: 2, ...extra });

// ---------- public config ----------
let r = await j('GET', '/api/config');
ok(r.status === 200 && r.body.events.length === 70 && r.body.relays.length === 6, 'config: 70 events, 6 relays');
ok(/s-maxage=15/.test(r.headers.get('cache-control')), 'config is CDN cacheable');
ok(r.body.events.find(e => e.code === 'AR-17').fee === 1000, 'config: U12 fee 1000');

// ---------- validation ----------
r = await j('POST', '/api/create-order', athlete(1, { phone: '12345' }));
ok(r.status === 400 && /mobile/i.test(r.body.error), 'rejects bad mobile', r.body);
r = await j('POST', '/api/create-order', athlete(1, { eventCode: 'AR-08' }));
ok(r.status === 409 && /gender/i.test(r.body.error), 'rejects female category for male', r.body);
r = await j('POST', '/api/create-order', athlete(1, { matchDate: '2026-12-01' }));
ok(r.status === 400 && /match date/i.test(r.body.error), 'rejects non-match day', r.body);
r = await j('POST', '/api/create-order', { ...athlete(1), amount: 100 });
ok(r.status === 200 && r.body.amount === 150000, 'amount comes from DB (1500), browser amount ignored', r.body);
const order1 = r.body;

// U12 fee
r = await j('POST', '/api/create-order', athlete(50, { eventCode: 'AR-17' }));
ok(r.status === 200 && r.body.amount === 100000, 'U12 order is ₹1000', r.body);

// ---------- pay + verify ----------
const p1 = await pay(order1.orderId);
r = await j('POST', '/api/verify-payment', { razorpay_order_id: order1.orderId, razorpay_payment_id: p1.id, razorpay_signature: 'bad' });
ok(r.status === 400, 'bad signature rejected');
r = await j('POST', '/api/verify-payment', { razorpay_order_id: order1.orderId, razorpay_payment_id: p1.id, razorpay_signature: p1.signature });
ok(r.status === 200 && r.body.pass.regNo === 'NSC-2026-101' && r.body.pass.bibNo === 101 && r.body.pass.lane === 1, 'verify confirms: bib 101, lane 1', r.body);
ok(r.body.pass && !('email' in r.body.pass) && /\*/.test(r.body.pass.phoneMasked), 'pass hides email and masks phone');
r = await j('POST', '/api/verify-payment', { razorpay_order_id: order1.orderId, razorpay_payment_id: p1.id, razorpay_signature: p1.signature });
ok(r.status === 200 && r.body.pass.bibNo === 101, 'verify is idempotent (same bib on repeat)');

// duplicate registration same event
r = await j('POST', '/api/create-order', athlete(1));
ok(r.status === 409 && /already registered/.test(r.body.error), 'same athlete+event blocked', r.body);

// ---------- webhook path (browser closed after paying) ----------
r = await j('POST', '/api/create-order', athlete(2));
const order2 = r.body;
const p2 = await pay(order2.orderId);
const hookBody = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: p2.id, order_id: order2.orderId, status: 'captured' } } } });
r = await j('POST', '/api/razorpay-webhook', hookBody, { 'x-razorpay-signature': 'wrong' });
ok(r.status === 400, 'webhook with wrong signature rejected');
const sig = crypto.createHmac('sha256', 'whsec_test').update(hookBody).digest('hex');
r = await j('POST', '/api/razorpay-webhook', hookBody, { 'x-razorpay-signature': sig });
ok(r.status === 200 && r.body.result === 'confirmed', 'webhook confirms registration', r.body);
r = await j('GET', '/api/track?mobile=9800000002');
ok(r.status === 200 && r.body.passes[0].status === 'paid' && r.body.passes[0].bibNo === 102, 'track shows webhook-confirmed pass bib 102', r.body);

// ---------- amount mismatch ----------
r = await j('POST', '/api/create-order', athlete(3));
const order3 = r.body;
const p3 = await pay(order3.orderId, { amount: 100 });
r = await j('POST', '/api/verify-payment', { razorpay_order_id: order3.orderId, razorpay_payment_id: p3.id, razorpay_signature: p3.signature });
ok(r.status === 409, 'amount mismatch not confirmed', r.body);

// ---------- failed payment ----------
r = await j('POST', '/api/create-order', athlete(4));
const order4 = r.body;
await pay(order4.orderId, { status: 'failed' });

// ---------- slots ----------
r = await j('GET', '/api/slots?date=2026-11-25');
ok(r.status === 200 && r.body.taken['2'] >= 3, 'slots counts relay 2', r.body);

// ---------- relay full (capacity 15) ----------
let full = null;
for (let i = 100; i < 120; i++) {
  const x = await j('POST', '/api/create-order', athlete(i, { relayNo: 3 }));
  if (x.status !== 200) { full = x; break; }
}
ok(full && full.status === 409 && /full/i.test(full.body.error), 'relay 3 refuses 16th seat', full && full.body);

// ---------- seat-hoarding limits ----------
let capped = null;
for (let i = 0; i < 4; i++) {
  const x = await j('POST', '/api/create-order', athlete(300, { eventCode: ['AR-01', 'AR-02', 'AR-03', 'AR-09'][i], relayNo: 4 }));
  if (x.status !== 200) { capped = { i, x }; break; }
}
ok(capped && capped.i === 3 && capped.x.status === 429, '4th unpaid hold from same mobile is refused', capped && capped.x.body);
capped = null;
for (let i = 0; i < 11; i++) {
  const x = await j('POST', '/api/create-order', athlete(400 + i, { relayNo: 5 }), { 'x-forwarded-for': '203.0.113.7' });
  if (x.status !== 200) { capped = { i, x }; break; }
}
ok(capped && capped.i === 10 && capped.x.status === 429, '11th unpaid hold from same network is refused', capped && { i: capped.i, body: capped.x.body });

// ---------- track ----------
r = await j('GET', '/api/track?mobile=9999999999');
ok(r.status === 404, 'track unknown mobile 404');
r = await j('GET', '/api/track?q=101');
ok(r.status === 400, 'track by bib alone is not allowed (no enumeration)');

// ---------- admin auth ----------
r = await j('POST', '/api/admin', { action: 'dashboard' });
ok(r.status === 401, 'admin requires login');
r = await j('POST', '/api/admin', { action: 'login', password: 'wrong' });
ok(r.status === 401, 'wrong admin password rejected');
r = await j('POST', '/api/admin', { action: 'login', password: 'TestPass#2026' });
ok(r.status === 200 && r.body.token, 'admin login ok');
const H = { Authorization: `Bearer ${r.body.token}` };
r = await j('POST', '/api/admin', { action: 'dashboard' }, { Authorization: H.Authorization.slice(0, -2) + 'xx' });
ok(r.status === 401, 'tampered token rejected');
const A = async (action, params = {}) => j('POST', '/api/admin', { action, ...params }, H);

r = await A('dashboard');
ok(r.status === 200 && r.body.stats.paid === 2 && r.body.stats.revenue === 3000, 'dashboard: 2 paid, ₹3000', r.body.stats);

// reconcile: pay order of athlete 5 silently then reconcile
r = await j('POST', '/api/create-order', athlete(5));
await pay(r.body.orderId);
r = await A('reconcile');
ok(r.status === 200 && r.body.confirmed.includes('Test Shooter 5'), 'reconcile confirms silent payment', r.body);

// settings
r = await A('settings.save', { data: { registrationOpen: false } });
ok(r.status === 200 && r.body.settings.registrationOpen === false && r.body.settings.tournamentName, 'settings merge-save');
r = await j('POST', '/api/create-order', athlete(6));
ok(r.status === 403 && /closed/i.test(r.body.error), 'registrations closed blocks orders', r.body);
await A('settings.save', { data: { registrationOpen: true, registrationDeadline: '2020-01-01' } });
r = await j('POST', '/api/create-order', athlete(6));
ok(r.status === 403 && /deadline/i.test(r.body.error), 'deadline blocks orders', r.body);
await A('settings.save', { data: { registrationDeadline: '' } });

// events: change fee
r = await A('events.save', { event: { code: 'AR-03', event_group: 'ISSF 10M Air Rifle', category: 'Youth Men (Under 19)', gender: 'Male', weapon: 'Rifle', age_limit: 'Born 2007 or after', shots: 60, target: 'Electronic (SIUS)', fee: 1200, sort: 20, active: true } });
ok(r.status === 200 && r.body.event.fee === 1200, 'event fee updated to 1200');
r = await j('POST', '/api/create-order', athlete(7, { eventCode: 'AR-03' }));
ok(r.status === 200 && r.body.amount === 120000, 'new fee used for orders', r.body);
r = await A('events.delete', { code: 'AR-04' });
ok(r.status === 409, 'cannot delete event with registrations');

// relays
r = await A('relays.save', { relay: { relay_no: 7, name: 'Relay 07', type: 'NR', time_text: '06:30 PM', reporting_text: '06:00 PM', capacity: 10, active: true } });
ok(r.status === 200 && r.body.relay.capacity === 10, 'relay added');
r = await A('relays.delete', { relay_no: 7 });
ok(r.status === 200, 'empty relay deleted');

// walk-in
r = await A('regs.create', { reg: { full_name: 'Walk In Girl', gender: 'Female', phone: '9111111111', event_code: 'AR-08', match_date: '2026-11-26', relay_no: '1', status: 'paid', payment_mode: 'cash' } });
ok(r.status === 200 && r.body.registration.status === 'paid' && r.body.registration.lane_no === 1 && r.body.registration.source === 'walkin', 'walk-in created & seated', r.body);
const walkId = r.body.registration.id;
r = await A('regs.create', { reg: { full_name: 'Bad', gender: 'Male', phone: '123', event_code: 'AR-04' } });
ok(r.status === 400, 'walk-in validates mobile');

// update: move relay without lane -> auto lane
r = await A('regs.update', { id: walkId, patch: { relay_no: '4', lane_no: '', match_date: '2026-11-26', fee: '' } });
ok(r.status === 200 && r.body.registration.relay_no === 4 && r.body.registration.lane_no === 1 && r.body.registration.fee === 1500, 'edit moves relay, auto lane, fee kept', r.body);

// import registrations
const importRows = [
  { __row: 2, full_name: 'Import One', gender: 'Male', phone: '9222222221', event_code: 'ap-01', match_date: '2026-11-27', relay_no: 1, status: 'paid' },
  { __row: 3, full_name: 'Import Two', gender: 'F', phone: '9222222222', event_code: 'AP-05', match_date: '2026-11-27', relay_no: 1, bib_no: 900 },
  { __row: 4, full_name: 'Broken', gender: 'Male', phone: '9222222223', event_code: 'ZZ-1' },
  { __row: 5, full_name: 'No Phone', gender: 'Male', event_code: 'AP-01' }
];
r = await A('regs.import', { rows: importRows });
const res = r.body.results;
ok(r.status === 200 && res[0].ok && res[1].ok && res[1].bib_no === 900 && !res[2].ok && !res[3].ok, 'import: 2 ok (bib 900 kept), 2 errors reported', res);
r = await A('regs.import', { rows: importRows.slice(0, 2) });
ok(r.body.results.every(x => !x.ok && /already entered/.test(x.error)), 're-importing same sheet is blocked as duplicate', r.body.results);
r = await A('regs.create', { reg: { full_name: 'After Import', gender: 'Male', phone: '9333333333', event_code: 'AP-01' } });
ok(r.body.registration.bib_no === 901, 'bib continues after imported 900', r.body.registration);

// scores
r = await A('scores.save', { score: { bib_no: 101, s1: '104.2', s2: 103.5, s3: 105, s4: 104.1, s5: 103.3, s6: 104.9, inner_tens: 40, status: 'finished' } });
ok(r.status === 200 && r.body.score.total === 625, 'score saved, total 625.0', r.body);
r = await A('scores.save', { score: { bib_no: 101, s1: 'abc' } });
ok(r.status === 400, 'invalid score rejected');
r = await A('scores.import', { rows: [
  { __row: 2, bib_no: '102', s1: 100.1, s2: 100.2, s3: 100.3, s4: 100.4, s5: 100.5, s6: 100.6, inner_tens: 20 },
  { __row: 3, bib_no: 999, s1: 1 },
  { __row: 4, reg_no: 'nsc-2026-900', s1: 95, s2: 96, s3: 97, s4: 98, inner_tens: 5 }
] });
ok(r.status === 200 && r.body.results[0].ok && !r.body.results[1].ok && r.body.results[2].ok, 'score import by bib & reg no; unknown bib reported', r.body.results);

// public scores
r = await j('GET', '/api/scores');
const top = r.body.scores.find(s => s.bib === 101);
ok(r.status === 200 && top && top.total === 625 && !('phone' in top), 'public scores show total, no phone');
await A('settings.save', { data: { resultsPublic: false } });
r = await j('GET', '/api/scores');
ok(r.body.published === false && r.body.scores.length === 0, 'results hidden when unpublished');
await A('settings.save', { data: { resultsPublic: true } });

// status changes
r = await A('regs.setStatus', { id: walkId, status: 'cancelled' });
ok(r.status === 200 && r.body.registration.status === 'cancelled', 'cancel entry');
r = await A('regs.setStatus', { id: walkId, status: 'paid', payment_mode: 'upi' });
ok(r.status === 200 && r.body.registration.status === 'paid', 're-confirm cancelled entry');

// backup + restore
r = await A('backup.export');
const backup = r.body.backup;
ok(r.status === 200 && backup.registrations.length > 10 && backup.scores.length > 0, 'backup export', { regs: backup && backup.registrations.length });
await A('regs.delete', { id: walkId });
r = await A('backup.restore', { backup });
ok(r.status === 200 && r.body.counts.registrations === backup.registrations.length, 'restore ok', r.body);
r = await A('regs.list');
ok(r.body.registrations.some(x => x.id === walkId), 'deleted registration is back after restore');

r = await A('audit.list');
ok(r.status === 200 && r.body.audit.length > 5 && r.body.payments.length > 0, 'audit + payment logs');

// cron
r = await j('GET', '/api/cron');
ok(r.status === 401, 'cron requires secret');
r = await j('GET', '/api/cron', undefined, { Authorization: 'Bearer cron_test' });
ok(r.status === 200 && r.body.success, 'cron runs', r.body);

// static hardening
for (const p of ['/.env', '/api/_lib/db', '/server.js', '/supabase/schema.sql']) {
  const x = await fetch(B + p);
  ok(x.status === 404, `blocked ${p}`);
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);

// SQL tests for supabase/schema.sql + seed.sql (runs Postgres in-process via PGlite)
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const dir = process.argv[2] || fileURLToPath(new URL('../supabase', import.meta.url));
const db = new PGlite();
await db.exec(`create role anon; create role authenticated;`);
const schema = fs.readFileSync(dir + '/schema.sql', 'utf8').replace('create extension if not exists pgcrypto;', '');
await db.exec(schema);
await db.exec(fs.readFileSync(dir + '/seed.sql', 'utf8'));
await db.exec(fs.readFileSync(dir + '/schema.sql', 'utf8').replace('create extension if not exists pgcrypto;', '')); // re-run idempotent
await db.exec(fs.readFileSync(dir + '/seed.sql', 'utf8'));
const q = async (sql, params) => (await db.query(sql, params)).rows;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };

ok((await q('select count(*)::int c from events'))[0].c === 70, 'seeded 70 events');
ok((await q(`select fee from events where code='AR-17'`))[0].fee === 1000, 'U12 fee 1000');
ok((await q(`select data->>'startDate' d from app_settings`))[0].d === '2026-11-25', 'settings seeded');

const athlete = (n, extra = {}) => JSON.stringify({ full_name: 'Shooter ' + n, gender: 'Male', phone: '98765' + String(n).padStart(5, '0'), event_code: 'AR-04', match_date: '2026-11-25', relay_no: 1, ...extra });
// Fill relay 1 (capacity 15)
const lanes = [];
for (let i = 1; i <= 15; i++) lanes.push((await q('select * from reserve_registration($1::jsonb)', [athlete(i)]))[0].lane_no);
ok(JSON.stringify(lanes) === JSON.stringify([...Array(15)].map((_, i) => i + 1)), 'lanes 1..15 assigned in order');
let err = null; try { await q('select reserve_registration($1::jsonb)', [athlete(16)]); } catch (e) { err = e.message; }
ok(err && err.includes('RELAY_FULL'), '16th reserve rejected RELAY_FULL');
err = null; try { await q('select reserve_registration($1::jsonb)', [athlete(17, { gender: 'Female' })]); } catch (e) { err = e.message; }
ok(err && err.includes('GENDER_MISMATCH'), 'gender mismatch rejected');
const occ = await q(`select * from relay_occupancy('2026-11-25')`);
ok(occ.length === 1 && occ[0].taken === 15, 'occupancy 15');

// Confirm #1, twice (idempotent)
const r1 = (await q(`select id from registrations where full_name='Shooter 1'`))[0].id;
const c1 = (await q('select * from confirm_registration($1, $2, $3)', [r1, 'pay_1', 'razorpay']))[0];
const c1b = (await q('select * from confirm_registration($1, $2, $3)', [r1, 'pay_1', 'razorpay']))[0];
ok(c1.status === 'paid' && c1.bib_no === 101 && c1.reg_no.endsWith('-101') && c1b.bib_no === 101, 'confirm assigns bib 101, idempotent');
ok((await q('select count(*)::int c from scores'))[0].c === 1, 'score row created');

// Expire everything pending older than 30 min, then new reservations take freed lanes
await q(`update registrations set created_at = now() - interval '40 minutes' where status='pending'`);
const r16 = (await q('select * from reserve_registration($1::jsonb)', [athlete(16)]))[0];
ok(r16.lane_no === 2, 'after expiry new booking gets lane 2');
// Late payment for expired Shooter 2 (lane 2 taken by 16) -> re-seated in another free lane
const r2 = (await q(`select id from registrations where full_name='Shooter 2'`))[0].id;
const c2 = (await q('select * from confirm_registration($1, $2, $3)', [r2, 'pay_2', 'razorpay']))[0];
ok(c2.status === 'paid' && c2.lane_no === 3 && !c2.slot_issue, 'late payment re-seated to lane 3');
// Fill all remaining, then a late payment with no lanes -> slot_issue
for (let i = 20; i < 40; i++) { try { await q('select reserve_registration($1::jsonb)', [athlete(i)]); } catch (e) { break; } }
const r3 = (await q(`select id from registrations where full_name='Shooter 3'`))[0].id;
const c3 = (await q('select * from confirm_registration($1, $2, $3)', [r3, 'pay_3', 'razorpay']))[0];
ok(c3.status === 'paid' && c3.lane_no === null && c3.slot_issue === true, 'paid with full relay -> slot_issue flag');

// Admin walk-in into relay 2 with explicit bib
const w = (await q('select * from admin_create_registration($1::jsonb)', [JSON.stringify({ full_name: 'Walk In', gender: 'Female', phone: '9000000001', event_code: 'AR-08', match_date: '2026-11-26', relay_no: '2', status: 'paid', payment_mode: 'cash', bib_no: '500' })]))[0];
ok(w.status === 'paid' && w.bib_no === 500 && w.lane_no === 1 && w.source === 'admin', 'walk-in paid with bib 500 lane 1');
await q('select sync_bib_seq()');
const nb = (await q('select * from confirm_registration($1, null, $2)', [r16.id, 'razorpay']))[0];
ok(nb.bib_no === 501, 'bib sequence continues after 500');
// Walk-in without relay
const w2 = (await q('select * from admin_create_registration($1::jsonb)', [JSON.stringify({ full_name: 'No Slot', gender: 'Male', phone: '9000000002', event_code: 'AP-01' })]))[0];
ok(w2.status === 'paid' && w2.lane_no === null && w2.slot_issue === false, 'walk-in without slot ok');
err = null; try { await q('select admin_create_registration($1::jsonb)', [JSON.stringify({ full_name: 'X', gender: 'Male', phone: '9', event_code: 'ZZ-99' })]); } catch (e) { err = e.message; }
ok(err && err.includes('UNKNOWN_EVENT_CODE'), 'unknown event code rejected');

// Scores + public view
await q(`update scores set s1=104.2, s2=103.1, inner_tens=12, status='finished' where registration_id=$1`, [r1]);
const pr = await q(`select * from public_results where bib_no=101`);
ok(pr.length === 1 && Number(pr[0].total) === 207.3 && !('phone' in pr[0]), 'public_results total 207.3 and no phone column');

// Privileges
const g = await q(`select has_table_privilege('anon','registrations','select') a, has_table_privilege('anon','public_results','select') b, has_function_privilege('anon','reserve_registration(jsonb)','execute') c`);
ok(!g[0].a && !g[0].b && !g[0].c, 'anon has no access to tables, view or functions');
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);

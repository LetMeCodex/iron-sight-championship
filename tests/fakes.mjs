// Test doubles: PGlite + a small PostgREST-compatible HTTP layer (port 54321)
// and a fake Razorpay API (port 54322). Started by tests/run.mjs.
import { PGlite } from '@electric-sql/pglite';
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

import { fileURLToPath } from 'node:url';
const dir = process.argv[2] || fileURLToPath(new URL('../supabase', import.meta.url));
const db = new PGlite({
  parsers: {
    1082: v => v,                 // date -> 'YYYY-MM-DD'
    1184: v => v,                 // timestamptz -> string
    1114: v => v,
    1700: v => Number(v),         // numeric -> number (PostgREST does this)
  }
});
await db.exec('create role anon; create role authenticated;');
await db.exec(fs.readFileSync(dir + '/schema.sql', 'utf8').replace('create extension if not exists pgcrypto;', ''));
await db.exec(fs.readFileSync(dir + '/seed.sql', 'utf8'));

const SCALAR_FNS = new Set(['free_lane', 'sync_bib_seq']);
const SET_FNS = new Set(['relay_occupancy']);
const ident = s => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('bad identifier ' + s); return `"${s}"`; };

function parseFilters(params, values) {
  const where = [];
  for (const [k, raw] of params) {
    if (['select', 'order', 'limit', 'on_conflict'].includes(k)) continue;
    let v = raw;
    let not = false;
    if (v.startsWith('not.')) { not = true; v = v.slice(4); }
    const dot = v.indexOf('.');
    const op = v.slice(0, dot), arg = v.slice(dot + 1);
    let clause;
    if (op === 'eq') { values.push(arg); clause = `${ident(k)}::text = $${values.length}`; }
    else if (op === 'gte') { values.push(arg); clause = `${ident(k)} >= $${values.length}`; }
    else if (op === 'in') {
      const items = arg.replace(/^\(|\)$/g, '').split(',');
      clause = `${ident(k)}::text in (${items.map(i => { values.push(i); return '$' + values.length; }).join(',')})`;
    } else if (op === 'is') clause = `${ident(k)} is ${arg === 'null' ? 'null' : arg === 'true' ? 'true' : 'false'}`;
    else throw new Error('unsupported op ' + op);
    where.push(not ? `not (${clause})` : clause);
  }
  return where.length ? ' where ' + where.join(' and ') : '';
}

async function selectRows(table, params) {
  const values = [];
  const select = params.get('select') || '*';
  const embeds = [...select.matchAll(/(\w+)\(\*\)/g)].map(m => m[1]);
  const cols = select.replace(/,?\w+\(\*\)/g, '').split(',').filter(Boolean);
  let sql = `select ${cols.map(c => c === '*' ? '*' : ident(c)).join(',') || '*'}${embeds.includes('scores') ? ', id as __id' : ''} from ${ident(table)}`;
  sql += parseFilters(params, values);
  if (params.get('order')) sql += ' order by ' + params.get('order').split(',').map(o => { const [c, d] = o.split('.'); return `${ident(c)} ${d === 'desc' ? 'desc' : 'asc'}`; }).join(',');
  if (params.get('limit')) sql += ' limit ' + parseInt(params.get('limit'), 10);
  const rows = (await db.query(sql, values)).rows;
  if (embeds.includes('scores')) {
    for (const r of rows) {
      const s = (await db.query('select * from scores where registration_id = $1', [r.__id])).rows;
      r.scores = s[0] || null; // one-to-one -> object, like PostgREST
      delete r.__id;
    }
  }
  return rows;
}

function jsonArg(v) {
  return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
}

async function handle(req, body) {
  const url = new URL(req.url, 'http://x');
  const path = url.pathname.replace(/^\/rest\/v1\//, '');
  const params = url.searchParams;
  if (req.headers.apikey !== 'service-test-key') return [401, { message: 'bad key' }];

  if (path.startsWith('rpc/')) {
    const fn = path.slice(4);
    const args = Object.entries(body || {});
    const sql = `select * from ${ident(fn)}(${args.map(([k], i) => `${ident(k)} => $${i + 1}`).join(',')})`;
    const rows = (await db.query(sql, args.map(([, v]) => jsonArg(v)))).rows;
    if (SCALAR_FNS.has(fn)) return [200, rows[0] ? Object.values(rows[0])[0] : null];
    if (SET_FNS.has(fn)) return [200, rows];
    return [200, rows[0]];
  }

  const table = path;
  if (req.method === 'GET') return [200, await selectRows(table, params)];

  if (req.method === 'POST') {
    const list = Array.isArray(body) ? body : [body];
    const out = [];
    const upsert = /merge-duplicates/.test(req.headers.prefer || '');
    const conflict = params.get('on_conflict');
    for (const row of list) {
      const keys = Object.keys(row);
      const vals = keys.map(k => jsonArg(row[k]));
      let sql = `insert into ${ident(table)} (${keys.map(ident).join(',')}) values (${keys.map((_, i) => '$' + (i + 1)).join(',')})`;
      if (upsert && conflict) {
        const upd = keys.filter(k => k !== conflict);
        sql += ` on conflict (${ident(conflict)}) do ${upd.length ? 'update set ' + upd.map(k => `${ident(k)} = excluded.${ident(k)}`).join(',') : 'nothing'}`;
      }
      sql += ' returning *';
      out.push(...(await db.query(sql, vals)).rows);
    }
    return [201, out];
  }

  if (req.method === 'PATCH') {
    const values = [];
    const keys = Object.keys(body);
    const set = keys.map(k => { values.push(jsonArg(body[k])); return `${ident(k)} = $${values.length}`; }).join(',');
    const where = parseFilters(params, values);
    return [200, (await db.query(`update ${ident(table)} set ${set}${where} returning *`, values)).rows];
  }

  if (req.method === 'DELETE') {
    const values = [];
    const where = parseFilters(params, values);
    return [200, (await db.query(`delete from ${ident(table)}${where} returning *`, values)).rows];
  }
  return [405, { message: 'method' }];
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', async () => {
    try {
      const [status, data] = await handle(req, raw ? JSON.parse(raw) : null);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    } catch (e) {
      const status = e.code === '23505' ? 409 : 400;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: e.code, message: e.message }));
    }
  });
}).listen(54321, () => console.log('fake postgrest on 54321'));

// ---------------- fake Razorpay ----------------
const orders = new Map();
const payments = new Map(); // orderId -> [payment]
const KEY = 'rzp_test_fake:fake_secret_123';
http.createServer((req, res) => {
  let raw = '';
  req.on('data', c => raw += c);
  req.on('end', () => {
    const send = (s, d) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/__pay') {
      // test helper: simulate a customer paying an order
      const { order_id, amount, status } = JSON.parse(raw);
      const o = orders.get(order_id);
      const p = { id: 'pay_' + crypto.randomBytes(6).toString('hex'), order_id, amount: amount ?? o.amount, status: status || 'captured', method: 'upi' };
      payments.set(order_id, [...(payments.get(order_id) || []), p]);
      const signature = crypto.createHmac('sha256', 'fake_secret_123').update(`${order_id}|${p.id}`).digest('hex');
      return send(200, { ...p, signature });
    }
    if (req.headers.authorization !== 'Basic ' + Buffer.from(KEY).toString('base64')) return send(401, { error: { description: 'auth' } });
    let m;
    if (req.method === 'POST' && url.pathname === '/v1/orders') {
      const b = JSON.parse(raw);
      const o = { id: 'order_' + crypto.randomBytes(6).toString('hex'), amount: b.amount, currency: b.currency, receipt: b.receipt, notes: b.notes, status: 'created' };
      orders.set(o.id, o);
      return send(200, o);
    }
    if ((m = url.pathname.match(/^\/v1\/orders\/([^/]+)\/payments$/))) return send(200, { items: payments.get(m[1]) || [] });
    if ((m = url.pathname.match(/^\/v1\/orders\/([^/]+)$/))) return orders.has(m[1]) ? send(200, orders.get(m[1])) : send(404, { error: { description: 'no order' } });
    send(404, { error: { description: 'not found' } });
  });
}).listen(54322, () => console.log('fake razorpay on 54322'));

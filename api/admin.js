// POST /api/admin  { action, ...params }  — every admin operation, behind a password login.
// One function (instead of many) keeps us well under Vercel's function limit.

import { audit, db, eq, friendlyDbError } from './_lib/db.js';
import { checkPassword, issueToken, requireAdmin } from './_lib/auth.js';
import { fail, handler, HttpError, onlyMethods, readBody, send } from './_lib/http.js';
import { confirmOrder, getSettings, normalizePhone } from './_lib/registrations.js';

const now = () => new Date().toISOString();
const SCORE_FIELDS = ['s1', 's2', 's3', 's4', 's5', 's6'];
const REG_EDITABLE = ['full_name', 'father_name', 'gender', 'dob', 'phone', 'email', 'state', 'club_name',
  'event_code', 'match_date', 'relay_no', 'lane_no', 'fee', 'payment_mode', 'notes', 'bib_no'];
const EVENT_FIELDS = ['code', 'event_group', 'category', 'gender', 'weapon', 'age_limit', 'shots', 'target', 'fee', 'active', 'sort'];
const RELAY_FIELDS = ['relay_no', 'name', 'type', 'match_title', 'time_text', 'reporting_text', 'duration', 'capacity', 'active'];

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}

function emptyToNull(o) {
  for (const k of Object.keys(o)) if (o[k] === '') o[k] = null;
  return o;
}

function scoreValue(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 999) throw new HttpError(400, `Invalid score value: ${v}`);
  return Math.round(n * 10) / 10;
}

async function withFriendly(promise) {
  try {
    return await promise;
  } catch (err) {
    const f = friendlyDbError(err);
    if (f) throw new HttpError(409, f);
    if (/registrations_lane_uniq/.test(err.message)) throw new HttpError(409, 'That lane is already taken in this relay on this day.');
    if (/bib_no/.test(err.message) && /duplicate/.test(err.message)) throw new HttpError(409, 'That bib number is already used.');
    if (/rzp_payment_id/.test(err.message) && /duplicate/.test(err.message)) throw new HttpError(409, 'That payment ID is already linked to another registration.');
    throw err;
  }
}

// Shape an imported / walk-in row into what admin_create_registration expects.
function regPayload(r, source) {
  const phone = normalizePhone(r.phone || r.mobile);
  const p = {
    full_name: String(r.full_name || r.name || '').trim(),
    father_name: r.father_name || r.fatherName || '',
    gender: /^f/i.test(String(r.gender || '')) ? 'Female' : 'Male',
    dob: r.dob || '',
    phone,
    email: r.email || '',
    state: r.state || '',
    club_name: r.club_name || r.club || r.school || '',
    event_code: String(r.event_code || r.code || '').trim().toUpperCase(),
    match_date: r.match_date || '',
    relay_no: r.relay_no === undefined || r.relay_no === null ? '' : String(r.relay_no),
    lane_no: r.lane_no === undefined || r.lane_no === null ? '' : String(r.lane_no),
    fee: r.fee === undefined || r.fee === null ? '' : String(r.fee),
    status: r.status || 'paid',
    payment_mode: r.payment_mode || (source === 'walkin' ? 'cash' : 'offline'),
    bib_no: r.bib_no === undefined || r.bib_no === null ? '' : String(r.bib_no),
    notes: r.notes || '',
    source
  };
  if (p.full_name.length < 2) throw new HttpError(400, 'Name is required');
  if (!/^\d{10}$/.test(phone)) throw new HttpError(400, `Invalid mobile "${r.phone || r.mobile || ''}"`);
  if (!p.event_code) throw new HttpError(400, 'Event code is required');
  if (p.match_date && !/^\d{4}-\d{2}-\d{2}$/.test(p.match_date)) throw new HttpError(400, `Invalid date "${p.match_date}" (use YYYY-MM-DD)`);
  if (!['paid', 'pending', 'cancelled'].includes(p.status)) p.status = 'paid';
  return p;
}

// Same person (mobile + name) already entered in the same event? Stops double imports.
async function assertNotDuplicate(p) {
  const rows = await db.select('registrations',
    `phone=${eq(p.phone)}&event_code=${eq(p.event_code)}&status=in.(paid,pending)&select=full_name,reg_no,status`);
  const dupe = (rows || []).find(r => r.full_name.trim().toLowerCase() === p.full_name.trim().toLowerCase());
  if (dupe) throw new HttpError(409, `${p.full_name} is already entered in ${p.event_code} (${dupe.reg_no || dupe.status})`);
}

async function findRegByRef(ref) {
  if (ref.registration_id) return ref.registration_id;
  let filter = null;
  if (ref.bib_no !== undefined && ref.bib_no !== null && ref.bib_no !== '') filter = `bib_no=eq.${parseInt(ref.bib_no, 10)}`;
  else if (ref.reg_no) filter = `reg_no=${eq(String(ref.reg_no).trim().toUpperCase())}`;
  if (!filter) throw new HttpError(400, 'Bib number or Reg No is required');
  const rows = await db.select('registrations', `${filter}&status=eq.paid&select=id`);
  if (!rows || !rows.length) throw new HttpError(404, `No paid registration for ${ref.bib_no ? 'bib ' + ref.bib_no : ref.reg_no}`);
  return rows[0].id;
}

function scorePatch(s) {
  const patch = { updated_at: now() };
  for (const f of SCORE_FIELDS) if (f in s) patch[f] = scoreValue(s[f]);
  if ('inner_tens' in s) patch.inner_tens = parseInt(s.inner_tens, 10) || 0;
  if ('final_score' in s) patch.final_score = scoreValue(s.final_score);
  if ('rank_override' in s) patch.rank_override = s.rank_override === '' || s.rank_override === null ? null : parseInt(s.rank_override, 10);
  if ('remarks' in s) patch.remarks = s.remarks ? String(s.remarks).slice(0, 200) : null;
  if ('status' in s && s.status) {
    const st = String(s.status).toLowerCase();
    if (!['pending', 'shooting', 'finished', 'dns', 'dnf', 'dq'].includes(st)) throw new HttpError(400, `Invalid status "${s.status}"`);
    patch.status = st;
  }
  return patch;
}

const actions = {
  // ---------- dashboard ----------
  async dashboard() {
    const regs = await db.select('registrations', 'select=status,fee,event_group,match_date,relay_no,source,slot_issue,created_at');
    const recentPending = Date.now() - 30 * 60 * 1000;
    const stats = { paid: 0, pendingLive: 0, failed: 0, cancelled: 0, revenue: 0, online: 0, offline: 0, slotIssues: 0 };
    const byEvent = {};
    const bySlot = {};
    for (const r of regs || []) {
      if (r.status === 'paid') {
        stats.paid++;
        stats.revenue += r.fee || 0;
        if (r.source === 'online') stats.online++; else stats.offline++;
        if (r.slot_issue) stats.slotIssues++;
        byEvent[r.event_group || '—'] = (byEvent[r.event_group || '—'] || 0) + 1;
        const key = `${r.match_date}#${r.relay_no}`;
        bySlot[key] = (bySlot[key] || 0) + 1;
      } else if (r.status === 'pending' && new Date(r.created_at).getTime() > recentPending) stats.pendingLive++;
      else if (r.status === 'failed') stats.failed++;
      else if (r.status === 'cancelled') stats.cancelled++;
    }
    return { stats, byEvent, bySlot };
  },

  // ---------- settings ----------
  async 'settings.get'() {
    return { settings: await getSettings() };
  },
  async 'settings.save'({ data }) {
    if (!data || typeof data !== 'object') throw new HttpError(400, 'settings data required');
    const merged = { ...(await getSettings()), ...data };
    await db.update('app_settings', 'id=eq.1', { data: merged, updated_at: now() });
    await audit('settings.save', { keys: Object.keys(data) });
    return { settings: merged };
  },

  // ---------- events ----------
  async 'events.list'() {
    return { events: await db.select('events', 'select=*&order=sort.asc,code.asc') };
  },
  async 'events.save'({ event }) {
    const e = pick(event || {}, EVENT_FIELDS);
    e.code = String(e.code || '').trim().toUpperCase();
    if (!e.code || !e.event_group || !e.category) throw new HttpError(400, 'Code, event and category are required');
    if (!['Male', 'Female', 'All'].includes(e.gender)) throw new HttpError(400, 'Gender must be Male, Female or All');
    if (!['Rifle', 'Pistol'].includes(e.weapon)) throw new HttpError(400, 'Weapon must be Rifle or Pistol');
    e.fee = parseInt(e.fee, 10);
    e.shots = parseInt(e.shots, 10) || 60;
    e.sort = parseInt(e.sort, 10) || 0;
    if (!(e.fee >= 0)) throw new HttpError(400, 'Fee must be 0 or more');
    const rows = await db.insert('events', [e], { upsert: true, onConflict: 'code' });
    await audit('events.save', { code: e.code, fee: e.fee, active: e.active });
    return { event: rows[0] };
  },
  async 'events.delete'({ code }) {
    const used = await db.select('registrations', `event_code=${eq(code)}&select=id&limit=1`);
    if (used && used.length) throw new HttpError(409, 'This event already has registrations. Turn it off (inactive) instead of deleting.');
    await db.remove('events', `code=${eq(code)}`);
    await audit('events.delete', { code });
    return {};
  },

  // ---------- relays ----------
  async 'relays.list'() {
    return { relays: await db.select('relays', 'select=*&order=relay_no.asc') };
  },
  async 'relays.save'({ relay }) {
    const r = pick(relay || {}, RELAY_FIELDS);
    r.relay_no = parseInt(r.relay_no, 10);
    r.capacity = parseInt(r.capacity, 10) || 15;
    if (!r.relay_no || !r.name || !r.time_text || !r.reporting_text) throw new HttpError(400, 'Relay no, name, time and reporting time are required');
    const rows = await db.insert('relays', [r], { upsert: true, onConflict: 'relay_no' });
    await audit('relays.save', r);
    return { relay: rows[0] };
  },
  async 'relays.delete'({ relay_no }) {
    const used = await db.select('registrations', `relay_no=eq.${parseInt(relay_no, 10)}&status=in.(paid,pending)&select=id&limit=1`);
    if (used && used.length) throw new HttpError(409, 'Shooters are booked in this relay. Turn it off (inactive) or move them first.');
    await db.remove('relays', `relay_no=eq.${parseInt(relay_no, 10)}`);
    await audit('relays.delete', { relay_no });
    return {};
  },

  // ---------- registrations ----------
  async 'regs.list'() {
    const regs = await db.select('registrations', 'select=*,scores(*)&order=created_at.desc&limit=10000');
    return { registrations: regs };
  },
  async 'regs.create'({ reg }) {
    const p = regPayload(reg || {}, 'walkin');
    await assertNotDuplicate(p);
    const row = await withFriendly(db.rpc('admin_create_registration', { p }));
    if (p.bib_no) await db.rpc('sync_bib_seq');
    await audit('regs.create', { id: row.id, name: row.full_name, event: row.event_code });
    return { registration: row };
  },
  async 'regs.update'({ id, patch }) {
    if (!id) throw new HttpError(400, 'id required');
    const p = emptyToNull(pick(patch || {}, REG_EDITABLE));
    if ('phone' in p && p.phone) p.phone = normalizePhone(p.phone);
    if (p.event_code) {
      const ev = await db.select('events', `code=${eq(p.event_code)}&select=*`);
      if (!ev || !ev.length) throw new HttpError(400, 'Unknown event code');
      Object.assign(p, { event_group: ev[0].event_group, category: ev[0].category, weapon: ev[0].weapon, shots: ev[0].shots });
    }
    ['relay_no', 'lane_no', 'fee', 'bib_no'].forEach(k => { if (k in p && p[k] !== null) p[k] = parseInt(p[k], 10); });
    // Blank fee / bib in the form means "leave as is", never "erase"
    if (p.fee === null || Number.isNaN(p.fee)) delete p.fee;
    if (p.bib_no === null || Number.isNaN(p.bib_no)) delete p.bib_no;
    // Seat given without a lane -> pick the lowest free lane in that relay
    if (p.match_date && p.relay_no && (p.lane_no === null || p.lane_no === undefined || Number.isNaN(p.lane_no))) {
      p.lane_no = await db.rpc('free_lane', { p_date: p.match_date, p_relay: p.relay_no });
      if (p.lane_no === null) throw new HttpError(409, 'That relay is full on this day. Pick another relay or give a lane manually.');
    }
    if ('lane_no' in p || 'relay_no' in p) p.slot_issue = false;
    p.updated_at = now();
    const rows = await withFriendly(db.update('registrations', `id=${eq(id)}`, p));
    if ('bib_no' in p) await db.rpc('sync_bib_seq');
    await audit('regs.update', { id, fields: Object.keys(p) });
    return { registration: rows[0] };
  },
  async 'regs.setStatus'({ id, status, payment_mode, payment_id }) {
    if (!id) throw new HttpError(400, 'id required');
    let row;
    if (status === 'paid') {
      row = await withFriendly(db.rpc('confirm_registration', { p_id: id, p_payment_id: payment_id || null, p_mode: payment_mode || 'cash' }));
    } else if (['cancelled', 'refunded', 'pending', 'failed'].includes(status)) {
      const rows = await db.update('registrations', `id=${eq(id)}`, { status, updated_at: now() });
      row = rows[0];
    } else throw new HttpError(400, 'Invalid status');
    await audit('regs.setStatus', { id, status, payment_mode });
    return { registration: row };
  },
  async 'regs.delete'({ id }) {
    const rows = await db.remove('registrations', `id=${eq(id)}`);
    await audit('regs.delete', { id, name: rows && rows[0] && rows[0].full_name, reg_no: rows && rows[0] && rows[0].reg_no });
    return {};
  },
  async 'regs.import'({ rows }) {
    if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, 'No rows to import');
    if (rows.length > 300) throw new HttpError(400, 'Send at most 300 rows per batch');
    const results = [];
    let usedBib = false;
    for (let i = 0; i < rows.length; i++) {
      try {
        const p = regPayload(rows[i], 'import');
        await assertNotDuplicate(p);
        if (p.bib_no) usedBib = true;
        const row = await withFriendly(db.rpc('admin_create_registration', { p }));
        results.push({ row: rows[i].__row || i + 1, ok: true, reg_no: row.reg_no, bib_no: row.bib_no, lane_no: row.lane_no });
      } catch (err) {
        results.push({ row: rows[i].__row || i + 1, ok: false, error: err.message });
      }
    }
    if (usedBib) await db.rpc('sync_bib_seq');
    await audit('regs.import', { total: rows.length, ok: results.filter(r => r.ok).length });
    return { results };
  },
  async reconcile() {
    // Re-check unconfirmed online orders from the last 7 days directly with Razorpay
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const regs = await db.select('registrations',
      `status=in.(pending,expired,failed)&rzp_order_id=not.is.null&created_at=gte.${since}&select=id,rzp_order_id,full_name&order=created_at.desc&limit=60`);
    const out = { checked: 0, confirmed: [], notPaid: 0, problems: [] };
    for (const r of regs || []) {
      out.checked++;
      try {
        const result = await confirmOrder(r.rzp_order_id, 'reconcile');
        if (result.ok) out.confirmed.push(r.full_name);
        else if (result.reason === 'AMOUNT_MISMATCH') out.problems.push(`${r.full_name}: amount mismatch`);
        else out.notPaid++;
      } catch (err) {
        out.problems.push(`${r.full_name}: ${err.message}`);
      }
    }
    await audit('reconcile', { checked: out.checked, confirmed: out.confirmed.length });
    return out;
  },

  // ---------- scores ----------
  async 'scores.save'({ score }) {
    const s = score || {};
    const id = await findRegByRef(s);
    const patch = scorePatch(s);
    const rows = await db.insert('scores', [{ registration_id: id, ...patch }], { upsert: true, onConflict: 'registration_id' });
    return { score: rows[0] };
  },
  async 'scores.import'({ rows }) {
    if (!Array.isArray(rows) || !rows.length) throw new HttpError(400, 'No rows to import');
    if (rows.length > 500) throw new HttpError(400, 'Send at most 500 rows per batch');
    // Resolve all bibs / reg nos in one query
    const paid = await db.select('registrations', 'status=eq.paid&select=id,bib_no,reg_no');
    const byBib = new Map((paid || []).map(r => [String(r.bib_no), r.id]));
    const byReg = new Map((paid || []).map(r => [String(r.reg_no || '').toUpperCase(), r.id]));
    const upserts = [];
    const results = [];
    rows.forEach((r, i) => {
      const rowNo = r.__row || i + 1;
      try {
        const id = (r.bib_no !== undefined && r.bib_no !== '' && byBib.get(String(parseInt(r.bib_no, 10))))
          || (r.reg_no && byReg.get(String(r.reg_no).trim().toUpperCase()));
        if (!id) throw new Error(`No paid registration for bib "${r.bib_no ?? ''}" / reg "${r.reg_no ?? ''}"`);
        upserts.push({ registration_id: id, ...scorePatch(r) });
        results.push({ row: rowNo, ok: true });
      } catch (err) {
        results.push({ row: rowNo, ok: false, error: err.message });
      }
    });
    // PostgREST bulk upsert needs identical keys in every row
    const keys = [...new Set(upserts.flatMap(u => Object.keys(u)))];
    const uniform = upserts.map(u => Object.fromEntries(keys.map(k => [k, k in u ? u[k] : (k === 'inner_tens' ? 0 : (k === 'status' ? 'finished' : null))])));
    if (uniform.length) await db.insert('scores', uniform, { upsert: true, onConflict: 'registration_id' });
    await audit('scores.import', { total: rows.length, ok: uniform.length });
    return { results };
  },

  // ---------- backup ----------
  async 'backup.export'() {
    const [settings, events, relays, registrations, scores] = await Promise.all([
      db.select('app_settings', 'select=*'),
      db.select('events', 'select=*'),
      db.select('relays', 'select=*'),
      db.select('registrations', 'select=*&limit=20000'),
      db.select('scores', 'select=registration_id,s1,s2,s3,s4,s5,s6,inner_tens,final_score,status,rank_override,remarks,updated_at&limit=20000')
    ]);
    await audit('backup.export', { registrations: registrations.length });
    return { backup: { app: 'NexShot Championship Portal', version: 3, exportedAt: now(), settings, events, relays, registrations, scores } };
  },
  async 'backup.restore'({ backup }) {
    if (!backup || backup.version !== 3) throw new HttpError(400, 'This is not a valid v3 backup file.');
    const counts = {};
    if (backup.settings && backup.settings[0]) {
      await db.update('app_settings', 'id=eq.1', { data: backup.settings[0].data, updated_at: now() });
      counts.settings = 1;
    }
    for (const [table, conflict] of [['events', 'code'], ['relays', 'relay_no'], ['registrations', 'id'], ['scores', 'registration_id']]) {
      const rows = (backup[table] || []).map(r => {
        const copy = { ...r };
        delete copy.total; // generated column
        return copy;
      });
      for (let i = 0; i < rows.length; i += 500) {
        await db.insert(table, rows.slice(i, i + 500), { upsert: true, onConflict: conflict });
      }
      counts[table] = rows.length;
    }
    await db.rpc('sync_bib_seq');
    await audit('backup.restore', counts);
    return { counts };
  },
  async 'audit.list'() {
    const [auditRows, payments] = await Promise.all([
      db.select('admin_audit', 'select=*&order=at.desc&limit=200'),
      db.select('payment_events', 'select=*&order=received_at.desc&limit=200')
    ]);
    return { audit: auditRows, payments };
  }
};

export default handler(async (req, res) => {
  if (!onlyMethods(req, res, ['POST'])) return;
  const { json } = await readBody(req);
  const action = String(json.action || '');

  if (action === 'login') {
    if (!checkPassword(json.password)) {
      await new Promise(r => setTimeout(r, 700)); // slow down guessing
      await audit('login.failed', { ip: req.headers['x-forwarded-for'] || null });
      return fail(res, 401, 'Wrong password.');
    }
    await audit('login.ok', { ip: req.headers['x-forwarded-for'] || null });
    return send(res, 200, { success: true, token: issueToken() });
  }

  requireAdmin(req);
  const fn = actions[action];
  if (!fn) return fail(res, 400, `Unknown action "${action}"`);
  const result = await fn(json);
  send(res, 200, { success: true, ...result });
});

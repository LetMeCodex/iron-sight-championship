// GET /api/track?mobile=9876543210 — all passes registered with that mobile number.
// Returns only pass details (no email / DOB / full phone).

import { db, eq } from './_lib/db.js';
import { fail, getQuery, handler, onlyMethods, send } from './_lib/http.js';
import { normalizePhone, relaysMap, toPass } from './_lib/registrations.js';

export default handler(async (req, res) => {
  if (!onlyMethods(req, res, ['GET'])) return;
  const q = getQuery(req);
  const phone = normalizePhone(q.mobile || q.q || '');
  if (!/^[6-9]\d{9}$/.test(phone)) return fail(res, 400, 'Enter the 10-digit mobile number used during registration.');

  const rows = await db.select('registrations',
    `phone=${eq(phone)}&status=in.(paid,pending)&select=*&order=created_at.desc&limit=20`);
  // Hide abandoned checkouts: pending rows only matter for ~30 minutes
  const recent = Date.now() - 35 * 60 * 1000;
  const list = (rows || []).filter(r => r.status === 'paid' || new Date(r.created_at).getTime() > recent);
  if (!list.length) return fail(res, 404, 'No registration found for this mobile number.');

  const relays = await relaysMap();
  send(res, 200, { success: true, passes: list.map(r => toPass(r, relays)) });
});

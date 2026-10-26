// POST /api/create-order
// 1. Validates the athlete, 2. holds a seat in the chosen relay (30 min),
// 3. creates a Razorpay order for the fee stored in the database (never the browser's amount).

import { db, eq, friendlyDbError } from './_lib/db.js';
import { fail, handler, HttpError, onlyMethods, readBody, send } from './_lib/http.js';
import { createOrder, publicKeyId } from './_lib/razorpay.js';
import { getSettings, registrationClosedReason, relaysMap, toPass, validateAthlete } from './_lib/registrations.js';

export default handler(async (req, res) => {
  if (!onlyMethods(req, res, ['POST'])) return;
  const { json } = await readBody(req);
  const athlete = validateAthlete(json);

  const settings = await getSettings();
  const closed = registrationClosedReason(settings);
  if (closed) return fail(res, 403, closed);
  const days = Array.isArray(settings.matchDays) ? settings.matchDays : [];
  if (days.length && !days.includes(athlete.match_date)) return fail(res, 400, 'Please pick one of the official match dates.');

  // Same athlete (phone + name) already paid for this exact event?
  const dupes = await db.select('registrations',
    `phone=${eq(athlete.phone)}&event_code=${eq(athlete.event_code)}&status=eq.paid&select=id,full_name,reg_no`);
  const dupe = (dupes || []).find(d => d.full_name.trim().toLowerCase() === athlete.full_name.toLowerCase());
  if (dupe) {
    return fail(res, 409, `${athlete.full_name} is already registered for this event (${dupe.reg_no}). Use "Track Booking" to see the pass.`);
  }

  // Anti-hoarding: unpaid seat holds are capped per mobile and per network (IP),
  // so nobody can block whole relays with fake checkouts.
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const [byPhone, byIp] = await Promise.all([
    db.select('registrations', `phone=${eq(athlete.phone)}&status=eq.pending&created_at=gte.${since}&select=id`),
    ip ? db.select('registrations', `client_ip=${eq(ip)}&status=eq.pending&created_at=gte.${since}&select=id`) : []
  ]);
  if ((byPhone || []).length >= 3 || (byIp || []).length >= 10) {
    return fail(res, 429, 'Too many unfinished payments. Please complete or wait 30 minutes before trying again.');
  }

  let reg;
  try {
    reg = await db.rpc('reserve_registration', { p: { ...athlete, client_ip: ip } });
  } catch (err) {
    const friendly = friendlyDbError(err);
    if (friendly) throw new HttpError(409, friendly);
    throw err;
  }

  // Free events (fee 0) are confirmed immediately.
  if (!reg.fee) {
    const confirmed = await db.rpc('confirm_registration', { p_id: reg.id, p_payment_id: null, p_mode: 'free' });
    return send(res, 200, { success: true, free: true, pass: toPass(confirmed, await relaysMap()) });
  }

  let order;
  try {
    order = await createOrder({
      amountPaise: reg.fee * 100,
      receipt: reg.id,
      notes: {
        registration_id: reg.id,
        athlete: reg.full_name,
        phone: reg.phone,
        event_code: reg.event_code,
        match_date: reg.match_date,
        relay: String(reg.relay_no)
      }
    });
  } catch (err) {
    await db.update('registrations', `id=${eq(reg.id)}`, { status: 'cancelled', notes: 'Order creation failed', updated_at: new Date().toISOString() });
    throw err;
  }

  await db.update('registrations', `id=${eq(reg.id)}`, { rzp_order_id: order.id, updated_at: new Date().toISOString() });

  send(res, 200, {
    success: true,
    keyId: publicKeyId(),
    orderId: order.id,
    amount: order.amount,
    currency: order.currency,
    fee: reg.fee,
    registrationId: reg.id,
    lane: reg.lane_no
  });
});

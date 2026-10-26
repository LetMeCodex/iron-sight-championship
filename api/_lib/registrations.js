// Shared registration logic: validation, payment confirmation, pass formatting.

import { db, eq } from './db.js';
import { HttpError } from './http.js';
import { fetchOrderPayments, isPaid } from './razorpay.js';

const clean = (v, max = 120) => String(v == null ? '' : v).replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

export function normalizePhone(v) {
  const digits = String(v || '').replace(/\D/g, '');
  return digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
}

// Validate athlete input coming from the public form. Throws HttpError(400) with a clear message.
export function validateAthlete(input) {
  const a = {
    full_name: clean(input.fullName || input.full_name, 80),
    father_name: clean(input.fatherName || input.father_name, 80),
    gender: clean(input.gender, 10),
    dob: clean(input.dob, 10),
    phone: normalizePhone(input.phone || input.mobile),
    email: clean(input.email, 120).toLowerCase(),
    state: clean(input.state, 60),
    club_name: clean(input.clubName || input.club_name || input.school, 120),
    event_code: clean(input.eventCode || input.event_code, 20),
    match_date: clean(input.matchDate || input.match_date, 10),
    relay_no: parseInt(input.relayNo || input.relay_no, 10)
  };

  if (a.full_name.length < 2) throw new HttpError(400, 'Please enter the athlete\'s full name.');
  if (!['Male', 'Female'].includes(a.gender)) throw new HttpError(400, 'Please select gender.');
  if (!/^[6-9]\d{9}$/.test(a.phone)) throw new HttpError(400, 'Please enter a valid 10-digit Indian mobile number.');
  if (a.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email)) throw new HttpError(400, 'Please enter a valid email address.');
  if (a.dob) {
    const d = new Date(a.dob);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.dob) || isNaN(d) || d.getFullYear() < 1930 || d > new Date()) {
      throw new HttpError(400, 'Please enter a valid date of birth.');
    }
  }
  if (!a.event_code) throw new HttpError(400, 'Please select event and category.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a.match_date)) throw new HttpError(400, 'Please select a match date.');
  if (!Number.isInteger(a.relay_no) || a.relay_no < 1) throw new HttpError(400, 'Please select a relay.');
  return a;
}

export async function getSettings() {
  const rows = await db.select('app_settings', 'id=eq.1&select=data');
  return (rows && rows[0] && rows[0].data) || {};
}

export function registrationClosedReason(settings) {
  if (settings.maintenanceMode) return 'The portal is under maintenance. Please try again shortly.';
  if (settings.registrationOpen === false) return 'Registrations are closed.';
  if (settings.registrationDeadline) {
    const deadline = new Date(`${settings.registrationDeadline}${settings.registrationDeadline.length <= 10 ? 'T23:59:59' : ''}+05:30`);
    if (!isNaN(deadline) && Date.now() > deadline.getTime()) return 'The registration deadline has passed.';
  }
  return null;
}

export async function logPaymentEvent(source, eventType, orderId, paymentId, payload) {
  try {
    await db.insert('payment_events', [{ source, event_type: eventType, order_id: orderId, payment_id: paymentId, payload }]);
  } catch (e) {
    console.error('[payment_events] log failed', e.message);
  }
}

// Single source of truth for "is this order paid?": ask Razorpay directly.
// Used by the browser callback, the webhook and the admin "reconcile" button,
// so a registration is confirmed even if the athlete closes the browser.
export async function confirmOrder(orderId, source) {
  const rows = await db.select('registrations', `rzp_order_id=${eq(orderId)}&select=*`);
  const reg = rows && rows[0];
  if (!reg) return { ok: false, reason: 'NO_REGISTRATION' };
  if (reg.status === 'paid') return { ok: true, registration: reg, already: true };

  const payments = await fetchOrderPayments(orderId);
  const paid = payments.find(isPaid);
  if (!paid) {
    const failed = payments.length > 0 && payments.every(p => p.status === 'failed');
    if (failed && reg.status === 'pending') {
      await db.update('registrations', `id=${eq(reg.id)}&status=eq.pending`, { status: 'failed', updated_at: new Date().toISOString() });
    }
    return { ok: false, reason: failed ? 'PAYMENT_FAILED' : 'NOT_PAID_YET' };
  }

  const expectedPaise = Number(reg.fee) * 100;
  if (Number(paid.amount) !== expectedPaise) {
    await logPaymentEvent(source, 'amount_mismatch', orderId, paid.id, { expected: expectedPaise, got: paid.amount });
    await db.update('registrations', `id=${eq(reg.id)}`, {
      notes: `AMOUNT MISMATCH: paid ${paid.amount / 100}, fee ${reg.fee}. Check in Razorpay.`,
      updated_at: new Date().toISOString()
    });
    return { ok: false, reason: 'AMOUNT_MISMATCH' };
  }

  const confirmed = await db.rpc('confirm_registration', { p_id: reg.id, p_payment_id: paid.id, p_mode: 'razorpay' });
  await logPaymentEvent(source, 'confirmed', orderId, paid.id, { method: paid.method, amount: paid.amount });
  return { ok: true, registration: confirmed };
}

export function maskPhone(p) {
  const s = String(p || '');
  return s.length >= 10 ? `${s.slice(0, 2)}******${s.slice(-2)}` : s;
}

// What the athlete sees on the pass / success screen. No email, DOB or full phone.
export function toPass(reg, relaysByNo = {}) {
  const relay = relaysByNo[reg.relay_no] || {};
  return {
    regNo: reg.reg_no,
    bibNo: reg.bib_no,
    name: reg.full_name,
    fatherName: reg.father_name,
    gender: reg.gender,
    club: reg.club_name,
    eventCode: reg.event_code,
    event: reg.event_group,
    category: reg.category,
    shots: reg.shots,
    matchDate: reg.match_date,
    relayNo: reg.relay_no,
    relayName: relay.name || (reg.relay_no ? `Relay ${String(reg.relay_no).padStart(2, '0')}` : null),
    relayTime: relay.time_text || null,
    reporting: relay.reporting_text || null,
    lane: reg.lane_no,
    status: reg.status,
    slotIssue: reg.slot_issue,
    fee: reg.fee,
    paymentId: reg.rzp_payment_id,
    phoneMasked: maskPhone(reg.phone)
  };
}

export async function relaysMap() {
  const relays = await db.select('relays', 'select=*');
  return Object.fromEntries((relays || []).map(r => [r.relay_no, r]));
}

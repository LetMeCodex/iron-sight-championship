// Razorpay REST calls + signature checks (no SDK needed).

import crypto from 'node:crypto';
import { HttpError } from './http.js';

function creds() {
  const keyId = process.env.RAZORPAY_KEY_ID || '';
  const secret = process.env.RAZORPAY_KEY_SECRET || '';
  if (!keyId || !secret) throw new HttpError(503, 'Payment gateway is not configured.');
  return { keyId, secret };
}

// RAZORPAY_API_BASE only exists so the local test suite can point at a fake gateway.
const API_BASE = (process.env.RAZORPAY_API_BASE || 'https://api.razorpay.com/v1').replace(/\/+$/, '');

async function rzp(path, { method = 'GET', body } = {}) {
  const { keyId, secret } = creds();
  const res = await fetch(`${API_BASE}/${path}`, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${keyId}:${secret}`).toString('base64'),
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data.error && data.error.description) || `Razorpay error ${res.status}`;
    throw new HttpError(res.status === 401 ? 503 : 502, msg);
  }
  return data;
}

export function publicKeyId() {
  return creds().keyId;
}

export function createOrder({ amountPaise, receipt, notes }) {
  return rzp('orders', {
    method: 'POST',
    body: { amount: amountPaise, currency: 'INR', receipt: String(receipt).slice(0, 40), notes, payment_capture: 1 }
  });
}

export function fetchOrder(orderId) {
  return rzp(`orders/${encodeURIComponent(orderId)}`);
}

export async function fetchOrderPayments(orderId) {
  const data = await rzp(`orders/${encodeURIComponent(orderId)}/payments`);
  return Array.isArray(data.items) ? data.items : [];
}

export function fetchPayment(paymentId) {
  return rzp(`payments/${encodeURIComponent(paymentId)}`);
}

// A payment counts as successful once captured (auto-capture is on via payment_capture: 1).
// "authorized" is accepted too: money is blocked and Razorpay auto-captures it.
export function isPaid(payment) {
  return payment && (payment.status === 'captured' || payment.status === 'authorized');
}

function safeEqualHex(a, b) {
  const ab = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function verifyCheckoutSignature(orderId, paymentId, signature) {
  const { secret } = creds();
  const expected = crypto.createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');
  return safeEqualHex(expected, signature || '');
}

export function verifyWebhookSignature(rawBody, signature) {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
  if (!secret || !rawBody || !signature) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  return safeEqualHex(expected, signature);
}

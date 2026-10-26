// Admin login: password from env ADMIN_PASSWORD, short-lived HMAC-signed token.

import crypto from 'node:crypto';
import { HttpError } from './http.js';

const TOKEN_HOURS = 12;

function secret() {
  const s = process.env.ADMIN_SESSION_SECRET || '';
  if (s.length < 32) throw new HttpError(503, 'ADMIN_SESSION_SECRET is not configured (min 32 chars).');
  return s;
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

export function checkPassword(input) {
  const expected = process.env.ADMIN_PASSWORD || '';
  if (expected.length < 8) throw new HttpError(503, 'ADMIN_PASSWORD is not configured (min 8 chars).');
  // Compare hashes so length differences don't leak timing
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function issueToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + TOKEN_HOURS * 3600 * 1000 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function requireAdmin(req) {
  const header = req.headers['authorization'] || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const [payload, sig] = token.split('.');
  if (!payload || !sig) throw new HttpError(401, 'Login required.');
  const expected = sign(payload);
  const ok = expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
  if (!ok) throw new HttpError(401, 'Session invalid. Please log in again.');
  let data;
  try {
    data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch (e) {
    throw new HttpError(401, 'Session invalid. Please log in again.');
  }
  if (!data.exp || data.exp < Date.now()) throw new HttpError(401, 'Session expired. Please log in again.');
  return data;
}

// Minimal Supabase (PostgREST) client using the service_role key.
// The service key lives ONLY in Vercel environment variables, never in the browser.

import { HttpError } from './http.js';

function config() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new HttpError(503, 'Database is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing).');
  }
  return { url, key };
}

async function request(path, { method = 'GET', body, prefer, timeoutMs = 8000 } = {}) {
  const { url, key } = config();
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;

  let lastErr;
  // Retry GETs once on network failure; never blindly retry writes.
  const attempts = method === 'GET' ? 2 : 1;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(`${url}/rest/v1/${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs)
      });
      const text = await res.text();
      const data = text ? JSON.parse(text) : null;
      if (!res.ok) {
        const msg = (data && (data.message || data.error || data.hint)) || `Database error ${res.status}`;
        const err = new HttpError(res.status >= 500 ? 502 : 400, msg);
        err.dbCode = data && data.code;
        throw err;
      }
      return data;
    } catch (err) {
      lastErr = err;
      if (err instanceof HttpError) throw err;
    }
  }
  console.error('[db] request failed:', path, lastErr);
  throw new HttpError(503, 'Database is temporarily unreachable. Please try again.');
}

export const db = {
  select: (table, query = '') => request(`${table}${query ? `?${query}` : ''}`),
  insert: (table, rows, { upsert = false, onConflict } = {}) =>
    request(`${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`, {
      method: 'POST',
      body: rows,
      prefer: `return=representation${upsert ? ',resolution=merge-duplicates' : ''}`
    }),
  update: (table, filter, patch) =>
    request(`${table}?${filter}`, { method: 'PATCH', body: patch, prefer: 'return=representation' }),
  remove: (table, filter) =>
    request(`${table}?${filter}`, { method: 'DELETE', prefer: 'return=representation' }),
  rpc: (fn, args = {}) => request(`rpc/${fn}`, { method: 'POST', body: args })
};

// Translate the RAISE EXCEPTION codes from schema.sql into friendly messages.
const FRIENDLY = {
  EVENT_NOT_AVAILABLE: 'This event/category is not open for registration.',
  GENDER_MISMATCH: 'This category does not match the selected gender.',
  RELAY_NOT_AVAILABLE: 'This relay is not available. Please pick another relay.',
  RELAY_FULL: 'Sorry, this relay just got full. Please pick another relay or date.',
  REGISTRATION_NOT_FOUND: 'Registration not found.'
};

export function friendlyDbError(err) {
  const msg = String(err && err.message || '');
  for (const [code, text] of Object.entries(FRIENDLY)) {
    if (msg.includes(code)) return text;
  }
  return null;
}

export function eq(v) {
  return `eq.${encodeURIComponent(v)}`;
}

export async function audit(action, detail) {
  try {
    await db.insert('admin_audit', [{ action, detail }]);
  } catch (e) {
    console.error('[audit] failed', e.message);
  }
}

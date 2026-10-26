// Small request/response helpers that work both on Vercel and in local server.js.
// They never depend on Vercel's req.body / res.json helpers being present.

export function send(res, status, data, headers = {}) {
  if (res.writableEnded) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (!('Cache-Control' in headers)) res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

export function fail(res, status, error, extra = {}) {
  send(res, status, { success: false, error, ...extra });
}

export function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try {
    return Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
  } catch (e) {
    return {};
  }
}

// Returns { raw, json }. `raw` is the exact request body text when we can get it
// (needed for webhook signatures); `json` is the parsed object or {}.
export async function readBody(req) {
  if (typeof req.rawBody === 'string') {
    return { raw: req.rawBody, json: safeParse(req.rawBody) };
  }
  // Vercel helpers may already have parsed the body
  if (req.body !== undefined && req.body !== null) {
    if (typeof req.body === 'string') return { raw: req.body, json: safeParse(req.body) };
    if (Buffer.isBuffer(req.body)) {
      const raw = req.body.toString('utf8');
      return { raw, json: safeParse(raw) };
    }
    if (typeof req.body === 'object') return { raw: null, json: req.body };
  }
  const raw = await new Promise((resolve, reject) => {
    let data = '';
    req.setEncoding && req.setEncoding('utf8');
    req.on('data', c => {
      data += c;
      if (data.length > 2_000_000) reject(new Error('Body too large'));
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
  return { raw, json: safeParse(raw) };
}

function safeParse(text) {
  if (!text) return {};
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' ? v : {};
  } catch (e) {
    return {};
  }
}

export function onlyMethods(req, res, methods) {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Allow', methods.join(', '));
    res.end();
    return false;
  }
  if (!methods.includes(req.method)) {
    fail(res, 405, `Method not allowed. Use ${methods.join(' or ')}.`);
    return false;
  }
  return true;
}

// Wrap a handler so an unexpected crash still returns JSON (and is logged).
export function handler(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error('[api] server error:', err);
      fail(res, status, status === 500 ? 'Server error. Please try again in a moment.' : err.message);
    }
  };
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

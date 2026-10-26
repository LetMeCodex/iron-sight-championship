// GET /api/slots?date=YYYY-MM-DD — seats taken per relay on a match day.

import { db } from './_lib/db.js';
import { fail, getQuery, handler, onlyMethods, send } from './_lib/http.js';

export default handler(async (req, res) => {
  if (!onlyMethods(req, res, ['GET'])) return;
  const { date } = getQuery(req);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return fail(res, 400, 'date=YYYY-MM-DD is required');

  const rows = await db.rpc('relay_occupancy', { p_date: date });
  const taken = Object.fromEntries((rows || []).map(r => [r.relay_no, r.taken]));
  send(res, 200, { success: true, date, taken }, {
    'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=20'
  });
});

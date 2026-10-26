// GET /api/cron — run daily by Vercel Cron (see vercel.json).
// Keeps the Supabase free project active (free projects pause after 7 days of no activity)
// and re-checks any unconfirmed online payments as a second safety net.

import { db } from './_lib/db.js';
import { fail, handler, send } from './_lib/http.js';
import { confirmOrder } from './_lib/registrations.js';

export default handler(async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers['authorization'] !== `Bearer ${secret}`) return fail(res, 401, 'Unauthorized');

  const settings = await db.select('app_settings', 'id=eq.1&select=updated_at');

  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const pending = await db.select('registrations',
    `status=in.(pending,expired)&rzp_order_id=not.is.null&created_at=gte.${since}&select=rzp_order_id&limit=40`);
  let confirmed = 0;
  for (const r of pending || []) {
    try {
      const result = await confirmOrder(r.rzp_order_id, 'cron');
      if (result.ok && !result.already) confirmed++;
    } catch (e) {
      console.error('[cron] reconcile failed', r.rzp_order_id, e.message);
    }
  }
  send(res, 200, { success: true, db: settings ? 'ok' : 'empty', checked: (pending || []).length, confirmed });
});

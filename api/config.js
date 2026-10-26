// GET /api/config — public tournament settings, open events (with fees) and relays.
// Cached on Vercel's CDN, so thousands of visitors cost only a few DB reads per minute.

import { db } from './_lib/db.js';
import { handler, onlyMethods, send } from './_lib/http.js';
import { getSettings } from './_lib/registrations.js';

export default handler(async (req, res) => {
  if (!onlyMethods(req, res, ['GET'])) return;

  const [settings, events, relays] = await Promise.all([
    getSettings(),
    db.select('events', 'active=is.true&select=code,event_group,category,gender,weapon,age_limit,shots,target,fee,sort&order=sort.asc,code.asc'),
    db.select('relays', 'active=is.true&select=relay_no,name,type,match_title,time_text,reporting_text,duration,capacity&order=relay_no.asc')
  ]);

  send(res, 200, { success: true, settings, events, relays, generatedAt: new Date().toISOString() }, {
    'Cache-Control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=120'
  });
});

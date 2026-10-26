// GET /api/scores — public results/leaderboard (no personal data).
// CDN-cached for 5s: 1000+ people watching live costs ~12 DB reads per minute.

import { db } from './_lib/db.js';
import { handler, onlyMethods, send } from './_lib/http.js';
import { getSettings } from './_lib/registrations.js';

export default handler(async (req, res) => {
  if (!onlyMethods(req, res, ['GET'])) return;
  const cache = { 'Cache-Control': 'public, max-age=0, s-maxage=5, stale-while-revalidate=30' };

  const settings = await getSettings();
  if (settings.resultsPublic === false) {
    return send(res, 200, { success: true, published: false, scores: [] }, cache);
  }

  const rows = await db.select('public_results', 'select=*&order=total.desc,inner_tens.desc&limit=5000');
  const scores = (rows || []).map(r => ({
    bib: r.bib_no,
    regNo: r.reg_no,
    name: r.full_name,
    club: r.club_name,
    gender: r.gender,
    eventCode: r.event_code,
    event: r.event_group,
    category: r.category,
    weapon: r.weapon,
    shots: r.shots,
    matchDate: r.match_date,
    relayNo: r.relay_no,
    lane: r.lane_no,
    s1: num(r.s1), s2: num(r.s2), s3: num(r.s3), s4: num(r.s4), s5: num(r.s5), s6: num(r.s6),
    total: num(r.total),
    x10: r.inner_tens || 0,
    finalScore: num(r.final_score),
    status: r.status,
    rankOverride: r.rank_override,
    remarks: r.remarks,
    updatedAt: r.updated_at
  }));

  send(res, 200, { success: true, published: true, cachedAt: new Date().toISOString(), count: scores.length, scores }, cache);
});

function num(v) {
  return v === null || v === undefined ? null : Number(v);
}

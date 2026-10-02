// Vercel Serverless Edge API: /api/scores
// Protects Supabase Free Tier by caching leaderboard responses on Vercel's Edge CDN
// Max 1 database hit per 5 seconds, even with 1,000+ simultaneous users!

const SUPABASE_URL = "https://ltsfadnajhxvwhzexktt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0c2ZhZG5hamh4dndoemV4a3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTc4MDMsImV4cCI6MjA5NTk5MzgwM30.TF7KyvO_ySDduXzMv5TK3FYjpY36N2yz-8vC0IlvidY";

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Set Edge Caching: 5s fresh on CDN, 10s stale-while-revalidate
  res.setHeader(
    'Cache-Control',
    'public, s-maxage=5, stale-while-revalidate=10, max-age=5'
  );

  try {
    const fetchUrl = `${SUPABASE_URL}/rest/v1/scores?select=*,competitor:competitors(*)&order=total_score.desc,inner_tens.desc`;
    const response = await fetch(fetchUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Supabase returned status ${response.status}`);
    }

    const data = await response.json();

    return res.status(200).json({
      success: true,
      cached_at: new Date().toISOString(),
      count: data.length,
      scores: data
    });
  } catch (error) {
    console.error('Error fetching scores from Supabase:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}

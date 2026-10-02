// Vercel Serverless API: /api/track
// Quick lookup by Mobile, Bib Number, or Registration Number

const SUPABASE_URL = "https://ltsfadnajhxvwhzexktt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0c2ZhZG5hamh4dndoemV4a3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTc4MDMsImV4cCI6MjA5NTk5MzgwM30.TF7KyvO_ySDduXzMv5TK3FYjpY36N2yz-8vC0IlvidY";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const query = (req.query.q || req.query.mobile || '').trim();
  if (!query) {
    return res.status(400).json({ success: false, error: 'Query parameter "q" or "mobile" required' });
  }

  try {
    // Search by phone OR registration_no OR bib_no
    let filterQuery = `phone.eq.${encodeURIComponent(query)}`;
    if (query.toUpperCase().startsWith('NSC-')) {
      filterQuery = `registration_no.eq.${encodeURIComponent(query.toUpperCase())}`;
    } else if (!isNaN(parseInt(query)) && parseInt(query) < 9999) {
      filterQuery = `or=(phone.eq.${encodeURIComponent(query)},bib_no.eq.${parseInt(query)})`;
    }

    const fetchUrl = `${SUPABASE_URL}/rest/v1/competitors?${filterQuery}&select=*,scores(*)&limit=5`;
    const response = await fetch(fetchUrl, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });

    if (!response.ok) {
      throw new Error(`Supabase error: ${response.status}`);
    }

    const results = await response.json();

    if (results.length === 0) {
      return res.status(404).json({ success: false, message: 'No competitor pass found for this search' });
    }

    return res.status(200).json({
      success: true,
      competitor: results[0],
      all: results
    });
  } catch (error) {
    console.error('Track API error:', error);
    return res.status(500).json({ success: false, error: error.message || 'Lookup failed' });
  }
}

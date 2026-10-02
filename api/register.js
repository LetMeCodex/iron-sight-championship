// Vercel Serverless API: /api/register
// Validates athlete entry, assigns next Bib & Reg No, assigns lane, and persists to Supabase

const SUPABASE_URL = "https://ltsfadnajhxvwhzexktt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0c2ZhZG5hamh4dndoemV4a3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTc4MDMsImV4cCI6MjA5NTk5MzgwM30.TF7KyvO_ySDduXzMv5TK3FYjpY36N2yz-8vC0IlvidY";

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const body = req.body || {};
    const {
      fullName,
      fatherName,
      gender,
      dob,
      phone,
      email,
      state,
      clubName,
      weapon,
      eventCategory,
      ageCategory,
      relayNo,
      targetLane,
      matchDate,
      reportingTime,
      paymentRef,
      paymentAmount
    } = body;

    if (!fullName || !phone || !gender || !weapon) {
      return res.status(400).json({ success: false, error: 'Missing required athlete fields' });
    }

    // 1. Fetch current max bib number to assign next bib
    const bibRes = await fetch(`${SUPABASE_URL}/rest/v1/competitors?select=bib_no&order=bib_no.desc&limit=1`, {
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    const latestBib = await bibRes.json();
    const nextBib = (latestBib && latestBib.length > 0 && latestBib[0].bib_no) ? latestBib[0].bib_no + 1 : 110;
    const regNo = `NSC-2026-${nextBib}`;

    // 2. Insert new competitor
    const competitorPayload = {
      registration_no: regNo,
      bib_no: nextBib,
      full_name: fullName.trim(),
      father_name: (fatherName || '').trim(),
      gender: gender === 'Male' ? 'Men' : (gender === 'Female' ? 'Women' : gender),
      dob: dob || null,
      phone: phone.trim(),
      email: (email || '').trim(),
      state: state || 'Uttar Pradesh',
      club_name: clubName || 'BBC Shooting Academy',
      weapon: weapon.includes('Pistol') ? '10M Air Pistol' : '10M Air Rifle',
      event_category: (eventCategory && eventCategory.includes('NR')) ? 'National Rules (NR)' : 'ISSF',
      age_category: ageCategory || 'Senior',
      relay_no: relayNo ? parseInt(relayNo) : 1,
      target_lane: targetLane ? parseInt(targetLane) : ((nextBib % 9) + 1),
      match_date: matchDate || '2026-11-25',
      reporting_time: reportingTime || '08:00 AM',
      payment_status: paymentRef ? 'verified' : 'pending',
      payment_amount: paymentAmount || 1500.00,
      payment_ref: paymentRef || `ONLINE/${Date.now().toString().slice(-6)}`
    };

    const compInsertRes = await fetch(`${SUPABASE_URL}/rest/v1/competitors`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(competitorPayload)
    });

    if (!compInsertRes.ok) {
      const errText = await compInsertRes.text();
      throw new Error(`Failed to create competitor: ${errText}`);
    }

    const createdCompetitors = await compInsertRes.json();
    const createdComp = createdCompetitors[0];

    // 3. Create initial empty score card for this competitor
    const scorePayload = {
      competitor_id: createdComp.id,
      relay_no: createdComp.relay_no,
      series_1: 0.0,
      series_2: 0.0,
      series_3: 0.0,
      series_4: 0.0,
      series_5: 0.0,
      series_6: 0.0,
      inner_tens: 0,
      decimal_score: 0.0,
      status: 'shooting'
    };

    await fetch(`${SUPABASE_URL}/rest/v1/scores`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(scorePayload)
    });

    return res.status(201).json({
      success: true,
      message: 'Registration confirmed',
      competitor: createdComp
    });
  } catch (error) {
    console.error('Registration API Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Registration processing failed'
    });
  }
}

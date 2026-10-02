// Vercel Serverless API: /api/verify-payment
// Verifies Razorpay payment signature using HMAC-SHA256 and records competitor registration

import crypto from 'node:crypto';
import 'dotenv/config';

const SUPABASE_URL = "https://ltsfadnajhxvwhzexktt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0c2ZhZG5hamh4dndoemV4a3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTc4MDMsImV4cCI6MjA5NTk5MzgwM30.TF7KyvO_ySDduXzMv5TK3FYjpY36N2yz-8vC0IlvidY";

export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed. Use POST.' });
  }

  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key_secret) {
    console.error('RAZORPAY_KEY_SECRET missing from environment variables.');
    return res.status(500).json({
      success: false,
      error: 'Payment gateway configuration error: Secret key missing.'
    });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (err) {
        body = {};
      }
    }
    body = body || {};

    const {
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature,
      athleteData
    } = body;

    // Validate required fields
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: razorpay_order_id, razorpay_payment_id, and razorpay_signature are all required.'
      });
    }

    // Verify signature using HMAC-SHA256(order_id + "|" + payment_id, KEY_SECRET)
    const payload = `${razorpay_order_id}|${razorpay_payment_id}`;
    const expectedSignature = crypto
      .createHmac('sha256', key_secret)
      .update(payload)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSignature, 'utf-8');
    const receivedBuf = Buffer.from(razorpay_signature, 'utf-8');

    let isValid = false;
    if (expectedBuf.length === receivedBuf.length) {
      isValid = crypto.timingSafeEqual(expectedBuf, receivedBuf);
    }

    if (!isValid) {
      console.warn(`Payment signature verification failed for order ${razorpay_order_id}`);
      return res.status(400).json({
        success: false,
        verified: false,
        error: 'Payment signature mismatch. Transaction could not be verified.'
      });
    }

    // Signature matches! Payment is verified.
    let savedCompetitor = null;

    // If athlete data is provided, persist / update registration record in Supabase
    if (athleteData && typeof athleteData === 'object' && (athleteData.phone || athleteData.mobile)) {
      try {
        // Fetch current max bib number to assign next bib
        const bibRes = await fetch(`${SUPABASE_URL}/rest/v1/competitors?select=bib_no&order=bib_no.desc&limit=1`, {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
          }
        });
        const latestBib = await bibRes.json();
        const nextBib = (latestBib && latestBib.length > 0 && latestBib[0].bib_no) ? latestBib[0].bib_no + 1 : 110;
        const regNo = `NSC-2026-${nextBib}`;

        const athletePhone = String(athleteData.phone || athleteData.mobile || '').trim();
        const athleteGender = athleteData.gender === 'Male' ? 'Men' : (athleteData.gender === 'Female' ? 'Women' : (athleteData.gender || 'Men'));
        const athleteWeapon = athleteData.weapon || ((athleteData.eventCategory && athleteData.eventCategory.includes('Pistol')) ? '10M Air Pistol' : '10M Air Rifle');
        const athleteEventCategory = athleteData.eventCategory || 'ISSF Rifle';

        const competitorPayload = {
          registration_no: regNo,
          bib_no: nextBib,
          full_name: (athleteData.fullName || athleteData.name || 'Competitor').trim(),
          father_name: (athleteData.fatherName || '').trim() || null,
          gender: athleteGender,
          dob: athleteData.dob || null,
          phone: athletePhone,
          email: (athleteData.email || '').trim() || null,
          state: athleteData.state || 'Uttar Pradesh',
          club_name: athleteData.clubName || athleteData.school || 'BBC Shooting Academy',
          weapon: athleteWeapon,
          event_category: athleteEventCategory,
          age_category: athleteData.ageCategory || 'Senior',
          relay_no: athleteData.relayNo ? parseInt(athleteData.relayNo) : 1,
          target_lane: athleteData.targetLane ? parseInt(athleteData.targetLane) : ((nextBib % 15) + 1),
          match_date: athleteData.matchDate || '2026-11-25',
          reporting_time: athleteData.reportingTime || '08:00 AM',
          payment_status: 'verified',
          payment_ref: `RAZORPAY/${razorpay_payment_id}`,
          payment_amount: athleteData.paymentAmount ? Number(athleteData.paymentAmount) : 1500.00
        };

        const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/competitors`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
          },
          body: JSON.stringify(competitorPayload)
        });

        if (insertRes.ok) {
          const inserted = await insertRes.json();
          savedCompetitor = inserted && inserted[0] ? inserted[0] : competitorPayload;

          // Also create initial empty scorecard
          if (savedCompetitor && savedCompetitor.id) {
            const scorePayload = {
              competitor_id: savedCompetitor.id,
              relay_no: savedCompetitor.relay_no,
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
          }
        } else {
          const errBody = await insertRes.text();
          console.error('Failed to insert competitor into Supabase:', errBody);
        }
      } catch (dbErr) {
        console.error('Error saving competitor after payment:', dbErr);
      }
    }

    return res.status(200).json({
      success: true,
      verified: true,
      order_id: razorpay_order_id,
      payment_id: razorpay_payment_id,
      message: 'Payment verified successfully.',
      competitor: savedCompetitor
    });
  } catch (error) {
    console.error('Payment verification error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error during verification.'
    });
  }
}

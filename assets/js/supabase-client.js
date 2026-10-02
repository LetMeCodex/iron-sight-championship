// ================= NEXSHOT TECHNOLOGIES: SUPABASE CLIENT & HIGH-AVAILABILITY LAYER ================= //
// Project: 2nd Late Smt. Kiran Chopra Shooting Championship 2026
// Database: Supabase PostgreSQL (ap-south-1 Mumbai, India)
// Architecture: 3-Layer Crash-Proof Engine (Vercel Edge Cache -> Direct Supabase SDK -> Offline Local Cache)

const SUPABASE_CONFIG = {
  url: "https://ltsfadnajhxvwhzexktt.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0c2ZhZG5hamh4dndoemV4a3R0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MTc4MDMsImV4cCI6MjA5NTk5MzgwM30.TF7KyvO_ySDduXzMv5TK3FYjpY36N2yz-8vC0IlvidY",
  isLocal: window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
};

// Initialize Supabase Client if library is present
let _supabaseClient = null;
function getSupabaseClient() {
  if (!_supabaseClient && window.supabase && typeof window.supabase.createClient === 'function') {
    _supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
  }
  return _supabaseClient;
}

const NexShotDB = {

  /**
   * Fetch Live Scores with Edge Caching & Fallback
   * Automatically caches the last 1000 scores locally for instant offline rendering
   */
  async getLiveScores(forceRefresh = false) {
    // 1. Try Vercel Edge Cache endpoint first (on production)
    if (!SUPABASE_CONFIG.isLocal && !forceRefresh) {
      try {
        const res = await fetch('/api/scores');
        if (res.ok) {
          const json = await res.json();
          if (json.scores && json.scores.length > 0) {
            localStorage.setItem('nexshot_cached_scores', JSON.stringify(json.scores));
            return json.scores;
          }
        }
      } catch (err) {
        console.warn('Edge API fetch failed, falling back to direct Supabase query:', err);
      }
    }

    // 2. Fallback to Direct Supabase Query
    try {
      const client = getSupabaseClient();
      if (client) {
        const { data, error } = await client
          .from('scores')
          .select('*, competitor:competitors(*)')
          .order('total_score', { ascending: false })
          .order('inner_tens', { ascending: false });

        if (!error && data && data.length > 0) {
          localStorage.setItem('nexshot_cached_scores', JSON.stringify(data));
          return data;
        }
      } else {
        // Direct REST fetch if script hasn't loaded yet
        const fetchUrl = `${SUPABASE_CONFIG.url}/rest/v1/scores?select=*,competitor:competitors(*)&order=total_score.desc,inner_tens.desc`;
        const res = await fetch(fetchUrl, {
          headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
          }
        });
        if (res.ok) {
          const data = await res.json();
          localStorage.setItem('nexshot_cached_scores', JSON.stringify(data));
          return data;
        }
      }
    } catch (e) {
      console.error('Supabase query failed:', e);
    }

    // 3. Fallback to offline localStorage cache
    const cached = localStorage.getItem('nexshot_cached_scores');
    if (cached) {
      try { return JSON.parse(cached); } catch(e) {}
    }

    // 4. Default Seed Fallback
    return typeof getShooters === 'function' ? getShooters() : [];
  },

  /**
   * Search Competitor for Competitor Card / Pass Lookup
   */
  async getCompetitor(query) {
    if (!query) return null;
    const cleanQuery = query.trim();

    // 1. Try Vercel API
    if (!SUPABASE_CONFIG.isLocal) {
      try {
        const res = await fetch(`/api/track?q=${encodeURIComponent(cleanQuery)}`);
        if (res.ok) {
          const json = await res.json();
          if (json.competitor) return json.competitor;
        }
      } catch (err) {}
    }

    // 2. Direct Supabase Query
    try {
      let filterUrl = `${SUPABASE_CONFIG.url}/rest/v1/competitors?phone=eq.${encodeURIComponent(cleanQuery)}&select=*,scores(*)`;
      if (cleanQuery.toUpperCase().startsWith('NSC-')) {
        filterUrl = `${SUPABASE_CONFIG.url}/rest/v1/competitors?registration_no=eq.${encodeURIComponent(cleanQuery.toUpperCase())}&select=*,scores(*)`;
      } else if (!isNaN(parseInt(cleanQuery)) && parseInt(cleanQuery) < 9999) {
        filterUrl = `${SUPABASE_CONFIG.url}/rest/v1/competitors?or=(phone.eq.${encodeURIComponent(cleanQuery)},bib_no.eq.${parseInt(cleanQuery)})&select=*,scores(*)`;
      }

      const res = await fetch(filterUrl, {
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
        }
      });
      if (res.ok) {
        const list = await res.json();
        if (list && list.length > 0) return list[0];
      }
    } catch (e) {
      console.error('Direct lookup failed:', e);
    }

    // 3. Check local bookings storage fallback
    if (typeof getBookings === 'function') {
      const local = getBookings().find(b => 
        (b.mobile && b.mobile === cleanQuery) || 
        (b.compNo && b.compNo.includes(cleanQuery))
      );
      if (local) return local;
    }

    return null;
  },

  /**
   * Register a new competitor
   */
  async register(athleteData) {
    // 1. Try API Route
    if (!SUPABASE_CONFIG.isLocal) {
      try {
        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(athleteData)
        });
        if (res.ok) {
          const json = await res.json();
          if (json.competitor) return json.competitor;
        }
      } catch (e) {
        console.warn('API register failed, attempting direct Supabase insert:', e);
      }
    }

    // 2. Direct Supabase Insertion
    try {
      // Get max bib number
      const bibRes = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/competitors?select=bib_no&order=bib_no.desc&limit=1`, {
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
        }
      });
      const bibs = await bibRes.json();
      const nextBib = (bibs && bibs.length > 0 && bibs[0].bib_no) ? bibs[0].bib_no + 1 : 110;
      const regNo = `NSC-2026-${nextBib}`;

      const payload = {
        registration_no: regNo,
        bib_no: nextBib,
        full_name: athleteData.fullName || athleteData.name,
        father_name: athleteData.fatherName || '',
        gender: (athleteData.gender === 'Male' ? 'Men' : (athleteData.gender === 'Female' ? 'Women' : athleteData.gender)) || 'Men',
        dob: athleteData.dob || null,
        phone: athleteData.phone || athleteData.mobile,
        email: athleteData.email || '',
        state: athleteData.state || 'Uttar Pradesh',
        club_name: athleteData.clubName || athleteData.school || 'BBC Shooting Academy',
        weapon: (athleteData.weapon && athleteData.weapon.includes('Pistol')) ? '10M Air Pistol' : '10M Air Rifle',
        event_category: (athleteData.eventCategory && athleteData.eventCategory.includes('NR')) ? 'National Rules (NR)' : 'ISSF',
        age_category: athleteData.ageCategory || 'Senior',
        relay_no: athleteData.relayNo ? parseInt(athleteData.relayNo) : 1,
        target_lane: athleteData.targetLane ? parseInt(athleteData.targetLane) : ((nextBib % 9) + 1),
        match_date: athleteData.matchDate || '2026-11-25',
        reporting_time: athleteData.reportingTime || '08:00 AM',
        payment_status: athleteData.paymentRef ? 'verified' : 'pending',
        payment_amount: 1500.00,
        payment_ref: athleteData.paymentRef || `UPI/${Date.now().toString().slice(-6)}`
      };

      const insertRes = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/competitors`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(payload)
      });

      if (insertRes.ok) {
        const created = await insertRes.json();
        const comp = created[0];

        // Insert initial score entry
        await fetch(`${SUPABASE_CONFIG.url}/rest/v1/scores`, {
          method: 'POST',
          headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            competitor_id: comp.id,
            relay_no: comp.relay_no,
            series_1: 0.0,
            series_2: 0.0,
            series_3: 0.0,
            series_4: 0.0,
            series_5: 0.0,
            series_6: 0.0,
            inner_tens: 0,
            decimal_score: 0.0,
            status: 'shooting'
          })
        });

        return comp;
      }
    } catch (e) {
      console.error('Direct register failed:', e);
    }

    // Local fallback
    if (typeof saveBooking === 'function') {
      const localBooking = {
        compNo: `COMP #NST-2026-${Math.floor(100 + Math.random() * 900)}`,
        name: athleteData.fullName || athleteData.name,
        fatherName: athleteData.fatherName || '',
        school: athleteData.school || '',
        mobile: athleteData.phone || athleteData.mobile,
        gender: athleteData.gender || 'Male',
        event: athleteData.event || '10M Air Rifle',
        category: athleteData.category || 'Sub-Youth Men',
        date: athleteData.date || '25 NOV 2026',
        relay: athleteData.relay || 'Relay 01',
        time: athleteData.time || '09:00 — 10:15 AM',
        reporting: athleteData.reporting || '08:30 AM',
        lane: athleteData.lane || 'Lane #04 (SIUS)',
        status: "Confirmed",
        fee: "1500"
      };
      saveBooking(localBooking);
      return localBooking;
    }

    return null;
  },

  /**
   * Fetch All Competitors (for Admin Panel)
   */
  async getAllCompetitors() {
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/competitors?select=*,scores(*)&order=bib_no.asc`, {
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
        }
      });
      if (res.ok) {
        return await res.json();
      }
    } catch (e) {
      console.error('Failed to get all competitors:', e);
    }
    return [];
  },

  /**
   * Update Series Scores (Admin inline score entry)
   */
  async updateScore(competitorId, series, innerTens = 0, status = 'finished') {
    try {
      const client = getSupabaseClient();
      const payload = {
        series_1: parseFloat(series[0]) || 0,
        series_2: parseFloat(series[1]) || 0,
        series_3: parseFloat(series[2]) || 0,
        series_4: parseFloat(series[3]) || 0,
        series_5: parseFloat(series[4]) || 0,
        series_6: parseFloat(series[5]) || 0,
        inner_tens: parseInt(innerTens) || 0,
        status: status,
        updated_at: new Date().toISOString()
      };

      if (client) {
        const { data, error } = await client
          .from('scores')
          .update(payload)
          .eq('competitor_id', competitorId);
        return !error;
      } else {
        const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/scores?competitor_id=eq.${competitorId}`, {
          method: 'PATCH',
          headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        });
        return res.ok;
      }
    } catch (e) {
      console.error('Score update failed:', e);
      return false;
    }
  },

  /**
   * Verify Payment Status
   */
  async updatePayment(competitorId, newStatus) {
    try {
      const res = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/competitors?id=eq.${competitorId}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_CONFIG.anonKey,
          'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ payment_status: newStatus })
      });
      return res.ok;
    } catch (e) {
      console.error('Payment status update failed:', e);
      return false;
    }
  },

  /**
   * Emergency 1-Click Backup: Export entire database as CSV
   */
  async exportCSV() {
    const list = await this.getAllCompetitors();
    if (!list || list.length === 0) {
      alert("No data available to export.");
      return;
    }

    const headers = [
      "Bib", "RegNo", "FullName", "FatherName", "Gender", "Phone", "Email", 
      "Club", "Weapon", "EventCategory", "AgeCategory", "Relay", "Lane", 
      "MatchDate", "ReportingTime", "PaymentStatus", "S1", "S2", "S3", "S4", "S5", "S6", "Total", "10x", "Status"
    ];

    const rows = list.map(c => {
      const score = (c.scores && c.scores.length > 0) ? c.scores[0] : {};
      return [
        c.bib_no,
        `"${c.registration_no || ''}"`,
        `"${(c.full_name || '').replace(/"/g, '""')}"`,
        `"${(c.father_name || '').replace(/"/g, '""')}"`,
        c.gender || 'Men',
        `"${c.phone || ''}"`,
        `"${c.email || ''}"`,
        `"${(c.club_name || '').replace(/"/g, '""')}"`,
        `"${c.weapon || ''}"`,
        `"${c.event_category || ''}"`,
        `"${c.age_category || ''}"`,
        c.relay_no || 1,
        c.target_lane || 1,
        c.match_date || '2026-11-25',
        `"${c.reporting_time || ''}"`,
        c.payment_status || 'pending',
        score.series_1 || 0,
        score.series_2 || 0,
        score.series_3 || 0,
        score.series_4 || 0,
        score.series_5 || 0,
        score.series_6 || 0,
        score.total_score || 0,
        score.inner_tens || 0,
        score.status || 'pending'
      ].join(',');
    });

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `NexShot_Championship_Backup_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  },

  /**
   * Emergency 1-Click Import: Import CSV backup into Supabase / local cache
   */
  async importCSV(csvText) {
    if (!csvText || typeof csvText !== 'string') return { success: false, error: 'Invalid CSV data' };
    const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
    if (lines.length < 2) return { success: false, error: 'CSV file contains no data rows' };

    let importedCount = 0;
    const errors = [];

    // Parse CSV line safely supporting quoted commas
    function parseCSVLine(line) {
      const result = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"' || char === "'") {
          inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
          result.push(cur.trim().replace(/^["']|["']$/g, ''));
          cur = '';
        } else {
          cur += char;
        }
      }
      result.push(cur.trim().replace(/^["']|["']$/g, ''));
      return result;
    }

    for (let i = 1; i < lines.length; i++) {
      try {
        const cols = parseCSVLine(lines[i]);
        if (cols.length < 5) continue;
        const [
          bib, regNo, fullName, fatherName, gender, phone, email,
          club, weapon, eventCat, ageCat, relay, lane,
          matchDate, reportingTime, paymentStatus, s1, s2, s3, s4, s5, s6, total, innerTens, status
        ] = cols;

        if (!fullName || !phone) continue;

        const athleteObj = {
          fullName: fullName,
          fatherName: fatherName || '',
          gender: gender || 'Men',
          phone: phone,
          email: email || '',
          clubName: club || 'BBC Shooting Academy',
          weapon: weapon || '10M Air Rifle',
          eventCategory: eventCat || 'ISSF',
          ageCategory: ageCat || 'Senior',
          relayNo: parseInt(relay) || 1,
          targetLane: parseInt(lane) || 1,
          matchDate: matchDate || '2026-11-25',
          reportingTime: reportingTime || '08:00 AM',
          paymentRef: (paymentStatus === 'verified') ? 'OFFLINE_VERIFIED' : null
        };

        const comp = await this.register(athleteObj);
        if (comp && comp.id && s1 !== undefined) {
          await this.updateScore(comp.id, [s1, s2, s3, s4, s5, s6], innerTens || 0, status || 'finished');
        }
        importedCount++;
      } catch (err) {
        errors.push(`Row ${i}: ${err.message}`);
      }
    }

    return { success: true, count: importedCount, errors };
  }
};

window.NexShotDB = NexShotDB;

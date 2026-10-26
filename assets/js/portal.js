// ================= PIONEER SHARED PORTAL DATA STORE ================= //
// Source of truth is the server (/api/*). localStorage only keeps a cached copy
// of public config and the athlete's own passes, so pages still render offline.

const STORAGE_KEY_BOOKINGS = 'nexshot_my_passes';
const STORAGE_KEY_PUBLIC_CONFIG = 'nexshot_public_config';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {}
}

// Passes this browser has booked (offline copy shown on Track Booking if the server is unreachable)
function getBookings() {
  const list = readJSON(STORAGE_KEY_BOOKINGS, []);
  return Array.isArray(list) ? list : [];
}

function saveBooking(pass) {
  if (!pass) return;
  const list = getBookings().filter(p => !(pass.regNo && p.regNo === pass.regNo));
  list.unshift({ ...pass, savedAt: new Date().toISOString() });
  writeJSON(STORAGE_KEY_BOOKINGS, list.slice(0, 20));
}

// ================= TOURNAMENT GLOBAL CONFIGURATION (CUSTOMIZABLE VIA ADMIN) ================= //


const DEFAULT_TOURNAMENT_SETTINGS = {
  tournamentName: "2nd Late Smt. Kiran Chopra Shooting Championship",
  championshipFullTitle: "2nd Late Smt. Kiran Chopra Memorial Shooting Championship 2026",
  hostAcademy: "BBC Shooting Academy",
  techPartner: "NexShot Technologies",
  datesText: "25 — 28 NOVEMBER 2026",
  startDate: "2026-11-25",
  endDate: "2026-11-28",
  dailyTiming: "08:30 AM — 06:30 PM",
  venueName: "BBC Shooting Academy",
  venueSubName: "Babu Bodhraj Convent School",
  venueAddress: "Sikandrabad, Bulandshahr, Uttar Pradesh - 203205",
  venueMapsUrl: "https://maps.google.com/?q=Babu+Bodhraj+Convent+School+Sikandrabad+Bulandshahr",
  helplinePhone: "+91 8445070791",
  helplinePhoneSecondary: "+91 9758789512",
  officialEmail: "nexshottechnologies@gmail.com",
  baseFee: 1500,
  registrationOpen: true,
  announcementActive: true,
  announcementHeadline: "Official Tournament Bulletin",
  announcementText: "Reporting time is strictly 30 minutes prior to your allocated relay. Original ID / School proof mandatory.",
  circularPdfUrl: "assets/docs/Championship_Circular_2025.pdf"
};

const DEFAULT_RELAYS_CONFIG = [
  { id: 1, name: 'Relay 01', type: 'NR', matchTitle: 'NR Match (40 Shots)', time: '08:30 - 09:35 AM', reporting: '08:00 AM', duration: '1h 05m', maxSlots: 15, active: true },
  { id: 2, name: 'Relay 02', type: 'ISSF', matchTitle: 'ISSF Match (60 Shots)', time: '10:00 - 11:15 AM', reporting: '09:30 AM', duration: '1h 15m', maxSlots: 15, active: true },
  { id: 3, name: 'Relay 03', type: 'NR', matchTitle: 'NR Match (40 Shots)', time: '11:40 AM - 12:45 PM', reporting: '11:10 AM', duration: '1h 05m', maxSlots: 15, active: true },
  { id: 4, name: 'Relay 04', type: 'NR', matchTitle: 'NR Match (40 Shots)', time: '01:45 - 02:50 PM', reporting: '01:15 PM', duration: '1h 05m', maxSlots: 15, active: true },
  { id: 5, name: 'Relay 05', type: 'ISSF', matchTitle: 'ISSF Match (60 Shots)', time: '03:15 - 04:30 PM', reporting: '02:45 PM', duration: '1h 15m', maxSlots: 15, active: true },
  { id: 6, name: 'Relay 06', type: 'NR', matchTitle: 'NR Match (40 Shots)', time: '05:00 - 06:05 PM', reporting: '04:30 PM', duration: '1h 05m', maxSlots: 15, active: true }
];

const DEFAULT_RULES_CONFIG = {
  decimalScoring: "Rifle scores are calculated with decimal precision (e.g. 10.9, 10.5). Pistol scores are integer based (whole numbers).",
  tieBreaker: "In case of identical scores, higher 10X (Inner Bullseye) count determines superior rank.",
  reportingRule: "Mandatory reporting 30 minutes before firing start time for equipment check.",
  dressCode: "ISSF approved shooting jackets/trousers for ISSF category. Standard clean sportswear for NR.",
  weaponInspection: "Pellets and cylinder pressure check conducted at Range Desk before entry."
};

function getPublicConfig() {
  return readJSON(STORAGE_KEY_PUBLIC_CONFIG, null);
}

function getTournamentSettings() {
  const cfg = getPublicConfig();
  return { ...DEFAULT_TOURNAMENT_SETTINGS, ...((cfg && cfg.settings) || {}) };
}

function mapRelay(r) {
  return {
    id: r.relay_no,
    name: r.name,
    type: r.type,
    matchTitle: r.match_title,
    time: r.time_text,
    reporting: r.reporting_text,
    duration: r.duration,
    maxSlots: r.capacity,
    active: true
  };
}

function getRelaysConfig() {
  const cfg = getPublicConfig();
  if (cfg && Array.isArray(cfg.relays) && cfg.relays.length) return cfg.relays.map(mapRelay);
  return JSON.parse(JSON.stringify(DEFAULT_RELAYS_CONFIG));
}

function getTournamentRules() {
  return { ...DEFAULT_RULES_CONFIG, ...(getTournamentSettings().rules || {}) };
}

// Fetch live config from the server (CDN cached). Pages listen for "nexshot:config".
let __configPromise = null;
function loadPublicConfig(force = false) {
  if (__configPromise && !force) return __configPromise;
  __configPromise = fetch('/api/config', { cache: 'no-cache' })
    .then(res => res.ok ? res.json() : Promise.reject(new Error('config ' + res.status)))
    .then(json => {
      const cfg = { settings: json.settings || {}, events: json.events || [], relays: json.relays || [], fetchedAt: Date.now() };
      writeJSON(STORAGE_KEY_PUBLIC_CONFIG, cfg);
      document.dispatchEvent(new CustomEvent('nexshot:config', { detail: cfg }));
      return cfg;
    })
    .catch(err => {
      console.warn('Using cached tournament config:', err.message);
      __configPromise = null;
      return getPublicConfig();
    });
  return __configPromise;
}

function renderGlobalAnnouncementBar() {
  const settings = getTournamentSettings();
  if (!settings.announcementActive || !settings.announcementText) return;
  if (sessionStorage.getItem('nexshot_announcement_dismissed') === 'true') return;
  if (document.getElementById('globalAnnouncementBar')) return;

  const bar = document.createElement('aside');
  bar.id = 'globalAnnouncementBar';
  bar.className = 'w-full bg-gradient-to-r from-amber-500/25 via-orange-500/20 to-amber-500/25 border-b border-amber-500/30 text-amber-200 px-4 py-2 text-xs font-mono flex items-center justify-between gap-3 z-50 backdrop-blur-md relative';
  bar.innerHTML = `
    <div class="max-w-7xl mx-auto flex items-center gap-2 truncate">
      <span class="w-2 h-2 rounded-full bg-amber-400 animate-ping flex-shrink-0"></span>
      <span class="font-bold text-amber-300 uppercase tracking-wider flex-shrink-0">${escapeHtml(settings.announcementHeadline || 'OFFICIAL BULLETIN')}:</span>
      <span class="truncate text-white/90">${escapeHtml(settings.announcementText)}</span>
    </div>
    <button onclick="document.getElementById('globalAnnouncementBar').remove(); sessionStorage.setItem('nexshot_announcement_dismissed', 'true');" class="text-white/60 hover:text-white px-2 py-0.5 rounded text-xs flex-shrink-0" title="Dismiss">
      <i class="fa-solid fa-xmark"></i>
    </button>
  `;
  document.body.prepend(bar);
}

// Global Floating Toast (Top Dynamic Island Style)
function showToast(msg, icon = 'check') {
  let toast = document.getElementById('globalToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'globalToast';
    toast.className = 'fixed top-4 left-1/2 -translate-x-1/2 z-50 pioneer-card px-5 py-3 text-xs font-mono flex items-center gap-3 transition-all duration-300 transform -translate-y-16 opacity-0 pointer-events-none shadow-2xl border border-white/20 whitespace-nowrap';
    document.body.appendChild(toast);
  }

  toast.innerHTML = `
    <span class="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center text-xs flex-shrink-0">
      <i class="fa-solid fa-${icon}"></i>
    </span>
    <span class="text-white font-medium">${escapeHtml(msg)}</span>
  `;

  toast.classList.remove('-translate-y-16', 'opacity-0');
  toast.classList.add('translate-y-0', 'opacity-100');

  setTimeout(() => {
    toast.classList.remove('translate-y-0', 'opacity-100');
    toast.classList.add('-translate-y-16', 'opacity-0');
  }, 3200);
}

// Global Floating Mobile Bottom Dock (App-Style Navigation)
function renderMobileBottomNav() {
  const path = window.location.pathname.toLowerCase();
  if (path.includes('admin')) return;
  if (document.getElementById('mobileBottomNav')) return;
  const nav = document.createElement('nav');
  nav.id = 'mobileBottomNav';
  nav.className = 'fixed bottom-3 inset-x-3 z-40 lg:hidden pioneer-card px-2 py-2 flex items-center justify-around text-center border border-white/15 backdrop-blur-2xl shadow-2xl rounded-2xl';

  const isHome = path.endsWith('index.html') || path.endsWith('/') || path === '' || (!path.includes('.html'));
  const isSchedule = path.includes('match-schedule');
  const isRegister = path.includes('register');
  const isLive = path.includes('live-scoring') || path.includes('category-wise');
  const isTrack = path.includes('track-booking');

  nav.innerHTML = `
    <a href="index.html" class="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl font-mono text-[10px] transition-colors ${isHome ? 'text-[#FF5B37] font-bold' : 'text-white/60 hover:text-white'}">
      <i class="fa-solid fa-house text-sm"></i>
      <span>Home</span>
    </a>
    <a href="match-schedule.html" class="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl font-mono text-[10px] transition-colors ${isSchedule ? 'text-amber-400 font-bold' : 'text-white/60 hover:text-white'}">
      <i class="fa-regular fa-clock text-sm"></i>
      <span>Schedule</span>
    </a>
    <a href="register.html" class="flex flex-col items-center gap-0.5 px-3 py-1 rounded-xl font-mono text-[10px] pioneer-btn-coral text-white font-bold transition-transform active:scale-95 shadow-md shadow-[#FF5B37]/30">
      <i class="fa-solid fa-bullseye text-sm"></i>
      <span>Register</span>
    </a>
    <a href="live-scoring.html" class="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl font-mono text-[10px] transition-colors ${isLive ? 'text-white font-bold' : 'text-white/60 hover:text-white'}">
      <i class="fa-solid fa-bolt text-sm"></i>
      <span>Scores</span>
    </a>
    <a href="track-booking.html" class="flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-xl font-mono text-[10px] transition-colors ${isTrack ? 'text-cyan-400 font-bold' : 'text-white/60 hover:text-white'}">
      <i class="fa-solid fa-id-card text-sm"></i>
      <span>Pass</span>
    </a>
  `;
  document.body.appendChild(nav);
}

// Auto-attach bottom dock on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderMobileBottomNav);
} else {
  renderMobileBottomNav();
}

// ================= OFFICIAL NRAI/ISSF MATCHES CATALOG (PAGES 10 & 11) ================= //

const OFFICIAL_MATCHES = [
  // PISTOL EVENTS (AP-01 to AP-23)
  { code: 'AP-01', weapon: 'Pistol', eventType: 'ISSF', name: '10M Air Pistol ISSF', gender: 'Male', category: 'Senior Men', ageLimit: '21+ Years', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AP-02', weapon: 'Pistol', eventType: 'ISSF', name: '10M Air Pistol ISSF', gender: 'Male', category: 'Junior Men', ageLimit: 'Born 2005 or after (Below 21)', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AP-03', weapon: 'Pistol', eventType: 'ISSF', name: '10M Air Pistol ISSF', gender: 'Male', category: 'Youth Men', ageLimit: 'Born 2007 or after (Below 19)', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AP-04', weapon: 'Pistol', eventType: 'ISSF', name: '10M Air Pistol ISSF', gender: 'Male', category: 'Sub Youth Men', ageLimit: 'Born 2010 or after (Below 16)', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AP-05', weapon: 'Pistol', eventType: 'ISSF', name: '10M Air Pistol ISSF', gender: 'Female', category: 'Senior Women', ageLimit: '21+ Years', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AP-06', weapon: 'Pistol', eventType: 'ISSF', name: '10M Air Pistol ISSF', gender: 'Female', category: 'Junior Women', ageLimit: 'Born 2005 or after (Below 21)', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AP-07', weapon: 'Pistol', eventType: 'ISSF', name: '10M Air Pistol ISSF', gender: 'Female', category: 'Youth Women', ageLimit: 'Born 2007 or after (Below 19)', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AP-08', weapon: 'Pistol', eventType: 'ISSF', name: '10M Air Pistol ISSF', gender: 'Female', category: 'Sub Youth Women', ageLimit: 'Born 2010 or after (Below 16)', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },

  { code: 'AP-09', weapon: 'Pistol', eventType: 'NR', name: '10M Air Pistol NR', gender: 'Male', category: 'Senior Men', ageLimit: '21+ Years', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AP-10', weapon: 'Pistol', eventType: 'NR', name: '10M Air Pistol NR', gender: 'Male', category: 'Junior Men', ageLimit: 'Born 2005 or after (Below 21)', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AP-11', weapon: 'Pistol', eventType: 'NR', name: '10M Air Pistol NR', gender: 'Male', category: 'Youth Men', ageLimit: 'Born 2007 or after (Below 19)', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AP-12', weapon: 'Pistol', eventType: 'NR', name: '10M Air Pistol NR', gender: 'Male', category: 'Sub Youth Men', ageLimit: 'Born 2010 or after (Below 16)', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AP-13', weapon: 'Pistol', eventType: 'NR', name: '10M Air Pistol NR', gender: 'Female', category: 'Senior Women', ageLimit: '21+ Years', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AP-14', weapon: 'Pistol', eventType: 'NR', name: '10M Air Pistol NR', gender: 'Female', category: 'Junior Women', ageLimit: 'Born 2005 or after (Below 21)', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AP-15', weapon: 'Pistol', eventType: 'NR', name: '10M Air Pistol NR', gender: 'Female', category: 'Youth Women', ageLimit: 'Born 2007 or after (Below 19)', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AP-16', weapon: 'Pistol', eventType: 'NR', name: '10M Air Pistol NR', gender: 'Female', category: 'Sub Youth Women', ageLimit: 'Born 2010 or after (Below 16)', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },

  { code: 'AP-17', weapon: 'Pistol', eventType: 'U12', name: 'Air Pistol U-12', gender: 'Male', category: 'Boys (Under 12)', ageLimit: 'Below 12 Years', shots: 40, target: 'Paper Target', fee: 1000 },
  { code: 'AP-18', weapon: 'Pistol', eventType: 'U12', name: 'Air Pistol U-12', gender: 'Female', category: 'Girls (Under 12)', ageLimit: 'Below 12 Years', shots: 40, target: 'Paper Target', fee: 1000 },

  { code: 'AP-19', weapon: 'Pistol', eventType: 'PARA', name: 'Air Pistol Para-Shooter', gender: 'Male', category: 'Para-Shooter Men', ageLimit: 'Senior (21+)', shots: 60, target: 'Electronic (SIUS)', fee: 1000 },
  { code: 'AP-20', weapon: 'Pistol', eventType: 'PARA', name: 'Air Pistol Para-Shooter', gender: 'Female', category: 'Para-Shooter Women', ageLimit: 'Senior (21+)', shots: 60, target: 'Electronic (SIUS)', fee: 1000 },

  { code: 'AP-21', weapon: 'Pistol', eventType: 'DEAF', name: 'Air Pistol Deaf-Shooter', gender: 'Male', category: 'Deaf-Shooter Men', ageLimit: 'Senior (21+)', shots: 60, target: 'Electronic (SIUS)', fee: 1000 },
  { code: 'AP-22', weapon: 'Pistol', eventType: 'DEAF', name: 'Air Pistol Deaf-Shooter', gender: 'Female', category: 'Deaf-Shooter Women', ageLimit: 'Senior (21+)', shots: 60, target: 'Electronic (SIUS)', fee: 1000 },

  { code: 'AP-23', weapon: 'Pistol', eventType: 'MASTER', name: 'Air Pistol Master', gender: 'All', category: 'Master (45+ Years)', ageLimit: 'Completed 45+ Years', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },

  // RIFLE EVENTS (AR-01 to AR-23)
  { code: 'AR-01', weapon: 'Rifle', eventType: 'ISSF', name: '10M Air Rifle (Peep Sight) ISSF', gender: 'Male', category: 'Senior Men', ageLimit: '21+ Years', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AR-02', weapon: 'Rifle', eventType: 'ISSF', name: '10M Air Rifle (Peep Sight) ISSF', gender: 'Male', category: 'Junior Men', ageLimit: 'Born 2005 or after (Below 21)', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AR-03', weapon: 'Rifle', eventType: 'ISSF', name: '10M Air Rifle (Peep Sight) ISSF', gender: 'Male', category: 'Youth Men', ageLimit: 'Born 2007 or after (Below 19)', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AR-04', weapon: 'Rifle', eventType: 'ISSF', name: '10M Air Rifle (Peep Sight) ISSF', gender: 'Male', category: 'Sub Youth Men', ageLimit: 'Born 2010 or after (Below 16)', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AR-05', weapon: 'Rifle', eventType: 'ISSF', name: '10M Air Rifle (Peep Sight) ISSF', gender: 'Female', category: 'Senior Women', ageLimit: '21+ Years', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AR-06', weapon: 'Rifle', eventType: 'ISSF', name: '10M Air Rifle (Peep Sight) ISSF', gender: 'Female', category: 'Junior Women', ageLimit: 'Born 2005 or after (Below 21)', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AR-07', weapon: 'Rifle', eventType: 'ISSF', name: '10M Air Rifle (Peep Sight) ISSF', gender: 'Female', category: 'Youth Women', ageLimit: 'Born 2007 or after (Below 19)', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AR-08', weapon: 'Rifle', eventType: 'ISSF', name: '10M Air Rifle (Peep Sight) ISSF', gender: 'Female', category: 'Sub Youth Women', ageLimit: 'Born 2010 or after (Below 16)', shots: 60, target: 'Electronic (SIUS)', fee: 1500 },

  { code: 'AR-09', weapon: 'Rifle', eventType: 'NR', name: '10M Air Rifle (Peep Sight) NR', gender: 'Male', category: 'Senior Men', ageLimit: '21+ Years', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AR-10', weapon: 'Rifle', eventType: 'NR', name: '10M Air Rifle (Peep Sight) NR', gender: 'Male', category: 'Junior Men', ageLimit: 'Born 2005 or after (Below 21)', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AR-11', weapon: 'Rifle', eventType: 'NR', name: '10M Air Rifle (Peep Sight) NR', gender: 'Male', category: 'Youth Men', ageLimit: 'Born 2007 or after (Below 19)', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AR-12', weapon: 'Rifle', eventType: 'NR', name: '10M Air Rifle (Peep Sight) NR', gender: 'Male', category: 'Sub Youth Men', ageLimit: 'Born 2010 or after (Below 16)', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AR-13', weapon: 'Rifle', eventType: 'NR', name: '10M Air Rifle (Peep Sight) NR', gender: 'Female', category: 'Senior Women', ageLimit: '21+ Years', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AR-14', weapon: 'Rifle', eventType: 'NR', name: '10M Air Rifle (Peep Sight) NR', gender: 'Female', category: 'Junior Women', ageLimit: 'Born 2005 or after (Below 21)', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AR-15', weapon: 'Rifle', eventType: 'NR', name: '10M Air Rifle (Peep Sight) NR', gender: 'Female', category: 'Youth Women', ageLimit: 'Born 2007 or after (Below 19)', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },
  { code: 'AR-16', weapon: 'Rifle', eventType: 'NR', name: '10M Air Rifle (Peep Sight) NR', gender: 'Female', category: 'Sub Youth Women', ageLimit: 'Born 2010 or after (Below 16)', shots: 40, target: 'Electronic (SIUS)', fee: 1500 },

  { code: 'AR-17', weapon: 'Rifle', eventType: 'U12', name: 'Air Rifle (Peep Sight) U-12', gender: 'Male', category: 'Boys (Under 12)', ageLimit: 'Below 12 Years', shots: 40, target: 'Paper Target', fee: 1000 },
  { code: 'AR-18', weapon: 'Rifle', eventType: 'U12', name: 'Air Rifle (Peep Sight) U-12', gender: 'Female', category: 'Girls (Under 12)', ageLimit: 'Below 12 Years', shots: 40, target: 'Paper Target', fee: 1000 },

  { code: 'AR-19', weapon: 'Rifle', eventType: 'PARA', name: 'Air Rifle Para-Shooter', gender: 'Male', category: 'Para-Shooter Men', ageLimit: 'Senior (21+)', shots: 60, target: 'Electronic (SIUS)', fee: 1000 },
  { code: 'AR-20', weapon: 'Rifle', eventType: 'PARA', name: 'Air Rifle Para-Shooter', gender: 'Female', category: 'Para-Shooter Women', ageLimit: 'Senior (21+)', shots: 60, target: 'Electronic (SIUS)', fee: 1000 },

  { code: 'AR-21', weapon: 'Rifle', eventType: 'DEAF', name: 'Air Rifle Deaf-Shooter', gender: 'Male', category: 'Deaf-Shooter Men', ageLimit: 'Senior (21+)', shots: 60, target: 'Electronic (SIUS)', fee: 1000 },
  { code: 'AR-22', weapon: 'Rifle', eventType: 'DEAF', name: 'Air Rifle Deaf-Shooter', gender: 'Female', category: 'Deaf-Shooter Women', ageLimit: 'Senior (21+)', shots: 60, target: 'Electronic (SIUS)', fee: 1000 },

  { code: 'AR-23', weapon: 'Rifle', eventType: 'MASTER', name: 'Air Rifle Master', gender: 'All', category: 'Master (45+ Years)', ageLimit: 'Completed 45+ Years', shots: 60, target: 'Electronic (SIUS)', fee: 1500 }
];

// Helper: Get Matches by Filters
function getOfficialMatches(filters = {}) {
  return OFFICIAL_MATCHES.filter(m => {
    if (filters.weapon && m.weapon !== filters.weapon) return false;
    if (filters.eventType && m.eventType !== filters.eventType) return false;
    if (filters.gender && m.gender !== 'All' && m.gender !== filters.gender) return false;
    return true;
  });
}

function findMatchByCode(code) {
  return OFFICIAL_MATCHES.find(m => m.code === code);
}

// ================= THEME SWITCHER & OPTICAL LIQUID SYSTEM ================= //

function applyTheme(themeValue) {
  let themeName = 'azure';
  if (themeValue === 'dark') themeName = 'onyx';
  else if (themeValue === 'dim') themeName = 'dusk';
  else themeName = 'azure';

  document.body.setAttribute('data-theme', themeName);
  try {
    localStorage.setItem('nexshot_theme', themeValue);
    localStorage.setItem('iron_sight_theme', themeValue);
  } catch (e) {}

  // Sync all switcher elements on the page
  document.querySelectorAll('.switcher').forEach(sw => {
    const targetRadio = sw.querySelector(`input[value="${themeValue}"]`);
    if (targetRadio && !targetRadio.checked) {
      targetRadio.checked = true;
    }
  });
}

function initThemeSwitcher() {
  const switchers = document.querySelectorAll('.switcher');
  let savedTheme = 'light';
  try {
    savedTheme = localStorage.getItem('nexshot_theme') || localStorage.getItem('iron_sight_theme') || 'light';
  } catch (e) {}

  applyTheme(savedTheme);

  switchers.forEach(switcher => {
    const radios = switcher.querySelectorAll('input[type="radio"]');
    
    // Set checked state for saved theme
    const matching = switcher.querySelector(`input[value="${savedTheme}"]`);
    if (matching) {
      matching.checked = true;
    }

    const initiallyChecked = switcher.querySelector('input[type="radio"]:checked');
    let previousValue = initiallyChecked ? initiallyChecked.getAttribute('c-option') : '1';
    switcher.setAttribute('c-previous', previousValue);

    radios.forEach(radio => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          switcher.setAttribute('c-previous', previousValue ?? '');
          previousValue = radio.getAttribute('c-option');
          applyTheme(radio.value);
        }
      });
    });
  });
}

// GSAP Animations and Liquid Motion Interactions
function initGSAPAnimations() {
  if (typeof gsap === 'undefined') return;

  // Split and reveal hero title
  const heroTitles = document.querySelectorAll('.hero-title-reveal');
  heroTitles.forEach(title => {
    const text = title.innerText.trim();
    if (!text || title.dataset.animated) return;
    title.dataset.animated = 'true';
    
    const words = text.split(' ');
    title.innerHTML = words.map(w => 
      `<span class="inline-block overflow-hidden"><span class="inline-block gsap-word transform translate-y-full opacity-0 will-change-transform">${w}&nbsp;</span></span>`
    ).join('');

    gsap.to(title.querySelectorAll('.gsap-word'), {
      y: '0%',
      opacity: 1,
      duration: 0.75,
      stagger: 0.035,
      ease: 'power3.out',
      delay: 0.08
    });
  });

  // Staggered card entrance (safe fromTo with clearProps to prevent freezing opacity)
  const cards = document.querySelectorAll('.pioneer-card');
  if (cards.length > 0 && !window.__pioneerCardsAnimated) {
    window.__pioneerCardsAnimated = true;
    gsap.fromTo('.pioneer-card', 
      { opacity: 0, y: 16 },
      {
        opacity: 1,
        y: 0,
        duration: 0.45,
        stagger: 0.04,
        ease: 'power2.out',
        clearProps: 'all' // Ensures opacity and transform are cleanly removed when done
      }
    );
  }

  // Tactile liquid button physics
  document.querySelectorAll('.btn-tactile, .pioneer-btn-coral').forEach(btn => {
    btn.addEventListener('mouseenter', () => {
      gsap.to(btn, { scale: 1.025, duration: 0.18, ease: 'power2.out' });
    });
    btn.addEventListener('mouseleave', () => {
      gsap.to(btn, { scale: 1.0, duration: 0.22, ease: 'power2.out' });
    });
  });
}

/* ================= LIVE CHAMPIONSHIP COUNTDOWN ================= */
let __countdownTimer = null;
function initChampionshipCountdown() {
  const countdownEl = document.getElementById('countdownText');
  if (!countdownEl) return;
  if (__countdownTimer) clearInterval(__countdownTimer);

  const settings = (typeof getTournamentSettings === 'function') ? getTournamentSettings() : null;
  const startDateStr = settings?.startDate || '2026-11-25';

  // Championship start: Start Date, 08:30 AM IST (Indian Standard Time UTC+05:30)
  const targetDate = new Date(`${startDateStr}T08:30:00+05:30`).getTime();

  function update() {
    const now = new Date().getTime();
    const diff = targetDate - now;

    if (diff <= 0) {
      countdownEl.innerText = 'CHAMPIONSHIP LIVE';
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const seconds = Math.floor((diff / 1000) % 60);

    const pad = n => String(n).padStart(2, '0');
    countdownEl.innerText = `T-${days}D ${pad(hours)}H ${pad(minutes)}M ${pad(seconds)}S`;
  }

  update();
  __countdownTimer = setInterval(update, 1000);
}

// Auto-init on DOMContentLoaded or immediate if ready (guaranteed single execution)
let __portalInitialized = false;
function __bootstrapPortal() {
  if (__portalInitialized) return;
  __portalInitialized = true;
  initThemeSwitcher();
  initGSAPAnimations();
  initChampionshipCountdown();
  renderGlobalAnnouncementBar();
  applySettingsToPage();
  loadPublicConfig();
}

// Push admin-edited settings into the page: elements marked data-setting="key" get the text,
// and every Maps / circular link follows the links saved in the admin panel.
function applySettingsToPage() {
  const s = getTournamentSettings();
  document.querySelectorAll('[data-setting]').forEach(el => {
    const v = s[el.dataset.setting];
    if (v !== undefined && v !== null && String(v).trim() !== '') el.textContent = v;
  });
  if (s.venueMapsUrl && /^https:\/\//.test(s.venueMapsUrl)) {
    document.querySelectorAll('a[href*="maps.google."]').forEach(a => { a.href = s.venueMapsUrl; });
  }
  if (s.circularPdfUrl && /^(https:\/\/|assets\/)/.test(s.circularPdfUrl)) {
    document.querySelectorAll('a[href*="Circular"][href$=".pdf"], a[data-circular]').forEach(a => {
      a.href = s.circularPdfUrl;
      a.setAttribute('data-circular', '1');
    });
  }
}

document.addEventListener('nexshot:config', () => {
  applySettingsToPage();
  // Rebuild the notice bar so admin edits show up without a second page load
  const oldBar = document.getElementById('globalAnnouncementBar');
  if (oldBar) oldBar.remove();
  renderGlobalAnnouncementBar();
  initChampionshipCountdown();
});

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', __bootstrapPortal);
} else {
  __bootstrapPortal();
}


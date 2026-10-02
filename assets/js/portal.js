// ================= PIONEER SHARED PORTAL DATA STORE ================= //

const STORAGE_KEY_SHOOTERS = 'iron_sight_shooters_db';
const STORAGE_KEY_BOOKINGS = 'iron_sight_bookings_db';

// Initial Shooters Dataset
const DEFAULT_SHOOTERS = [
  { id: 1, rank: 1, name: "Aarav Sharma", school: "Babu Bodhraj Convent School", event: "10M Air Rifle ISSF", category: "Sub-Youth Men", s1: 104.2, s2: 103.8, s3: 104.5, s4: 104.9, s5: 103.6, s6: 104.8, total: 625.8, x10: 42, active: true },
  { id: 2, rank: 2, name: "Rajat Sangwan", school: "Meerut Shooting Academy", event: "10M Air Pistol ISSF", category: "Junior Men", s1: 98.0, s2: 97.0, s3: 98.0, s4: 97.0, s5: 98.0, s6: 99.0, total: 587.0, x10: 26, active: false },
  { id: 3, rank: 3, name: "Simran Kaur", school: "The Sapience Dwarka", event: "10M Air Rifle NR", category: "Junior Women", s1: 104.6, s2: 104.2, s3: 103.1, s4: 105.7, s5: 0.0, s6: 0.0, total: 417.6, x10: 36, active: false },
  { id: 4, rank: 4, name: "Arvind Tomer", school: "Hawk2 Aim Shooting Range", event: "10M Air Pistol NR", category: "Senior Men", s1: 93.0, s2: 97.0, s3: 98.0, s4: 95.0, s5: 0.0, s6: 0.0, total: 383.0, x10: 14, active: false },
  { id: 5, rank: 5, name: "Bhumi Verma", school: "Abhinandan Academy", event: "10M Air Rifle ISSF", category: "Youth Women", s1: 103.1, s2: 102.5, s3: 104.0, s4: 103.2, s5: 102.9, s6: 103.8, total: 619.5, x10: 31, active: false },
  { id: 6, rank: 6, name: "Pulkit Kharb", school: "MDK Shooting Range", event: "Little Champ 10M Pistol", category: "Under-12", s1: 97.0, s2: 98.0, s3: 0.0, s4: 0.0, s5: 0.0, s6: 0.0, total: 195.0, x10: 11, active: false },
  { id: 7, rank: 7, name: "Vanshik Singh", school: "Abhinandan Academy", event: "Little Champ 10M Rifle", category: "Under-12", s1: 98.6, s2: 99.0, s3: 0.0, s4: 0.0, s5: 0.0, s6: 0.0, total: 197.6, x10: 16, active: false },
  { id: 8, rank: 8, name: "Soin Khan", school: "Binauli Rifle Club", event: "Deaf / Para 10M Pistol", category: "Para Men", s1: 91.0, s2: 90.0, s3: 91.0, s4: 89.0, s5: 0.0, s6: 0.0, total: 361.0, x10: 9, active: false }
];

// Initial Bookings
const DEFAULT_BOOKINGS = [
  {
    compNo: "COMP #ISC-2025-084",
    name: "Aarav Sharma",
    fatherName: "Rajesh Sharma",
    school: "Babu Bodhraj Convent School",
    mobile: "9012790797",
    gender: "Male",
    event: "10M Air Rifle (.177) ISSF",
    category: "Sub-Youth Men",
    date: "13 APR 2025",
    relay: "Relay 01",
    time: "09:00 — 10:15 AM",
    reporting: "08:30 AM",
    lane: "Lane #04 (SIUS)",
    status: "Confirmed",
    fee: "1500"
  }
];

function getShooters() {
  const data = localStorage.getItem(STORAGE_KEY_SHOOTERS);
  if (!data) {
    localStorage.setItem(STORAGE_KEY_SHOOTERS, JSON.stringify(DEFAULT_SHOOTERS));
    return DEFAULT_SHOOTERS;
  }
  try {
    return JSON.parse(data);
  } catch (e) {
    return DEFAULT_SHOOTERS;
  }
}

function saveShooters(shooters) {
  localStorage.setItem(STORAGE_KEY_SHOOTERS, JSON.stringify(shooters));
}

function getBookings() {
  const data = localStorage.getItem(STORAGE_KEY_BOOKINGS);
  if (!data) {
    localStorage.setItem(STORAGE_KEY_BOOKINGS, JSON.stringify(DEFAULT_BOOKINGS));
    return DEFAULT_BOOKINGS;
  }
  try {
    return JSON.parse(data);
  } catch (e) {
    return DEFAULT_BOOKINGS;
  }
}

function saveBooking(booking) {
  const bookings = getBookings();
  bookings.unshift(booking);
  localStorage.setItem(STORAGE_KEY_BOOKINGS, JSON.stringify(bookings));
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
    <span class="text-white font-medium">${msg}</span>
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
  if (document.getElementById('mobileBottomNav')) return;
  const nav = document.createElement('nav');
  nav.id = 'mobileBottomNav';
  nav.className = 'fixed bottom-3 inset-x-3 z-40 lg:hidden pioneer-card px-2 py-2 flex items-center justify-around text-center border border-white/15 backdrop-blur-2xl shadow-2xl rounded-2xl';

  const path = window.location.pathname.toLowerCase();
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

// ================= BACKUP & DISASTER RECOVERY HUB ================= //

// 1. Export Complete JSON Backup
function exportBackupJSON() {
  const backupData = {
    app: "Iron Sight Championship Portal 2025",
    version: "2.0",
    exportedAt: new Date().toISOString(),
    shooters: getShooters(),
    bookings: getBookings()
  };

  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  a.href = url;
  a.download = `IronSight_Championship_Backup_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast("Full Database Backup Exported (.JSON)", "download");
}

// 2. Export Bookings CSV for Jury & School Verification
function exportBookingsCSV() {
  const bookings = getBookings();
  if (!bookings || bookings.length === 0) {
    showToast("No athlete registrations found to export", "circle-exclamation");
    return;
  }

  const headers = ["Comp ID", "Athlete Name", "Father Name", "School/Academy", "Mobile", "Gender", "Event", "Category", "Match Date", "Relay", "Firing Time", "Reporting Time", "Lane", "Fee Paid", "Status"];
  const rows = bookings.map(b => [
    `"${b.compNo || ''}"`,
    `"${b.name || ''}"`,
    `"${b.fatherName || ''}"`,
    `"${b.school || ''}"`,
    `"${b.mobile || ''}"`,
    `"${b.gender || ''}"`,
    `"${b.event || ''}"`,
    `"${b.category || ''}"`,
    `"${b.date || ''}"`,
    `"${b.relay || ''}"`,
    `"${b.time || ''}"`,
    `"${b.reporting || ''}"`,
    `"${b.lane || ''}"`,
    `"${b.fee || ''}"`,
    `"${b.status || ''}"`
  ]);

  const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map(e => e.join(","))].join("\n");
  const encodedUri = encodeURI(csvContent);
  const a = document.createElement("a");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 10);
  a.setAttribute("href", encodedUri);
  a.setAttribute("download", `IronSight_Athletes_Roster_${stamp}.csv`);
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  showToast("Registrations Roster Exported (.CSV)", "file-csv");
}

// 3. Import & Restore JSON Backup
function importBackupJSON(jsonString) {
  try {
    const parsed = JSON.parse(jsonString);
    if (!parsed.shooters || !parsed.bookings) {
      throw new Error("Invalid backup schema. Required: shooters & bookings arrays.");
    }
    localStorage.setItem(STORAGE_KEY_SHOOTERS, JSON.stringify(parsed.shooters));
    localStorage.setItem(STORAGE_KEY_BOOKINGS, JSON.stringify(parsed.bookings));
    showToast(`Restored ${parsed.shooters.length} shooters & ${parsed.bookings.length} registrations!`, "cloud-arrow-up");
    return true;
  } catch (err) {
    alert("Backup restoration error: " + err.message);
    return false;
  }
}

// 4. Update Shooter Scores
function updateShooter(updated) {
  const shooters = getShooters();
  const idx = shooters.findIndex(s => s.id == updated.id);
  if (idx !== -1) {
    shooters[idx] = { ...shooters[idx], ...updated };
    saveShooters(shooters);
    showToast(`Updated scores for ${updated.name}`, "check");
    return true;
  }
  return false;
}

// 5. Add New Shooter
function addShooter(shooter) {
  const shooters = getShooters();
  shooter.id = Date.now();
  shooter.rank = shooters.length + 1;
  shooters.push(shooter);
  saveShooters(shooters);
  showToast(`Added ${shooter.name} to leaderboard!`, "user-plus");
}

// 6. Delete Shooter
function deleteShooter(id) {
  let shooters = getShooters();
  shooters = shooters.filter(s => s.id != id);
  // Re-rank
  shooters.forEach((s, idx) => s.rank = idx + 1);
  saveShooters(shooters);
  showToast("Shooter removed from leaderboard", "trash");
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

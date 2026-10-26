// ================= NEXSHOT ADMIN CONSOLE ================= //
// Every change is saved on the server (/api/admin). Nothing important lives only in this browser.

const TOKEN_KEY = 'nexshot_admin_token';

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const $ = id => document.getElementById(id);
const inr = n => `₹${Number(n || 0).toLocaleString('en-IN')}`;
const pad2 = n => String(n).padStart(2, '0');

function fmtDay(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d) ? iso : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}
function fmtTime(ts) {
  return ts ? new Date(ts).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
}
function scoreOf(reg) {
  const s = Array.isArray(reg.scores) ? reg.scores[0] : reg.scores;
  return s || {};
}
function seriesCount(shots) {
  return shots && shots <= 40 ? 4 : 6;
}

function toast(msg, kind = 'ok') {
  const el = $('toast');
  el.textContent = msg;
  el.style.borderColor = kind === 'err' ? 'rgba(244,63,94,.6)' : 'rgba(16,185,129,.5)';
  el.classList.remove('opacity-0', 'translate-y-2');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('opacity-0', 'translate-y-2'), kind === 'err' ? 6000 : 3000);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

// Excel/CSV date cell -> YYYY-MM-DD (accepts Date objects, 2026-11-25, 25/11/2026, 25-11-2026)
function toISODate(v) {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date && !isNaN(v)) {
    return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${pad2(m[2])}-${pad2(m[1])}`; // Indian format: day first
  }
  return s;
}

const Admin = {
  token: null,
  settings: {},
  events: [],
  relays: [],
  regs: [],
  dash: null,
  dirtyScores: new Map(),
  importKind: null,
  importRows: [],

  // ---------- API ----------
  async api(action, params = {}) {
    let res;
    try {
      res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}) },
        body: JSON.stringify({ action, ...params })
      });
    } catch (e) {
      this.setOnline(false);
      throw new Error('No internet / server unreachable. Your change was NOT saved.');
    }
    this.setOnline(true);
    const json = await res.json().catch(() => ({}));
    if (res.status === 401 && action !== 'login') {
      this.logout(true);
      throw new Error(json.error || 'Session expired. Please log in again.');
    }
    if (!res.ok || json.success === false) throw new Error(json.error || `Request failed (${res.status})`);
    return json;
  },

  setOnline(ok) {
    const b = $('netBadge');
    b.textContent = ok ? '● Online' : '● Offline';
    b.className = `pill mono hidden sm:inline-block ${ok ? 'pill-paid' : 'pill-bad'}`;
  },

  // ---------- auth ----------
  async init() {
    $('loginForm').addEventListener('submit', e => this.login(e));
    document.querySelectorAll('#tabs .tab-btn').forEach(b => b.addEventListener('click', () => this.showTab(b.dataset.tab)));
    ['fSearch', 'fStatus', 'fEvent', 'fDate', 'fRelay'].forEach(id => $(id).addEventListener('input', () => this.renderAthletes()));
    $('rEvent').addEventListener('change', () => this.renderResults());
    $('rSearch').addEventListener('input', () => this.renderResults());
    $('resultsPublicToggle').addEventListener('change', e => this.toggleResultsPublic(e.target.checked));
    $('regForm').addEventListener('submit', e => this.saveReg(e));
    $('importFile').addEventListener('change', e => this.parseImportFile(e.target.files[0]));
    window.addEventListener('beforeunload', e => {
      if (this.dirtyScores.size) { e.preventDefault(); e.returnValue = ''; }
    });

    this.token = sessionStorage.getItem(TOKEN_KEY);
    if (this.token) {
      this.showApp();
      try {
        await this.refreshAll();
      } catch (e) {
        toast(e.message, 'err');
      }
    }
  },

  async login(e) {
    e.preventDefault();
    const err = $('loginError');
    err.classList.add('hidden');
    try {
      const { token } = await this.api('login', { password: $('loginPassword').value });
      this.token = token;
      sessionStorage.setItem(TOKEN_KEY, token);
      $('loginPassword').value = '';
      this.showApp();
      await this.refreshAll();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.remove('hidden');
    }
  },

  logout(expired = false) {
    this.token = null;
    sessionStorage.removeItem(TOKEN_KEY);
    $('appView').classList.add('hidden');
    $('loginView').classList.remove('hidden');
    if (expired) {
      $('loginError').textContent = 'Session expired. Please log in again.';
      $('loginError').classList.remove('hidden');
    }
  },

  showApp() {
    $('loginView').classList.add('hidden');
    $('appView').classList.remove('hidden');
  },

  showTab(name) {
    document.querySelectorAll('#tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== name));
    if (name === 'backup') this.loadLogs();
  },

  // ---------- data ----------
  async refreshAll() {
    const [s, ev, rl, rg, dash] = await Promise.all([
      this.api('settings.get'),
      this.api('events.list'),
      this.api('relays.list'),
      this.api('regs.list'),
      this.api('dashboard')
    ]);
    this.settings = s.settings || {};
    this.events = ev.events || [];
    this.relays = rl.relays || [];
    this.regs = rg.registrations || [];
    this.dash = dash;
    this.renderAll();
  },

  async reloadRegs() {
    const [rg, dash] = await Promise.all([this.api('regs.list'), this.api('dashboard')]);
    this.regs = rg.registrations || [];
    this.dash = dash;
    this.renderOverview();
    this.renderAthletes();
    this.renderResults(true);
  },

  matchDays() {
    const d = this.settings.matchDays;
    return Array.isArray(d) && d.length ? d : (this.settings.startDate ? [this.settings.startDate] : []);
  },

  eventByCode(code) {
    return this.events.find(e => e.code === code);
  },

  renderAll() {
    $('hdrTitle').textContent = this.settings.tournamentName || 'Tournament Control';
    $('hdrSub').textContent = `${this.settings.hostAcademy || ''} • ${this.settings.datesText || ''}`;
    this.fillFilterOptions();
    this.renderOverview();
    this.renderAthletes();
    this.renderResultsEventOptions();
    this.renderResults(true);
    this.renderEvents();
    this.renderRelays();
    this.renderSettings();
  },

  fillFilterOptions() {
    const keep = (id, html) => { const el = $(id); const v = el.value; el.innerHTML = html; el.value = v; };
    keep('fEvent', '<option value="">All events</option>' + this.events.map(e =>
      `<option value="${escapeHtml(e.code)}">${escapeHtml(e.code)} — ${escapeHtml(e.event_group)} / ${escapeHtml(e.category)}</option>`).join(''));
    keep('fDate', '<option value="">All days</option>' + this.matchDays().map(d => `<option value="${escapeHtml(d)}">${fmtDay(d)}</option>`).join(''));
    keep('fRelay', '<option value="">All relays</option>' + this.relays.map(r => `<option value="${r.relay_no}">${escapeHtml(r.name)}</option>`).join(''));
    keep('rosterDay', this.matchDays().map(d => `<option value="${escapeHtml(d)}">${fmtDay(d)}</option>`).join(''));
  },

  // ---------- overview ----------
  renderOverview() {
    if (!this.dash) return;
    const { stats, byEvent, bySlot } = this.dash;
    const card = (label, value, sub, color) => `
      <div class="card p-4"><div class="text-[11px] text-slate-400">${label}</div>
      <div class="text-2xl font-bold mono ${color}">${value}</div><div class="text-[11px] text-slate-500">${sub || ''}</div></div>`;
    $('statCards').innerHTML =
      card('Paid entries', stats.paid, `${stats.online} online • ${stats.offline} offline`, 'text-emerald-300') +
      card('Revenue (paid)', inr(stats.revenue), 'online + offline', 'text-white') +
      card('Checkouts in progress', stats.pendingLive, 'last 30 minutes', 'text-amber-300') +
      card('Failed / cancelled', stats.failed + stats.cancelled, `${stats.failed} failed • ${stats.cancelled} cancelled`, 'text-rose-300');

    const alert = $('slotIssueAlert');
    if (stats.slotIssues) {
      alert.innerHTML = `<i class="fa-solid fa-triangle-exclamation mr-2"></i><b>${stats.slotIssues} paid athlete(s) have no lane</b> (their relay filled up while they were paying). Open Athletes, filter "Paid" and give them a relay/lane — they are marked <span class="pill pill-bad">NO LANE</span>.`;
      alert.classList.remove('hidden');
    } else alert.classList.add('hidden');

    const evRows = Object.entries(byEvent).sort((a, b) => b[1] - a[1]);
    $('byEventList').innerHTML = evRows.length ? evRows.map(([k, v]) =>
      `<div class="flex justify-between border-b border-white/5 py-1"><span>${escapeHtml(k)}</span><b class="mono">${v}</b></div>`).join('')
      : '<p class="text-slate-500">No paid entries yet.</p>';

    const days = this.matchDays();
    $('slotGrid').innerHTML = `<table class="grid"><thead><tr><th>Relay</th>${days.map(d => `<th>${fmtDay(d)}</th>`).join('')}</tr></thead><tbody>${
      this.relays.map(r => `<tr><td>${escapeHtml(r.name)}</td>${days.map(d => {
        const n = bySlot[`${d}#${r.relay_no}`] || 0;
        const full = n >= r.capacity;
        return `<td class="mono ${full ? 'text-rose-300 font-bold' : n ? 'text-emerald-300' : 'text-slate-500'}">${n}/${r.capacity}</td>`;
      }).join('')}</tr>`).join('')}</tbody></table>`;
  },

  async reconcile() {
    toast('Checking unconfirmed payments with Razorpay...');
    try {
      const r = await this.api('reconcile');
      let msg = `Checked ${r.checked}. Newly confirmed: ${r.confirmed.length}.`;
      if (r.confirmed.length) msg += ` (${r.confirmed.join(', ')})`;
      if (r.problems.length) msg += ` Problems: ${r.problems.join('; ')}`;
      toast(msg, r.problems.length ? 'err' : 'ok');
      await this.reloadRegs();
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  // ---------- athletes ----------
  filteredRegs() {
    const q = $('fSearch').value.trim().toLowerCase();
    const st = $('fStatus').value, ev = $('fEvent').value, day = $('fDate').value, rl = $('fRelay').value;
    return this.regs.filter(r =>
      (!st || r.status === st) && (!ev || r.event_code === ev) && (!day || r.match_date === day) &&
      (!rl || String(r.relay_no) === rl) &&
      (!q || [r.full_name, r.phone, r.bib_no, r.reg_no, r.club_name, r.father_name, r.rzp_payment_id].some(v => String(v || '').toLowerCase().includes(q))));
  },

  statusPill(r) {
    const cls = r.status === 'paid' ? 'pill-paid' : r.status === 'pending' ? 'pill-pending' : ['failed', 'refunded'].includes(r.status) ? 'pill-bad' : 'pill-muted';
    return `<span class="pill ${cls}">${escapeHtml(r.status.toUpperCase())}</span>${r.slot_issue ? ' <span class="pill pill-bad">NO LANE</span>' : ''}`;
  },

  renderAthletes() {
    const list = this.filteredRegs();
    $('athCount').textContent = `(${list.length} shown / ${this.regs.length} total)`;
    const relayName = n => (this.relays.find(r => r.relay_no === n) || {}).name || (n ? `Relay ${n}` : '—');
    $('athTbody').innerHTML = list.length ? list.slice(0, 1500).map(r => `
      <tr>
        <td class="mono">${r.bib_no ? `<b>${r.bib_no}</b>` : '—'}<div class="text-[10px] text-slate-500">${escapeHtml(r.reg_no || '')}</div></td>
        <td><b>${escapeHtml(r.full_name)}</b><div class="text-[10px] text-slate-500">${escapeHtml(r.club_name || '')}${r.father_name ? ' • S/o ' + escapeHtml(r.father_name) : ''}</div></td>
        <td class="mono">${escapeHtml(r.phone)}</td>
        <td><span class="mono text-cyan-300">${escapeHtml(r.event_code || '')}</span><div class="text-[10px] text-slate-500">${escapeHtml(r.category || '')}</div></td>
        <td class="mono">${fmtDay(r.match_date)} • ${escapeHtml(relayName(r.relay_no))} • ${r.lane_no ? 'L' + r.lane_no : '—'}</td>
        <td class="mono">${inr(r.fee)}</td>
        <td>${this.statusPill(r)}${r.notes ? `<div class="text-[10px] text-amber-300 max-w-[180px] truncate" title="${escapeHtml(r.notes)}">${escapeHtml(r.notes)}</div>` : ''}</td>
        <td class="text-[10px] text-slate-400">${escapeHtml(r.source)}<div>${escapeHtml(r.payment_mode || '')}</div></td>
        <td class="whitespace-nowrap">
          <button class="btn btn-sm" title="Edit" onclick="Admin.openRegModal('${r.id}')"><i class="fa-solid fa-pen"></i></button>
          ${r.status !== 'paid'
            ? `<button class="btn btn-sm" title="Mark paid" onclick="Admin.markPaid('${r.id}')"><i class="fa-solid fa-check text-emerald-300"></i></button>`
            : `<button class="btn btn-sm" title="Cancel entry" onclick="Admin.setStatus('${r.id}','cancelled')"><i class="fa-solid fa-ban text-amber-300"></i></button>`}
          <button class="btn btn-sm btn-danger" title="Delete" onclick="Admin.deleteReg('${r.id}')"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`).join('') : '<tr><td colspan="9" class="text-center text-slate-500 py-6">No athletes match these filters.</td></tr>';
  },

  openRegModal(id) {
    const f = $('regForm');
    f.reset();
    $('regFormError').classList.add('hidden');
    f.event_code.innerHTML = this.events.map(e =>
      `<option value="${escapeHtml(e.code)}">${escapeHtml(e.code)} — ${escapeHtml(e.event_group)} / ${escapeHtml(e.category)} (${inr(e.fee)})${e.active ? '' : ' [inactive]'}</option>`).join('');
    f.match_date.innerHTML = '<option value="">— no slot —</option>' + this.matchDays().map(d => `<option value="${escapeHtml(d)}">${fmtDay(d)}</option>`).join('');
    f.relay_no.innerHTML = '<option value="">— no slot —</option>' + this.relays.map(r => `<option value="${r.relay_no}">${escapeHtml(r.name)} (${escapeHtml(r.time_text)})</option>`).join('');

    const reg = id ? this.regs.find(r => r.id === id) : null;
    $('regModalTitle').textContent = reg ? `Edit ${reg.full_name}` : 'Add walk-in / offline entry';
    $('regStatusRow').classList.toggle('hidden', !!reg);
    if (reg) {
      ['id', 'full_name', 'father_name', 'gender', 'dob', 'phone', 'email', 'club_name', 'state', 'event_code',
        'match_date', 'relay_no', 'lane_no', 'bib_no', 'fee', 'payment_mode', 'notes'].forEach(k => {
        if (f[k]) f[k].value = reg[k] == null ? '' : reg[k];
      });
    }
    $('regModal').showModal();
  },

  async saveReg(e) {
    e.preventDefault();
    const f = $('regForm');
    const data = Object.fromEntries(new FormData(f).entries());
    const id = data.id;
    delete data.id;
    const btn = $('regSaveBtn');
    btn.disabled = true;
    try {
      if (id) {
        delete data.status;
        await this.api('regs.update', { id, patch: data });
        toast('Athlete updated');
      } else {
        const { registration } = await this.api('regs.create', { reg: data });
        toast(`Saved: ${registration.reg_no || registration.full_name}${registration.lane_no ? ' • Lane ' + registration.lane_no : ''}`);
      }
      $('regModal').close();
      await this.reloadRegs();
    } catch (ex) {
      $('regFormError').textContent = ex.message;
      $('regFormError').classList.remove('hidden');
    } finally {
      btn.disabled = false;
    }
  },

  async markPaid(id) {
    const reg = this.regs.find(r => r.id === id);
    const mode = prompt(`Mark ${reg.full_name} as PAID.\nPayment mode? (cash / upi / razorpay / free)`, reg.payment_mode === 'razorpay' ? 'razorpay' : 'cash');
    if (!mode) return;
    const paymentId = mode.trim().toLowerCase() === 'razorpay' ? (prompt('Razorpay payment ID (pay_...) — optional', reg.rzp_payment_id || '') || null) : null;
    await this.setStatus(id, 'paid', mode.trim().toLowerCase(), paymentId);
  },

  async setStatus(id, status, payment_mode, payment_id) {
    const reg = this.regs.find(r => r.id === id);
    if (status === 'cancelled' && !confirm(`Cancel ${reg.full_name}'s entry? Their lane will be freed.`)) return;
    try {
      await this.api('regs.setStatus', { id, status, payment_mode, payment_id });
      toast(`${reg.full_name}: ${status}`);
      await this.reloadRegs();
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  async deleteReg(id) {
    const reg = this.regs.find(r => r.id === id);
    const typed = prompt(`Permanently delete ${reg.full_name} (${reg.reg_no || reg.status}) and their scores?\nType DELETE to confirm. (Prefer "Cancel" for paid entries.)`);
    if (typed !== 'DELETE') return;
    try {
      await this.api('regs.delete', { id });
      toast('Deleted');
      await this.reloadRegs();
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  // ---------- results ----------
  renderResultsEventOptions() {
    const counts = {};
    this.regs.forEach(r => { if (r.status === 'paid') counts[r.event_code] = (counts[r.event_code] || 0) + 1; });
    const el = $('rEvent');
    const prev = el.value;
    const withEntries = this.events.filter(e => counts[e.code]);
    el.innerHTML = withEntries.length
      ? withEntries.map(e => `<option value="${escapeHtml(e.code)}">${escapeHtml(e.code)} — ${escapeHtml(e.event_group)} / ${escapeHtml(e.category)} (${counts[e.code]})</option>`).join('')
      : '<option value="">No paid athletes yet</option>';
    if (withEntries.some(e => e.code === prev)) el.value = prev;
    $('resultsPublicToggle').checked = this.settings.resultsPublic !== false;
  },

  resultRows() {
    const code = $('rEvent').value;
    const q = $('rSearch').value.trim().toLowerCase();
    return this.regs.filter(r => r.status === 'paid' && r.event_code === code &&
      (!q || r.full_name.toLowerCase().includes(q) || String(r.bib_no).includes(q)));
  },

  currentScore(reg) {
    return { ...scoreOf(reg), ...(this.dirtyScores.get(reg.id) || {}) };
  },

  renderResults(keepDirty) {
    if (!keepDirty) { /* switching event keeps unsaved edits in memory until saved */ }
    const ev = this.eventByCode($('rEvent').value);
    const rows = this.resultRows();
    const n = seriesCount(ev && ev.shots);
    const isRifle = !ev || ev.weapon === 'Rifle';
    $('resThead').innerHTML = `<tr><th>Rank</th><th>Bib</th><th>Athlete</th>${[...Array(n)].map((_, i) => `<th>S${i + 1}</th>`).join('')}<th>Total</th><th>10x</th><th>Status</th><th>Rank override</th><th>Remarks</th><th></th></tr>`;

    // Rank by total then 10x (override wins)
    const ranked = rows.map(r => ({ r, s: this.currentScore(r) }))
      .map(x => ({ ...x, total: [1, 2, 3, 4, 5, 6].slice(0, n).reduce((a, i) => a + (Number(x.s['s' + i]) || 0), 0) }))
      .sort((a, b) => b.total - a.total || (Number(b.s.inner_tens) || 0) - (Number(a.s.inner_tens) || 0));
    ranked.forEach((x, i) => { x.rank = x.s.rank_override || i + 1; });

    const step = isRifle ? '0.1' : '1';
    $('resTbody').innerHTML = ranked.length ? ranked.map(({ r, s, total, rank }) => {
      const dirty = this.dirtyScores.has(r.id);
      const v = k => s[k] === null || s[k] === undefined ? '' : s[k];
      return `<tr data-id="${r.id}" class="${dirty ? 'dirty' : ''}">
        <td class="mono font-bold">${rank}</td>
        <td class="mono">${r.bib_no || ''}</td>
        <td><b>${escapeHtml(r.full_name)}</b><div class="text-[10px] text-slate-500">${escapeHtml(r.club_name || '')}</div></td>
        ${[...Array(n)].map((_, i) => `<td><input type="number" step="${step}" min="0" max="${isRifle ? 109 : 100}" class="inp inp-sm w-20 mono" value="${v('s' + (i + 1))}" oninput="Admin.editScore('${r.id}','s${i + 1}',this.value)"></td>`).join('')}
        <td class="mono font-bold text-cyan-300">${isRifle ? total.toFixed(1) : Math.round(total)}</td>
        <td><input type="number" min="0" max="${n * 10}" class="inp inp-sm w-16 mono" value="${v('inner_tens')}" oninput="Admin.editScore('${r.id}','inner_tens',this.value)"></td>
        <td><select class="inp inp-sm" onchange="Admin.editScore('${r.id}','status',this.value)">
          ${['pending', 'shooting', 'finished', 'dns', 'dnf', 'dq'].map(o => `<option value="${o}" ${(s.status || 'pending') === o ? 'selected' : ''}>${o.toUpperCase()}</option>`).join('')}
        </select></td>
        <td><input type="number" min="1" class="inp inp-sm w-16 mono" value="${v('rank_override')}" oninput="Admin.editScore('${r.id}','rank_override',this.value)"></td>
        <td><input class="inp inp-sm w-40" value="${escapeHtml(v('remarks'))}" oninput="Admin.editScore('${r.id}','remarks',this.value)"></td>
        <td><button class="btn btn-sm ${dirty ? 'btn-primary' : ''}" onclick="Admin.saveScore('${r.id}')"><i class="fa-solid fa-floppy-disk"></i></button></td>
      </tr>`;
    }).join('') : '<tr><td colspan="14" class="text-center text-slate-500 py-6">No paid athletes in this category.</td></tr>';
    $('btnSaveAllScores').disabled = this.dirtyScores.size === 0;
    $('btnSaveAllScores').innerHTML = `<i class="fa-solid fa-floppy-disk"></i>Save all changes${this.dirtyScores.size ? ` (${this.dirtyScores.size})` : ''}`;
  },

  editScore(id, field, value) {
    const d = this.dirtyScores.get(id) || {};
    d[field] = value === '' ? null : value;
    this.dirtyScores.set(id, d);
    // Re-render on blur-ish cadence to keep typing smooth
    clearTimeout(this._resT);
    this._resT = setTimeout(() => {
      const active = document.activeElement;
      const row = active && active.closest('tr[data-id]');
      const col = row ? [...row.querySelectorAll('input,select')].indexOf(active) : -1;
      const rowId = row && row.dataset.id;
      this.renderResults(true);
      if (rowId && col >= 0) {
        const again = document.querySelector(`tr[data-id="${rowId}"]`);
        const el = again && again.querySelectorAll('input,select')[col];
        if (el) { el.focus(); if (el.setSelectionRange && el.type === 'text') el.setSelectionRange(el.value.length, el.value.length); }
      }
    }, 600);
  },

  scorePayload(id) {
    const d = this.dirtyScores.get(id) || {};
    return { registration_id: id, ...d };
  },

  applySavedScore(id, saved) {
    const reg = this.regs.find(r => r.id === id);
    if (reg) reg.scores = saved;
    this.dirtyScores.delete(id);
  },

  async saveScore(id) {
    if (!this.dirtyScores.has(id)) return toast('No changes in this row');
    try {
      const { score } = await this.api('scores.save', { score: this.scorePayload(id) });
      this.applySavedScore(id, score);
      toast('Score saved');
      this.renderResults(true);
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  async saveAllScores() {
    const ids = [...this.dirtyScores.keys()];
    let ok = 0;
    const errors = [];
    $('btnSaveAllScores').disabled = true;
    for (const id of ids) {
      try {
        const { score } = await this.api('scores.save', { score: this.scorePayload(id) });
        this.applySavedScore(id, score);
        ok++;
      } catch (e) {
        const reg = this.regs.find(r => r.id === id);
        errors.push(`${reg ? reg.full_name : id}: ${e.message}`);
      }
    }
    this.renderResults(true);
    toast(errors.length ? `Saved ${ok}. Failed: ${errors.join('; ')}` : `Saved ${ok} score(s)`, errors.length ? 'err' : 'ok');
  },

  async toggleResultsPublic(on) {
    try {
      const { settings } = await this.api('settings.save', { data: { resultsPublic: on } });
      this.settings = settings;
      toast(on ? 'Results are visible on the public site' : 'Results hidden from the public site');
    } catch (e) {
      toast(e.message, 'err');
      $('resultsPublicToggle').checked = !on;
    }
  },

  // ---------- events ----------
  renderEvents() {
    const opt = (vals, cur) => vals.map(v => `<option ${v === cur ? 'selected' : ''}>${v}</option>`).join('');
    $('evTbody').innerHTML = this.events.map((e, i) => `
      <tr data-ev="${i}">
        <td><input class="inp inp-sm w-24 mono" data-f="code" value="${escapeHtml(e.code)}" ${e.__new ? '' : 'readonly'}></td>
        <td><input class="inp inp-sm w-48" data-f="event_group" value="${escapeHtml(e.event_group)}"></td>
        <td><input class="inp inp-sm w-52" data-f="category" value="${escapeHtml(e.category)}"></td>
        <td><select class="inp inp-sm" data-f="gender">${opt(['Male', 'Female', 'All'], e.gender)}</select></td>
        <td><select class="inp inp-sm" data-f="weapon">${opt(['Rifle', 'Pistol'], e.weapon)}</select></td>
        <td><input class="inp inp-sm w-36" data-f="age_limit" value="${escapeHtml(e.age_limit || '')}"></td>
        <td><input type="number" class="inp inp-sm w-16" data-f="shots" value="${e.shots}"></td>
        <td><input class="inp inp-sm w-32" data-f="target" value="${escapeHtml(e.target || '')}"></td>
        <td><input type="number" min="0" class="inp inp-sm w-20 mono" data-f="fee" value="${e.fee}"></td>
        <td><input type="number" class="inp inp-sm w-16" data-f="sort" value="${e.sort}"></td>
        <td class="text-center"><input type="checkbox" data-f="active" ${e.active ? 'checked' : ''}></td>
        <td class="whitespace-nowrap">
          <button class="btn btn-sm btn-primary" onclick="Admin.saveEvent(${i})"><i class="fa-solid fa-floppy-disk"></i></button>
          <button class="btn btn-sm btn-danger" onclick="Admin.deleteEvent(${i})"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`).join('');
  },

  readRow(tr) {
    const o = {};
    tr.querySelectorAll('[data-f]').forEach(el => { o[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; });
    return o;
  },

  addEventRow() {
    const last = this.events[this.events.length - 1] || {};
    this.events.push({ __new: true, code: '', event_group: last.event_group || '', category: '', gender: 'Male', weapon: last.weapon || 'Rifle', age_limit: '', shots: 60, target: 'Electronic (SIUS)', fee: 1500, sort: (last.sort || 0) + 10, active: true });
    this.renderEvents();
    $('evTbody').lastElementChild.scrollIntoView({ block: 'center' });
  },

  async saveEvent(i) {
    const tr = document.querySelector(`tr[data-ev="${i}"]`);
    try {
      const { event } = await this.api('events.save', { event: this.readRow(tr) });
      this.events[i] = event;
      this.renderEvents();
      this.fillFilterOptions();
      toast(`Saved ${event.code} (fee ${inr(event.fee)})`);
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  async deleteEvent(i) {
    const e = this.events[i];
    if (e.__new) { this.events.splice(i, 1); return this.renderEvents(); }
    if (!confirm(`Delete category ${e.code}?`)) return;
    try {
      await this.api('events.delete', { code: e.code });
      this.events.splice(i, 1);
      this.renderEvents();
      toast('Deleted');
    } catch (ex) {
      toast(ex.message, 'err');
    }
  },

  // ---------- relays ----------
  renderRelays() {
    $('relayTbody').innerHTML = this.relays.map((r, i) => `
      <tr data-rl="${i}">
        <td><input type="number" class="inp inp-sm w-14" data-f="relay_no" value="${r.relay_no}" ${r.__new ? '' : 'readonly'}></td>
        <td><input class="inp inp-sm w-24" data-f="name" value="${escapeHtml(r.name)}"></td>
        <td><input class="inp inp-sm w-16" data-f="type" value="${escapeHtml(r.type)}"></td>
        <td><input class="inp inp-sm w-40" data-f="match_title" value="${escapeHtml(r.match_title || '')}"></td>
        <td><input class="inp inp-sm w-40" data-f="time_text" value="${escapeHtml(r.time_text)}"></td>
        <td><input class="inp inp-sm w-24" data-f="reporting_text" value="${escapeHtml(r.reporting_text)}"></td>
        <td><input class="inp inp-sm w-20" data-f="duration" value="${escapeHtml(r.duration || '')}"></td>
        <td><input type="number" min="1" class="inp inp-sm w-16" data-f="capacity" value="${r.capacity}"></td>
        <td class="text-center"><input type="checkbox" data-f="active" ${r.active ? 'checked' : ''}></td>
        <td class="whitespace-nowrap">
          <button class="btn btn-sm btn-primary" onclick="Admin.saveRelay(${i})"><i class="fa-solid fa-floppy-disk"></i></button>
          <button class="btn btn-sm btn-danger" onclick="Admin.deleteRelay(${i})"><i class="fa-solid fa-trash"></i></button>
        </td>
      </tr>`).join('');
  },

  addRelayRow() {
    const next = Math.max(0, ...this.relays.map(r => r.relay_no)) + 1;
    this.relays.push({ __new: true, relay_no: next, name: `Relay ${pad2(next)}`, type: 'NR', match_title: '', time_text: '', reporting_text: '', duration: '', capacity: 15, active: true });
    this.renderRelays();
  },

  async saveRelay(i) {
    const tr = document.querySelector(`tr[data-rl="${i}"]`);
    try {
      const { relay } = await this.api('relays.save', { relay: this.readRow(tr) });
      this.relays[i] = relay;
      this.relays.sort((a, b) => a.relay_no - b.relay_no);
      this.renderRelays();
      this.fillFilterOptions();
      toast(`Saved ${relay.name}`);
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  async deleteRelay(i) {
    const r = this.relays[i];
    if (r.__new) { this.relays.splice(i, 1); return this.renderRelays(); }
    if (!confirm(`Delete ${r.name}?`)) return;
    try {
      await this.api('relays.delete', { relay_no: r.relay_no });
      this.relays.splice(i, 1);
      this.renderRelays();
      toast('Deleted');
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  // ---------- settings ----------
  getPath(obj, path) {
    return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  },

  renderSettings() {
    document.querySelectorAll('#settingsForm [data-s]').forEach(el => {
      const v = this.getPath(this.settings, el.dataset.s);
      if (el.type === 'checkbox') el.checked = v !== false && v !== undefined && v !== null ? !!v : false;
      else if (el.dataset.type === 'lines') el.value = Array.isArray(v) ? v.join('\n') : '';
      else el.value = v == null ? '' : v;
    });
  },

  async saveSettings() {
    const data = { rules: { ...(this.settings.rules || {}) } };
    let bad = null;
    document.querySelectorAll('#settingsForm [data-s]').forEach(el => {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.dataset.type === 'lines') {
        v = el.value.split(/\s+/).map(s => s.trim()).filter(Boolean);
        if (v.some(d => !/^\d{4}-\d{2}-\d{2}$/.test(d))) bad = 'Match days must be YYYY-MM-DD, one per line.';
      } else v = el.value.trim();
      const path = el.dataset.s.split('.');
      if (path.length === 2) data[path[0]][path[1]] = v;
      else data[path[0]] = v;
    });
    if (bad) return toast(bad, 'err');
    try {
      const { settings } = await this.api('settings.save', { data });
      this.settings = settings;
      this.renderAll();
      toast('Settings saved — the public site updates within ~15 seconds');
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  // ---------- Excel export ----------
  regsSheetRows(list) {
    const relayName = n => (this.relays.find(r => r.relay_no === n) || {}).name || '';
    return list.map(r => {
      const s = scoreOf(r);
      return {
        'Bib': r.bib_no, 'Reg No': r.reg_no, 'Name': r.full_name, "Father's Name": r.father_name, 'Gender': r.gender,
        'DOB': r.dob, 'Mobile': r.phone, 'Email': r.email, 'School/Club': r.club_name, 'State': r.state,
        'Event Code': r.event_code, 'Event': r.event_group, 'Category': r.category, 'Match Date': r.match_date,
        'Relay': relayName(r.relay_no), 'Relay No': r.relay_no, 'Lane': r.lane_no, 'Fee': r.fee, 'Status': r.status,
        'Payment Mode': r.payment_mode, 'Razorpay Payment ID': r.rzp_payment_id, 'Razorpay Order ID': r.rzp_order_id,
        'Paid At': r.paid_at, 'Source': r.source, 'Notes': r.notes,
        'S1': s.s1, 'S2': s.s2, 'S3': s.s3, 'S4': s.s4, 'S5': s.s5, 'S6': s.s6, 'Total': s.total, '10x': s.inner_tens, 'Score Status': s.status
      };
    });
  },

  exportRegsXlsx() {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(this.regsSheetRows(this.filteredRegs())), 'Athletes');
    XLSX.writeFile(wb, `Athletes_${stamp()}.xlsx`);
  },

  exportResultsXlsx() {
    const wb = XLSX.utils.book_new();
    const paid = this.regs.filter(r => r.status === 'paid');
    const codes = [...new Set(paid.map(r => r.event_code))].sort();
    const all = [];
    codes.forEach(code => {
      const ev = this.eventByCode(code) || {};
      const n = seriesCount(ev.shots);
      const rows = paid.filter(r => r.event_code === code).map(r => ({ r, s: scoreOf(r) }))
        .sort((a, b) => (Number(b.s.total) || 0) - (Number(a.s.total) || 0) || (b.s.inner_tens || 0) - (a.s.inner_tens || 0));
      rows.forEach((x, i) => {
        const row = { 'Rank': x.s.rank_override || i + 1, 'Bib': x.r.bib_no, 'Name': x.r.full_name, 'School/Club': x.r.club_name, 'Event Code': code, 'Category': `${ev.event_group || ''} / ${ev.category || ''}` };
        for (let k = 1; k <= n; k++) row[`S${k}`] = x.s['s' + k];
        Object.assign(row, { 'Total': x.s.total, '10x': x.s.inner_tens, 'Status': x.s.status, 'Remarks': x.s.remarks });
        all.push(row);
      });
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(all.length ? all : [{ Note: 'No results yet' }]), 'Results');
    XLSX.writeFile(wb, `Results_${stamp()}.xlsx`);
  },

  downloadTemplate(kind) {
    const wb = XLSX.utils.book_new();
    if (kind === 'regs') {
      const ex = this.events[0] || {};
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{
        'Name': 'Aarav Sharma', "Father's Name": 'Rajesh Sharma', 'Gender': 'Male', 'DOB': '2011-05-14', 'Mobile': '9876543210',
        'Email': '', 'School/Club': 'Babu Bodhraj Convent School', 'State': 'Uttar Pradesh', 'Event Code': ex.code || 'AR-04',
        'Match Date': this.matchDays()[0] || '2026-11-25', 'Relay No': 1, 'Lane': '', 'Bib': '', 'Fee': '', 'Status': 'paid', 'Payment Mode': 'cash', 'Notes': ''
      }]), 'Athletes');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(this.events.map(e => ({ 'Event Code': e.code, 'Event': e.event_group, 'Category': e.category, 'Gender': e.gender, 'Fee': e.fee }))), 'Event Codes');
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(this.relays.map(r => ({ 'Relay No': r.relay_no, 'Name': r.name, 'Time': r.time_text, 'Seats': r.capacity }))), 'Relays');
      XLSX.writeFile(wb, 'Athletes_Import_Template.xlsx');
    } else {
      const code = $('rEvent').value;
      const rows = this.regs.filter(r => r.status === 'paid' && (!code || r.event_code === code));
      const n = seriesCount((this.eventByCode(code) || {}).shots);
      const data = (rows.length ? rows : [{ bib_no: 101, full_name: 'Example Shooter' }]).map(r => {
        const s = scoreOf(r);
        const row = { 'Bib': r.bib_no, 'Name (info only)': r.full_name };
        for (let k = 1; k <= n; k++) row[`S${k}`] = s['s' + k] ?? '';
        Object.assign(row, { '10x': s.inner_tens ?? '', 'Status': s.status || 'finished', 'Remarks': s.remarks || '' });
        return row;
      });
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), 'Results');
      XLSX.writeFile(wb, `Results_Template_${code || 'all'}.xlsx`);
    }
  },

  // ---------- Excel import ----------
  HEADER_MAP: {
    regs: {
      full_name: ['name', 'fullname', 'athletename', 'shootername', 'studentname'],
      father_name: ['fathersname', 'fathername', 'father'],
      gender: ['gender', 'sex'],
      dob: ['dob', 'dateofbirth', 'birthdate'],
      phone: ['mobile', 'phone', 'mobileno', 'mobilenumber', 'contact', 'contactno', 'phoneno'],
      email: ['email', 'emailid'],
      club_name: ['schoolclub', 'school', 'club', 'academy', 'clubname', 'schoolname', 'institution'],
      state: ['state'],
      event_code: ['eventcode', 'code', 'matchcode', 'matchno', 'eventno'],
      match_date: ['matchdate', 'date', 'day'],
      relay_no: ['relayno', 'relay', 'relaynumber'],
      lane_no: ['lane', 'laneno', 'target', 'targetno'],
      bib_no: ['bib', 'bibno', 'bibnumber'],
      fee: ['fee', 'amount', 'feepaid'],
      status: ['status', 'paymentstatus'],
      payment_mode: ['paymentmode', 'mode', 'paymentmethod'],
      notes: ['notes', 'remarks', 'note']
    },
    scores: {
      bib_no: ['bib', 'bibno', 'bibnumber'],
      reg_no: ['regno', 'registrationno', 'registrationnumber'],
      s1: ['s1', 'series1', 'ser1'], s2: ['s2', 'series2', 'ser2'], s3: ['s3', 'series3', 'ser3'],
      s4: ['s4', 'series4', 'ser4'], s5: ['s5', 'series5', 'ser5'], s6: ['s6', 'series6', 'ser6'],
      total: ['total', 'totalscore', 'score'],
      inner_tens: ['10x', 'x', 'innertens', 'innerten', 'xcount', 'tenx'],
      status: ['status'],
      final_score: ['final', 'finalscore'],
      rank_override: ['rank', 'rankoverride'],
      remarks: ['remarks', 'remark', 'notes']
    }
  },

  openImport(kind) {
    this.importKind = kind;
    this.importRows = [];
    $('importFile').value = '';
    $('importPreview').innerHTML = '';
    $('importGo').disabled = true;
    $('importTitle').textContent = kind === 'regs' ? 'Import athletes from Excel' : 'Import results from Excel';
    $('importHelp').innerHTML = kind === 'regs'
      ? 'First sheet is read. Required columns: <b>Name, Mobile, Gender, Event Code</b>. Optional: Match Date (YYYY-MM-DD or DD/MM/YYYY), Relay No, Lane, Bib, Fee, Status (paid/pending), Payment Mode, School/Club, DOB, Notes. Lanes and bibs are auto-assigned when blank. Download the template to see the format.'
      : 'First sheet is read. Each row needs <b>Bib</b> (or Reg No) and series scores <b>S1…S6</b>, plus optional 10x, Status, Remarks, Rank. Rows replace the stored scores of that shooter. If a sheet has only a Total column, it is stored as S1.';
    $('importModal').showModal();
  },

  async parseImportFile(file) {
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
      const map = this.HEADER_MAP[this.importKind];
      const norm = h => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');
      const headers = raw.length ? Object.keys(raw[0]) : [];
      const colFor = {};
      const unknown = [];
      headers.forEach(h => {
        const key = Object.keys(map).find(k => map[k].includes(norm(h)));
        if (key && !colFor[key]) colFor[key] = h; else if (!key) unknown.push(h);
      });

      this.importRows = raw.map((r, i) => {
        const o = { __row: i + 2 };
        Object.entries(colFor).forEach(([k, h]) => {
          let v = r[h];
          if (['dob', 'match_date'].includes(k)) v = toISODate(v);
          else if (v instanceof Date) v = toISODate(v);
          o[k] = typeof v === 'string' ? v.trim() : v;
        });
        if (this.importKind === 'scores') {
          const hasSeries = ['s1', 's2', 's3', 's4', 's5', 's6'].some(k => o[k] !== undefined && o[k] !== '');
          if (!hasSeries && o.total !== undefined && o.total !== '') o.s1 = o.total;
          delete o.total;
        }
        return o;
      }).filter(o => Object.keys(o).some(k => k !== '__row' && o[k] !== '' && o[k] !== undefined));

      const need = this.importKind === 'regs' ? ['full_name', 'phone', 'event_code'] : [];
      const missing = need.filter(k => !colFor[k]);
      if (this.importKind === 'scores' && !colFor.bib_no && !colFor.reg_no) missing.push('bib_no');

      const cols = Object.keys(colFor);
      $('importPreview').innerHTML = `
        <p class="mb-2">Found <b>${this.importRows.length}</b> rows. Columns understood: <span class="mono text-emerald-300">${cols.map(escapeHtml).join(', ') || '—'}</span>
        ${unknown.length ? `<br>Ignored columns: <span class="mono text-slate-400">${unknown.map(escapeHtml).join(', ')}</span>` : ''}</p>
        ${missing.length ? `<p class="text-rose-300 mb-2">Missing required column(s): <b>${missing.join(', ')}</b>. Fix the header row and choose the file again.</p>` : ''}
        <div class="max-h-60 overflow-auto"><table class="grid"><thead><tr><th>Row</th>${cols.map(c => `<th>${escapeHtml(c)}</th>`).join('')}</tr></thead>
        <tbody>${this.importRows.slice(0, 15).map(r => `<tr><td>${r.__row}</td>${cols.map(c => `<td>${escapeHtml(r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
        ${this.importRows.length > 15 ? `<p class="text-slate-500 mt-1">…and ${this.importRows.length - 15} more</p>` : ''}`;
      $('importGo').disabled = !!missing.length || !this.importRows.length;
    } catch (e) {
      $('importPreview').innerHTML = `<p class="text-rose-300">Could not read this file: ${escapeHtml(e.message)}</p>`;
    }
  },

  async runImport() {
    const kind = this.importKind;
    const rows = this.importRows;
    const batch = kind === 'regs' ? 100 : 300;
    const results = [];
    $('importGo').disabled = true;
    for (let i = 0; i < rows.length; i += batch) {
      $('importPreview').innerHTML = `<p><i class="fa-solid fa-spinner fa-spin mr-2"></i>Importing ${Math.min(i + batch, rows.length)} / ${rows.length}...</p>`;
      try {
        const r = await this.api(kind === 'regs' ? 'regs.import' : 'scores.import', { rows: rows.slice(i, i + batch) });
        results.push(...r.results);
      } catch (e) {
        rows.slice(i, i + batch).forEach(x => results.push({ row: x.__row, ok: false, error: e.message }));
      }
    }
    const failed = results.filter(r => !r.ok);
    $('importPreview').innerHTML = `
      <p class="mb-2"><b class="text-emerald-300">${results.length - failed.length} imported</b>${failed.length ? `, <b class="text-rose-300">${failed.length} failed</b>` : ''}.</p>
      ${failed.length ? `<div class="max-h-60 overflow-auto"><table class="grid"><thead><tr><th>Excel row</th><th>Problem</th></tr></thead><tbody>
        ${failed.map(f => `<tr><td>${f.row}</td><td class="text-rose-300">${escapeHtml(f.error)}</td></tr>`).join('')}</tbody></table></div>
        <button class="btn btn-sm mt-2" onclick="Admin.downloadImportErrors()">Download error list</button>` : ''}`;
    this.lastImportErrors = failed;
    await this.reloadRegs();
  },

  downloadImportErrors() {
    const failed = this.lastImportErrors || [];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(failed.map(f => ({ 'Excel Row': f.row, 'Problem': f.error }))), 'Errors');
    XLSX.writeFile(wb, `Import_Errors_${stamp()}.xlsx`);
  },

  // ---------- backup ----------
  async downloadBackup(fmt) {
    try {
      const { backup } = await this.api('backup.export');
      if (fmt === 'json') {
        downloadBlob(new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' }), `NexShot_Backup_${stamp()}.json`);
      } else {
        const scoresById = new Map(backup.scores.map(s => [s.registration_id, s]));
        const regs = backup.registrations.map(r => ({ ...r, scores: scoresById.get(r.id) || {} }));
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(this.regsSheetRows(regs)), 'Registrations');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(backup.events), 'Events');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(backup.relays), 'Relays');
        XLSX.writeFile(wb, `NexShot_Backup_${stamp()}.xlsx`);
      }
      toast('Backup downloaded');
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  async restoreBackup() {
    const file = $('restoreFile').files[0];
    if (!file) return toast('Choose a JSON backup file first', 'err');
    let backup;
    try {
      backup = JSON.parse(await file.text());
    } catch (e) {
      return toast('That file is not valid JSON', 'err');
    }
    const n = (backup.registrations || []).length;
    if (prompt(`Restore ${n} registrations from ${backup.exportedAt || 'this file'}?\nType RESTORE to continue.`) !== 'RESTORE') return;
    try {
      const { counts } = await this.api('backup.restore', { backup });
      toast(`Restored: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')}`);
      await this.refreshAll();
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  async loadLogs() {
    try {
      const { audit, payments } = await this.api('audit.list');
      $('auditTbody').innerHTML = audit.map(a => `<tr><td class="mono whitespace-nowrap">${fmtTime(a.at)}</td><td>${escapeHtml(a.action)}</td><td class="mono text-[10px] text-slate-400 max-w-[280px] truncate" title="${escapeHtml(JSON.stringify(a.detail))}">${escapeHtml(JSON.stringify(a.detail))}</td></tr>`).join('');
      $('payTbody').innerHTML = payments.map(p => `<tr><td class="mono whitespace-nowrap">${fmtTime(p.received_at)}</td><td>${escapeHtml(p.source)}</td><td>${escapeHtml(p.event_type)}</td><td class="mono text-[10px]">${escapeHtml(p.order_id || '')}<br>${escapeHtml(p.payment_id || '')}</td></tr>`).join('');
    } catch (e) {
      toast(e.message, 'err');
    }
  },

  printRoster() {
    const day = $('rosterDay').value;
    const paid = this.regs.filter(r => r.status === 'paid' && r.match_date === day);
    const w = window.open('', '_blank');
    if (!w) return toast('Allow pop-ups to open the roster', 'err');
    const sections = this.relays.map(rl => {
      const list = paid.filter(r => r.relay_no === rl.relay_no).sort((a, b) => (a.lane_no || 99) - (b.lane_no || 99));
      if (!list.length) return '';
      return `<h2>${escapeHtml(rl.name)} — ${escapeHtml(rl.time_text)} (Reporting ${escapeHtml(rl.reporting_text)}) • ${list.length}/${rl.capacity}</h2>
        <table><thead><tr><th>Lane</th><th>Bib</th><th>Name</th><th>Father</th><th>School/Club</th><th>Event</th><th>Mobile</th><th>Sign</th></tr></thead><tbody>
        ${list.map(r => `<tr><td>${r.lane_no || '—'}</td><td>${r.bib_no}</td><td>${escapeHtml(r.full_name)}</td><td>${escapeHtml(r.father_name || '')}</td><td>${escapeHtml(r.club_name || '')}</td><td>${escapeHtml(r.event_code)} ${escapeHtml(r.category || '')}</td><td>${escapeHtml(r.phone)}</td><td></td></tr>`).join('')}
        </tbody></table>`;
    }).join('');
    const noSlot = paid.length ? '' : '<p>No paid shooters on this day.</p>';
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Roster ${escapeHtml(day)}</title>
      <style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px}h1{font-size:18px}h2{font-size:14px;margin-top:22px}
      table{width:100%;border-collapse:collapse}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}
      h2{page-break-after:avoid}table{page-break-inside:auto}tr{page-break-inside:avoid}</style></head><body>
      <h1>${escapeHtml(this.settings.tournamentName || 'Tournament')} — Roster ${escapeHtml(fmtDay(day))}</h1>
      <p>Printed ${escapeHtml(new Date().toLocaleString('en-IN'))} • ${paid.length} paid shooters</p>${sections}${noSlot}
      <script>window.print()<\/script></body></html>`);
    w.document.close();
  }
};

window.Admin = Admin;
document.addEventListener('DOMContentLoaded', () => Admin.init());

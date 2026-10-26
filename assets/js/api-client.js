// ================= NEXSHOT PUBLIC API CLIENT ================= //
// The browser never talks to the database directly. Everything goes through /api/*,
// which validates input and keeps personal data private.

const NexShotDB = {
  async _get(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) {
      const err = new Error(json.error || json.message || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return json;
  },

  async _post(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok && !json.pending) {
      const err = new Error(json.error || `Request failed (${res.status})`);
      err.status = res.status;
      throw err;
    }
    return json;
  },

  /** Leaderboard rows (cached copy is used if the network fails). */
  async getLiveScores() {
    try {
      const json = await this._get('/api/scores');
      try { localStorage.setItem('nexshot_cached_scores_v2', JSON.stringify(json.scores || [])); } catch (e) {}
      return { published: json.published !== false, scores: json.scores || [], live: true };
    } catch (err) {
      console.warn('Scores fetch failed, showing last cached copy:', err.message);
      let cached = [];
      try { cached = JSON.parse(localStorage.getItem('nexshot_cached_scores_v2') || '[]'); } catch (e) {}
      return { published: true, scores: cached, live: false };
    }
  },

  /** Seats taken per relay on a date: { relayNo: count } */
  async getSlots(date) {
    const json = await this._get(`/api/slots?date=${encodeURIComponent(date)}`);
    return json.taken || {};
  },

  /** All passes for a mobile number. */
  async getPasses(mobile) {
    const json = await this._get(`/api/track?mobile=${encodeURIComponent(mobile)}`);
    return json.passes || [];
  },

  createOrder(athlete) {
    return this._post('/api/create-order', athlete);
  },

  verifyPayment(payload) {
    return this._post('/api/verify-payment', payload);
  }
};

window.NexShotDB = NexShotDB;

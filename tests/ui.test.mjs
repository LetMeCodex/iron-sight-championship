// Headless UI smoke test with Edge + a fake Razorpay checkout
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const B = 'http://127.0.0.1:3099';
const RUN = String(Date.now()).slice(-6);
const MOB = '94' + String(Date.now()).slice(-8);
import os from 'node:os';
const shots = process.argv[2] || fs.mkdtempSync(os.tmpdir() + '/nexshot-ui-');
const BROWSER = process.env.BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
let fails = 0;
const ok = (c, m, extra) => { console.log((c ? 'PASS ' : 'FAIL ') + m + (c || extra === undefined ? '' : '  -> ' + JSON.stringify(extra).slice(0, 400))); if (!c) fails++; };

const browser = await puppeteer.launch({
  executablePath: BROWSER,
  headless: true,
  args: ['--no-first-run']
});
const errors = [];
async function newPage(name) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  page.on('pageerror', e => errors.push(`[${name}] ${e.message}`));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|tailwind|ERR_INVALID_URL|status of 401/i.test(m.text())) errors.push(`[${name}] console: ${m.text()}`); });
  page.on('dialog', async d => { page.__lastDialog = d.message(); await d.accept(d.defaultValue()); });
  await page.setRequestInterception(true);
  page.on('request', req => {
    if (req.url().startsWith('https://checkout.razorpay.com/')) {
      // Fake checkout: "pays" through the fake gateway and calls the handler like the real one
      return req.respond({ status: 200, contentType: 'application/javascript', body: `
        window.Razorpay = function (opts) {
          this.opts = opts;
          this.on = function () {};
          this.open = async function () {
            const p = await window.__fakePay(opts.order_id);
            opts.handler({ razorpay_order_id: opts.order_id, razorpay_payment_id: p.id, razorpay_signature: p.signature });
          };
        };` });
    }
    req.continue();
  });
  await page.exposeFunction('__fakePay', async orderId =>
    (await fetch('http://127.0.0.1:54322/__pay', { method: 'POST', body: JSON.stringify({ order_id: orderId }) })).json());
  return page;
}

// ---------- home ----------
let page = await newPage('home');
await page.goto(B + '/', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 1500));
const countdown = await page.$eval('#countdownText', el => el.innerText).catch(() => null);
ok(countdown && /^T-\d+D/.test(countdown), 'home countdown runs (portal.js loads)', countdown);
ok(await page.evaluate(() => typeof saveBooking === 'function' && typeof showToast === 'function'), 'portal.js helpers defined');
await page.screenshot({ path: `${shots}/ui_home.png` });

// ---------- register + pay ----------
page = await newPage('register');
await page.goto(B + '/register', { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.querySelectorAll('#regEvent option').length > 2, { timeout: 10000 });
const groups = await page.$$eval('#regEvent option', os => os.map(o => o.value).filter(Boolean));
ok(groups.length === 9, 'event dropdown built from server (9 groups)', groups);
await page.type('#regName', 'Browser Test Kid ' + RUN);
await page.type('#regFather', 'Parent Name');
await page.$eval('#regDob', el => { el.value = '2012-03-04'; el.dispatchEvent(new Event('change')); });
await page.type('#regSchool', 'UI Test School');
await page.type('#regMobile', MOB);
await page.select('#regEvent', 'Little Champ 10M Air Rifle');
await page.waitForFunction(() => document.getElementById('regCategory').value);
const fee = await page.$eval('#feeValue', el => el.innerText);
ok(/1,000/.test(fee), 'fee shows ₹1,000 for Little Champ', fee);
await page.waitForFunction(() => document.querySelectorAll('#relaysContainer .relay-box').length > 0, { timeout: 10000 });
const dateTabs = await page.$$eval('#dateTabs button', bs => bs.map(b => b.innerText));
ok(dateTabs.length === 4, 'four match-day tabs from settings', dateTabs);
await page.click('#dateTabs button:nth-child(2)');
await page.waitForNetworkIdle({ idleTime: 400 });
await page.evaluate(() => document.querySelectorAll('#relaysContainer .relay-box')[1].click());
await page.click('#shooterForm button[type="submit"]');
await page.waitForSelector('#payModal:not(.hidden)');
const modalAmt = await page.$eval('#modalPayAmt', el => el.innerText);
ok(/1,000/.test(modalAmt), 'checkout modal shows ₹1,000', modalAmt);
await page.click('#btnModalConfirm');
await page.waitForFunction(() => document.getElementById('stravaOverlay').classList.contains('active'), { timeout: 15000 }).catch(() => {});
const passId = await page.$eval('#ticketPassId', el => el.innerText).catch(() => '');
const lane = await page.$eval('#ticketLane', el => el.innerText).catch(() => '');
ok(/^NSC-\d{4}-\d+ • BIB \d+$/.test(passId), 'success screen shows real reg no + bib', { passId, dialog: page.__lastDialog });
ok(/Lane #\d+/.test(lane), 'success screen shows lane', lane);
await page.screenshot({ path: `${shots}/ui_register_success.png` });
const saved = await page.evaluate(() => getBookings().length);
ok(saved >= 1, 'pass saved locally as offline backup');

// ---------- track ----------
page = await newPage('track');
await page.goto(B + '/track-booking?mobile=' + MOB, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => !document.getElementById('bookingResultArea').classList.contains('hidden'), { timeout: 10000 }).catch(() => {});
const trackName = await page.$eval('#cardAthleteName', el => el.innerText).catch(() => '');
const trackRelay = await page.$eval('#cardRelay', el => el.innerText).catch(() => '');
ok(trackName === 'Browser Test Kid ' + RUN && /Relay 02/.test(trackRelay), 'track page shows the pass', { trackName, trackRelay });
await page.screenshot({ path: `${shots}/ui_track.png` });

// ---------- live scores ----------
page = await newPage('live');
await page.goto(B + '/live-scoring', { waitUntil: 'networkidle2' });
await page.waitForFunction(() => document.querySelectorAll('#liveScoresTbody tr').length > 0);
const liveText = await page.$eval('#liveScoresTbody', el => el.innerText);
ok(/Test Shooter 1/.test(liveText) && /625\.0/.test(liveText), 'live leaderboard shows saved score', liveText.slice(0, 200));

page = await newPage('category');
await page.goto(B + '/category-wise-scoring', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 800));
const catText = await page.$eval('#tbodyRifle', el => el.innerText);
ok(/Test Shooter 1/.test(catText), 'category page shows rifle results');

// ---------- admin ----------
page = await newPage('admin');
await page.goto(B + '/admin', { waitUntil: 'networkidle2' });
await page.type('#loginPassword', 'wrong-pass');
await page.click('#loginForm button[type="submit"]');
await page.waitForFunction(() => !document.getElementById('loginError').classList.contains('hidden'));
ok(true, 'admin wrong password shows error');
await page.$eval('#loginPassword', el => { el.value = ''; });
await page.type('#loginPassword', 'TestPass#2026');
await page.click('#loginForm button[type="submit"]');
await page.waitForFunction(() => document.querySelectorAll('#statCards .card').length === 4, { timeout: 10000 });
const stat = await page.$eval('#statCards', el => el.innerText);
ok(/Paid entries/.test(stat), 'admin overview loaded', stat.slice(0, 120));
await page.screenshot({ path: `${shots}/ui_admin_overview.png` });

// athletes tab + search
await page.click('[data-tab="athletes"]');
await page.type('#fSearch', 'Browser Test Kid ' + RUN);
const athRows = await page.$$eval('#athTbody tr', rs => rs.length);
ok(athRows === 1, 'athlete search finds the browser registration', athRows);

// walk-in via modal
await page.$eval('#fSearch', el => { el.value = ''; el.dispatchEvent(new Event('input')); });
await page.click('button[onclick="Admin.openRegModal()"]');
await page.type('#regForm [name=full_name]', 'Desk Walkin');
await page.type('#regForm [name=phone]', '95' + String(Date.now()).slice(-8));
await page.select('#regForm [name=event_code]', 'AP-01');
await page.select('#regForm [name=match_date]', '2026-11-27');
await page.select('#regForm [name=relay_no]', '5');
await page.click('#regSaveBtn');
await page.waitForFunction(() => !document.getElementById('regModal').open, { timeout: 10000 }).catch(() => {});
await page.waitForNetworkIdle({ idleTime: 400 });
await page.$eval('#fSearch', el => { el.value = 'Desk Walkin'; el.dispatchEvent(new Event('input')); });
const walkRow = await page.$eval('#athTbody', el => el.innerText);
ok(/Desk Walkin/.test(walkRow) && /PAID/.test(walkRow) && /L\d/.test(walkRow), 'walk-in added from modal with lane', walkRow.slice(0, 200));
await page.screenshot({ path: `${shots}/ui_admin_athletes.png` });

// results entry
await page.click('[data-tab="results"]');
await page.select('#rEvent', 'AP-01');
await page.waitForSelector('#resTbody tr[data-id] input');
const rowsBefore = await page.$$eval('#resTbody tr[data-id]', rs => rs.length);
const first = await page.$('#resTbody tr[data-id] input');
await first.click({ clickCount: 3 });
await first.type('97');
await new Promise(r => setTimeout(r, 900));
const dirty = await page.$$eval('#resTbody tr.dirty', rs => rs.length);
ok(rowsBefore >= 1 && dirty === 1, 'typing a score marks row unsaved', { rowsBefore, dirty });
await page.click('#btnSaveAllScores');
await page.waitForFunction(() => document.querySelectorAll('#resTbody tr.dirty').length === 0, { timeout: 10000 }).catch(() => {});
const after = await page.$$eval('#resTbody tr.dirty', rs => rs.length);
ok(after === 0, 'save all clears unsaved rows');
await page.screenshot({ path: `${shots}/ui_admin_results.png` });

// Excel/CSV import of athletes
const csv = 'Name,Mobile,Gender,Event Code,Match Date,Relay No\nCsv Kid One,9666666661,Male,AR-12,27/11/2026,6\nCsv Kid Two,9666666662,Female,AR-16,2026-11-27,6\nBad Row,123,Male,AR-12,,\n';
const csvPath = `${shots}/import_test.csv`;
fs.writeFileSync(csvPath, csv);
await page.click('[data-tab="athletes"]');
await page.click('button[onclick="Admin.openImport(\'regs\')"]');
const input = await page.$('#importFile');
await input.uploadFile(csvPath);
await page.waitForFunction(() => !document.getElementById('importGo').disabled, { timeout: 10000 }).catch(() => {});
const prev = await page.$eval('#importPreview', el => el.innerText);
ok(/Found 3 rows/.test(prev), 'import preview parsed 3 rows', prev.slice(0, 200));
await page.click('#importGo');
await page.waitForFunction(() => /imported/.test(document.getElementById('importPreview').innerText), { timeout: 20000 }).catch(() => {});
const impRes = await page.$eval('#importPreview', el => el.innerText);
ok(/2 imported/.test(impRes) && /1 failed/.test(impRes), 'import: 2 imported, 1 failed with reason', impRes.slice(0, 300));
await page.screenshot({ path: `${shots}/ui_admin_import.png` });

// settings save
await page.keyboard.press('Escape');
await page.click('[data-tab="settings"]');
await page.$eval('[data-s="announcementText"]', el => { el.value = 'UI test notice <b>bold?</b>'; });
await page.click('button[onclick="Admin.saveSettings()"]');
await new Promise(r => setTimeout(r, 1200));
const cfg = await (await fetch(B + '/api/config')).json();
ok(cfg.settings.announcementText === 'UI test notice <b>bold?</b>', 'settings saved to server');

// announcement is escaped on public page (XSS check)
page = await newPage('home2');
await page.goto(B + '/', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 1500));
const bar = await page.$eval('#globalAnnouncementBar', el => ({ text: el.innerText, bold: !!el.querySelector('b') })).catch(() => null);
ok(bar && /<b>bold\?<\/b>/.test(bar.text) && !bar.bold, 'notice text is shown as text, not HTML', bar);

// mobile viewport register page
page = await newPage('mobile');
await page.setViewport({ width: 390, height: 844, isMobile: true });
await page.goto(B + '/register', { waitUntil: 'networkidle2' });
await new Promise(r => setTimeout(r, 1200));
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
ok(overflow <= 1, 'register page has no horizontal scroll on phone', overflow);
await page.screenshot({ path: `${shots}/ui_register_mobile.png`, fullPage: false });

ok(errors.length === 0, 'no JavaScript errors on any page', errors);
await browser.close();
console.log(fails ? `\n${fails} FAILED` : '\nALL PASSED');
process.exit(fails ? 1 : 0);

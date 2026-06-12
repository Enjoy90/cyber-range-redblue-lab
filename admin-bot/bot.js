/* =====================================================================
 *  ADMIN BOT  -  "Korban" simulasi untuk stored XSS
 * ---------------------------------------------------------------------
 *  KENAPA PERLU BOT INI?
 *    Serangan XSS butuh KORBAN yang punya cookie admin. Bot ini berperan
 *    jadi admin yang:
 *      1. Login penuh (password + MFA) -> dapat cookie sesi adm_sess
 *         (cookie HttpOnly=false, jadi bisa dibaca JavaScript).
 *      2. Secara berkala membuka /dashboard.
 *    Saat bot membuka /dashboard, payload XSS yang ditanam Red Team lewat
 *    feedback akan TEREKSEKUSI di dalam browser bot -> mencuri cookie bot
 *    -> mengirimnya (exfil) ke listener Red Team via fetch().
 *
 *  Pakai Playwright (Chromium headless) karena lebih stabil di Docker
 *  dibanding Puppeteer (image resmi sudah membawa dependency browser).
 * =====================================================================
 */

const { chromium } = require('playwright');

const TARGET = process.env.TARGET_URL || 'http://nginx:3075';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'Superadmin123';      // HARUS sama dengan ADMIN_PASS di app/server.js
const ADMIN_OTP = '135790';
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '8000', 10); // poll tiap 8 detik

async function adminLoginAndBrowse() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'], // wajib di container
  });
  try {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();

    // Langkah 1: login password
    await page.goto(`${TARGET}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name=username]', ADMIN_USER);
    await page.fill('input[name=password]', ADMIN_PASS);
    await page.click('button[type=submit]');

    // Langkah 2: verifikasi MFA -> dapat cookie sesi adm_sess
    await page.waitForLoadState('domcontentloaded');
    await page.fill('input[name=otp]', ADMIN_OTP);
    await page.click('button[type=submit]');
    await page.waitForLoadState('domcontentloaded');

    // Langkah 3: buka dashboard berulang -> memicu stored XSS bila ada
    console.log('[admin-bot] logged in. Will browse /dashboard periodically...');
    // eslint-disable-next-line no-constant-condition
    while (true) {
      await page.goto(`${TARGET}/dashboard`, { waitUntil: 'networkidle' });
      console.log(`[admin-bot] visited /dashboard at ${new Date().toISOString()}`);
      await page.waitForTimeout(INTERVAL_MS);
    }
  } catch (err) {
    console.error('[admin-bot] error:', err.message);
  } finally {
    await browser.close();
  }
}

// Retry loop: kalau app belum siap, coba lagi.
(async function main() {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await adminLoginAndBrowse();
    } catch (e) {
      console.error('[admin-bot] restart in 5s:', e.message);
    }
    await new Promise(r => setTimeout(r, 5000));
  }
})();

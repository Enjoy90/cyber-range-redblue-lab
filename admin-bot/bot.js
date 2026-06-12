/*
 * Admin bot — simulates a logged-in administrator who periodically opens the
 * dashboard, so stored content rendered there is exercised in a real browser.
 * Uses Playwright (headless Chromium).
 */

const { chromium } = require('playwright');

const TARGET = process.env.TARGET_URL || 'http://nginx:3075';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'Superadmin123';      // must match ADMIN_PASS in app/server.js
const ADMIN_OTP = '135790';
const INTERVAL_MS = parseInt(process.env.INTERVAL_MS || '8000', 10);

async function adminLoginAndBrowse() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();

    // Step 1: password login
    await page.goto(`${TARGET}/login`, { waitUntil: 'domcontentloaded' });
    await page.fill('input[name=username]', ADMIN_USER);
    await page.fill('input[name=password]', ADMIN_PASS);
    await page.click('button[type=submit]');

    // Step 2: MFA
    await page.waitForLoadState('domcontentloaded');
    await page.fill('input[name=otp]', ADMIN_OTP);
    await page.click('button[type=submit]');
    await page.waitForLoadState('domcontentloaded');

    // Step 3: keep visiting the dashboard
    console.log('[admin-bot] logged in. Browsing /dashboard periodically...');
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

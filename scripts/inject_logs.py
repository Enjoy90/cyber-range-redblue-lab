#!/usr/bin/env python3
"""
Seed a deterministic attack timeline into the log directory so the Blue Team
has consistent forensic evidence to analyze. Run once on deployment.
"""

import os

LOG_DIR         = os.environ.get("LOG_DIR", "/opt/admin/logs")
ACCESS_LOG      = os.path.join(LOG_DIR, "access.log")
ERROR_LOG       = os.path.join(LOG_DIR, "error.log")

ATTACKER_IP     = "10.10.14.50"
ATTACKER_SUBNET = "10.10.14.0/24"
ATTACKER_UA     = "Mozilla/5.0"
ADMIN_IP        = "192.168.1.100"
ADMIN_UA        = "Mozilla/5.0 (X11; Linux x86_64; rv:115.0) Gecko/20100101 Firefox/115.0"

DATE            = "12/Jun/2026"
ERR_DATE        = "2026/06/12"
TZ              = "+0700"

EXFIL_B64       = "UEhBTlRPTUdSSUR7QkxVRV9MMGdfSHVudDNyX000c3Qzcn0"

TS_WAF_BLOCK    = "18:50:15"
TS_DASH_200     = "18:51:55"
TS_ANOMALY      = "18:53:10"


def acc(ip, ts, request, status, ua, xff="-", referer="-", size=512):
    """Build one nginx 'combined' access-log line (with X-Forwarded-For)."""
    return (f'{ip} - - [{DATE}:{ts} {TZ}] "{request}" {status} {size} '
            f'"{referer}" "{ua}" "{xff}"')


def build_access_log():
    lines = [
        # Legitimate administrative baseline traffic.
        acc(ADMIN_IP, "18:30:02", "GET /login HTTP/1.1", 200, ADMIN_UA),
        acc(ADMIN_IP, "18:30:48", "POST /login HTTP/1.1", 302, ADMIN_UA),
        acc(ADMIN_IP, "18:31:10", "POST /api/verify-mfa HTTP/1.1", 302, ADMIN_UA),
        acc(ADMIN_IP, "18:31:12", "GET /dashboard HTTP/1.1", 200, ADMIN_UA),
        acc(ADMIN_IP, "18:42:33", "GET /dashboard HTTP/1.1", 200, ADMIN_UA),
        # Attacker reconnaissance.
        acc(ATTACKER_IP, "18:49:01", "GET / HTTP/1.1", 200, ATTACKER_UA),
        acc(ATTACKER_IP, "18:49:07", "GET /robots.txt HTTP/1.1", 200, ATTACKER_UA),
        acc(ATTACKER_IP, "18:49:20", "GET /dashboard HTTP/1.1", 302, ATTACKER_UA),
        # Blocked payload, then a bypass that is stored.
        acc(ATTACKER_IP, TS_WAF_BLOCK, "POST /feedback HTTP/1.1", 403, ATTACKER_UA),
        acc(ATTACKER_IP, "18:50:40", "POST /feedback HTTP/1.1", 200, ATTACKER_UA),
        # Replayed session reaching the dashboard; stolen data in X-Forwarded-For.
        acc(ATTACKER_IP, TS_DASH_200, "GET /dashboard HTTP/1.1", 200,
            ATTACKER_UA, xff=EXFIL_B64),
    ]
    # Note: the attacker never requests /api/verify-mfa.
    return "\n".join(lines) + "\n"


def build_error_log():
    lines = [
        f'{ERR_DATE} {TS_WAF_BLOCK} [error] 1011#0: *1 [WAF] 403 Forbidden - '
        f'blocked <script> tag from client {ATTACKER_IP}, server: feedback.admin.local, '
        f'request: "POST /feedback HTTP/1.1", host: "feedback.admin.local"',
        f'{ERR_DATE} {TS_ANOMALY} [CRITICAL] Authentication bypass anomaly: '
        f'cookie reuse (adm_sess) detected from {ATTACKER_IP} (subnet {ATTACKER_SUBNET}) - '
        f'valid admin session replayed, /api/verify-mfa was NOT reached. Possible session hijacking.',
    ]
    return "\n".join(lines) + "\n"


def main():
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(ACCESS_LOG, "w") as f:
        f.write(build_access_log())
    with open(ERROR_LOG, "w") as f:
        f.write(build_error_log())
    print(f"[inject_logs] wrote {ACCESS_LOG}")
    print(f"[inject_logs] wrote {ERROR_LOG}")


if __name__ == "__main__":
    main()

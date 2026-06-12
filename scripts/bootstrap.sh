#!/usr/bin/env bash
# =====================================================================
#  bootstrap.sh  -  Provisioning otomatis di DALAM VM Linux
# ---------------------------------------------------------------------
#  APA: satu script yang menyiapkan seluruh lab dari nol di Ubuntu VM:
#    1. Install Docker + Docker Compose plugin
#    2. Siapkan direktori log /opt/admin/logs
#    3. Buat user SSH Blue Team "analyst" + ubah SSH ke port 2275
#    4. Build & jalankan docker compose (app + nginx + admin-bot)
#    5. Suntik log forensik (inject_logs.py)
#
#  Jalankan sebagai root di VM Ubuntu:
#     sudo bash scripts/bootstrap.sh
#
#  Sifatnya idempotent semampunya (aman dijalankan ulang).
# =====================================================================
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_PORT=2275                       # FLAG: SSH custom port -> 2275
BLUE_USER="analyst"                 # FLAG: kredensial Blue Team
BLUE_PASS="blue_team_rocks"         #       analyst / blue_team_rocks
LOG_DIR="/opt/admin/logs"           # FLAG: SCENARIO75{/opt/admin/logs}

echo "[bootstrap] 1/5  Install Docker..."
if ! command -v docker >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl gnupg python3
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

echo "[bootstrap] 2/5  Siapkan direktori log $LOG_DIR ..."
mkdir -p "$LOG_DIR"
chmod 0755 "$LOG_DIR"

echo "[bootstrap] 3/5  Buat user SSH Blue Team & set port $SSH_PORT ..."
apt-get install -y openssh-server >/dev/null 2>&1 || true
if ! id "$BLUE_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$BLUE_USER"
fi
echo "${BLUE_USER}:${BLUE_PASS}" | chpasswd
# Beri Blue Team akses baca log
usermod -aG adm "$BLUE_USER" || true

# Set port SSH ke 2275 di sshd_config
if ! grep -qE "^Port ${SSH_PORT}\b" /etc/ssh/sshd_config; then
  echo "Port ${SSH_PORT}" >> /etc/ssh/sshd_config
fi

# PENTING (Ubuntu 22.10+): SSH pakai socket activation (ssh.socket), sehingga
# port ditentukan oleh socket -- BUKAN 'Port' di sshd_config. Override socketnya
# agar listen di 2275, jika ssh.socket memang dipakai.
if systemctl list-unit-files 2>/dev/null | grep -q '^ssh\.socket'; then
  mkdir -p /etc/systemd/system/ssh.socket.d
  # Bind IPv4 (0.0.0.0) eksplisit -- bind port saja kadang IPv6-only,
  # bikin klien IPv4 (mis. Windows) ditolak "Connection refused".
  printf '[Socket]\nListenStream=\nListenStream=0.0.0.0:%s\n' "$SSH_PORT" \
    > /etc/systemd/system/ssh.socket.d/override.conf
  systemctl daemon-reload
  systemctl restart ssh.socket || true
fi
systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true

echo "[bootstrap] 4/5  Build & jalankan containers..."
cd "$REPO_DIR"
docker compose up -d --build

echo "[bootstrap] 5/5  Suntik log forensik (simulated attack timeline)..."
LOG_DIR="$LOG_DIR" python3 "$REPO_DIR/scripts/inject_logs.py"

echo ""
echo "============================================================"
echo " LAB SIAP!"
echo "   Web app   : http://<IP-VM>:3075"
echo "   SSH Blue  : ssh ${BLUE_USER}@<IP-VM> -p ${SSH_PORT}   (pass: ${BLUE_PASS})"
echo "   Logs      : ${LOG_DIR}/access.log , ${LOG_DIR}/error.log"
echo "============================================================"

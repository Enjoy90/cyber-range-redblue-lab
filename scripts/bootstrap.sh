#!/usr/bin/env bash
#
# Provision the lab inside a fresh Ubuntu VM:
#   1. install Docker + Compose
#   2. prepare the log directory
#   3. create the Blue Team SSH user and move SSH to port 2275
#   4. build and start the containers
#   5. seed the forensic attack timeline
#
# Usage (as root):  sudo bash scripts/bootstrap.sh
#
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SSH_PORT=2275
BLUE_USER="analyst"
BLUE_PASS="blue_team_rocks"
LOG_DIR="/opt/admin/logs"

echo "[bootstrap] 1/5  Installing Docker..."
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

echo "[bootstrap] 2/5  Preparing log directory $LOG_DIR ..."
mkdir -p "$LOG_DIR"
chmod 0755 "$LOG_DIR"

echo "[bootstrap] 3/5  Creating Blue Team user and SSH on port $SSH_PORT ..."
apt-get install -y openssh-server >/dev/null 2>&1 || true
if ! id "$BLUE_USER" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "$BLUE_USER"
fi
echo "${BLUE_USER}:${BLUE_PASS}" | chpasswd
usermod -aG adm "$BLUE_USER" || true

if ! grep -qE "^Port ${SSH_PORT}\b" /etc/ssh/sshd_config; then
  echo "Port ${SSH_PORT}" >> /etc/ssh/sshd_config
fi

# On Ubuntu 22.10+ SSH uses socket activation; the port comes from ssh.socket,
# not sshd_config. Override the socket (bind IPv4 explicitly) when present.
if systemctl list-unit-files 2>/dev/null | grep -q '^ssh\.socket'; then
  mkdir -p /etc/systemd/system/ssh.socket.d
  printf '[Socket]\nListenStream=\nListenStream=0.0.0.0:%s\n' "$SSH_PORT" \
    > /etc/systemd/system/ssh.socket.d/override.conf
  systemctl daemon-reload
  systemctl restart ssh.socket || true
fi
systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || true

echo "[bootstrap] 4/5  Building and starting containers..."
cd "$REPO_DIR"
docker compose up -d --build

echo "[bootstrap] 5/5  Seeding forensic logs..."
LOG_DIR="$LOG_DIR" python3 "$REPO_DIR/scripts/inject_logs.py"

echo ""
echo "============================================================"
echo " Lab ready"
echo "   Web app  : http://<VM-IP>:3075"
echo "   SSH      : ssh ${BLUE_USER}@<VM-IP> -p ${SSH_PORT}   (pass: ${BLUE_PASS})"
echo "   Logs     : ${LOG_DIR}/access.log , ${LOG_DIR}/error.log"
echo "============================================================"

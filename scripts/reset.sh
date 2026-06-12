#!/usr/bin/env bash
#
# Reset the lab to a clean state (run before a demo): stop containers, clear
# logs, restart, and re-seed the forensic timeline.
#
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="/opt/admin/logs"

cd "$REPO_DIR"
docker compose down
rm -f "$LOG_DIR"/*.log || true
docker compose up -d --build
LOG_DIR="$LOG_DIR" python3 "$REPO_DIR/scripts/inject_logs.py"
echo "[reset] done."

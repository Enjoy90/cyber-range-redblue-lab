#!/usr/bin/env bash
# =====================================================================
#  reset.sh  -  Kembalikan lab ke kondisi bersih (buat sebelum demo)
# ---------------------------------------------------------------------
#  Hentikan container, kosongkan feedback (stored XSS), lalu suntik
#  ulang log forensik. Pakai ini SEBELUM presentasi live biar state rapi.
# =====================================================================
set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="/opt/admin/logs"

echo "[reset] turunkan containers..."
cd "$REPO_DIR"
docker compose down

echo "[reset] bersihkan log lama..."
rm -f "$LOG_DIR"/*.log || true

echo "[reset] nyalakan ulang..."
docker compose up -d --build

echo "[reset] suntik ulang log forensik..."
LOG_DIR="$LOG_DIR" python3 "$REPO_DIR/scripts/inject_logs.py"

echo "[reset] selesai. Lab bersih & siap demo."

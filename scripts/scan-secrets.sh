#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/Users/teopalatini/Documents/political-agent"
EXIT_CODE=0

echo "== Secret scan (quick) =="

check_file() {
  local file="$1"
  local label="$2"
  if [[ -f "${file}" ]]; then
    if /usr/bin/grep -En "(TELEGRAM_BOT_TOKEN=[A-Za-z0-9:_-]{20,}|EMAIL_PASS=[^[][^[:space:]]+|TWELVE_DATA_KEY=[A-Za-z0-9]{16,}|GOOGLE_DRIVE_FOLDER_ID=[A-Za-z0-9_-]{10,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16}|xoxb-[0-9A-Za-z-]{20,})" "${file}" >/dev/null; then
      echo "⚠️  Posible secreto detectado en ${label}: ${file}"
      EXIT_CODE=1
    else
      echo "✅ Sin patrones sensibles en ${label}: ${file}"
    fi
  fi
}

check_file "${PROJECT_DIR}/Texto de Terminal.txt" "terminal exportado"
check_file "${PROJECT_DIR}/logs/daemon.out.log" "daemon.out.log"
check_file "${PROJECT_DIR}/logs/daemon.err.log" "daemon.err.log"
check_file "${PROJECT_DIR}/logs/healthcheck.log" "healthcheck.log"
check_file "${PROJECT_DIR}/logs/healthcheck.err.log" "healthcheck.err.log"
check_file "${PROJECT_DIR}/logs/healthcheck.out.log" "healthcheck.out.log"

if [[ "${EXIT_CODE}" -eq 0 ]]; then
  echo "🎯 Secret scan completado sin hallazgos."
else
  echo "❌ Secret scan detectó posibles secretos. Revisar archivos indicados."
fi

exit "${EXIT_CODE}"

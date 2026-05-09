#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/Users/teopalatini/Documents/political-agent"

echo "== Weekly healthcheck: political-agent =="
date

echo
echo "-- Smoke operativo --"
bash "${PROJECT_DIR}/scripts/smoke-check.sh"

echo
echo "-- Secret scan --"
bash "${PROJECT_DIR}/scripts/scan-secrets.sh" || true

echo
echo "-- Estado launchd --"
if sudo -n true >/dev/null 2>&1; then
  sudo launchctl print system/com.teopalatini.political-agent | sed -n '1,25p'
  echo
  sudo launchctl print system/com.teopalatini.political-agent.healthcheck | sed -n '1,25p'
else
  launchctl print system/com.teopalatini.political-agent | sed -n '1,25p'
  echo
  launchctl print system/com.teopalatini.political-agent.healthcheck | sed -n '1,25p'
fi

echo
echo "OK: weekly healthcheck finalizado"

#!/usr/bin/env bash
set -euo pipefail

LABEL="com.teopalatini.political-agent"
HEALTH_LABEL="com.teopalatini.political-agent.healthcheck"
PROJECT_DIR="/Users/teopalatini/Documents/political-agent"
PLIST_SOURCE="${PROJECT_DIR}/scripts/com.teopalatini.political-agent.daemon.plist"
HEALTH_PLIST_SOURCE="${PROJECT_DIR}/scripts/com.teopalatini.political-agent.healthcheck.plist"
PLIST_TARGET="/Library/LaunchDaemons/${LABEL}.plist"
HEALTH_PLIST_TARGET="/Library/LaunchDaemons/${HEALTH_LABEL}.plist"
LAUNCH_AGENT_PLIST="/Users/teopalatini/Library/LaunchAgents/${LABEL}.plist"
HEALTHCHECK_SCRIPT="${PROJECT_DIR}/scripts/healthcheck-daemon.sh"
HEALTHCHECK_TARGET="/usr/local/bin/political-agent-healthcheck.sh"
SMOKE_SCRIPT="${PROJECT_DIR}/scripts/smoke-check.sh"

echo "==> Preparando entorno"
mkdir -p "${PROJECT_DIR}/logs"

if [[ ! -f "${PLIST_SOURCE}" ]]; then
  echo "ERROR: no existe ${PLIST_SOURCE}"
  exit 1
fi

if [[ ! -f "${HEALTH_PLIST_SOURCE}" ]]; then
  echo "ERROR: no existe ${HEALTH_PLIST_SOURCE}"
  exit 1
fi

if [[ ! -f "${HEALTHCHECK_SCRIPT}" ]]; then
  echo "ERROR: no existe ${HEALTHCHECK_SCRIPT}"
  exit 1
fi

if [[ ! -f "${SMOKE_SCRIPT}" ]]; then
  echo "ERROR: no existe ${SMOKE_SCRIPT}"
  exit 1
fi

if [[ ! -x "/Users/teopalatini/.nvm/versions/node/v22.19.0/bin/node" ]]; then
  echo "ERROR: no se encontro Node en /Users/teopalatini/.nvm/versions/node/v22.19.0/bin/node"
  exit 1
fi

chmod +x "${HEALTHCHECK_SCRIPT}"
chmod +x "${SMOKE_SCRIPT}"

echo "==> Apagando servicios previos (PM2 + LaunchAgent)"
pm2 stop political-agent >/dev/null 2>&1 || true
launchctl bootout "gui/$(id -u)/${LABEL}" >/dev/null 2>&1 || true
launchctl unload "${LAUNCH_AGENT_PLIST}" >/dev/null 2>&1 || true

echo "==> Instalando LaunchDaemon (requiere sudo)"
sudo mkdir -p "/usr/local/bin"
sudo cp "${HEALTHCHECK_SCRIPT}" "${HEALTHCHECK_TARGET}"
sudo chown root:wheel "${HEALTHCHECK_TARGET}"
sudo chmod 755 "${HEALTHCHECK_TARGET}"
sudo cp "${PLIST_SOURCE}" "${PLIST_TARGET}"
sudo chown root:wheel "${PLIST_TARGET}"
sudo chmod 644 "${PLIST_TARGET}"
sudo cp "${HEALTH_PLIST_SOURCE}" "${HEALTH_PLIST_TARGET}"
sudo chown root:wheel "${HEALTH_PLIST_TARGET}"
sudo chmod 644 "${HEALTH_PLIST_TARGET}"

echo "==> Recargando daemons"
sudo launchctl bootout "system/${LABEL}" >/dev/null 2>&1 || true
sudo launchctl bootout "system/${HEALTH_LABEL}" >/dev/null 2>&1 || true

echo "-- bootstrap principal"
if ! sudo launchctl bootstrap system "${PLIST_TARGET}"; then
  echo "ERROR: fallo bootstrap de ${LABEL}"
  exit 1
fi

echo "-- bootstrap healthcheck"
if ! sudo launchctl bootstrap system "${HEALTH_PLIST_TARGET}"; then
  echo "ERROR: fallo bootstrap de ${HEALTH_LABEL}"
  echo "Tip: revisa permisos/rutas en ${HEALTH_PLIST_TARGET}"
  exit 1
fi

sudo launchctl enable "system/${LABEL}"
sudo launchctl enable "system/${HEALTH_LABEL}"
sudo launchctl kickstart -k "system/${LABEL}"
sudo launchctl kickstart -k "system/${HEALTH_LABEL}"

echo "==> Validaciones"
echo "-- launchctl principal:"
sudo launchctl print "system/${LABEL}" | sed -n '1,25p'
echo
echo "-- launchctl healthcheck:"
sudo launchctl print "system/${HEALTH_LABEL}" | sed -n '1,25p'
echo
echo "-- proceso node:"
pgrep -fl "server.js" || true
echo
echo "-- PM2 (debe estar detenido):"
pm2 ls

echo
echo "OK: LaunchDaemons instalados."
echo "Logs bot: ${PROJECT_DIR}/logs/daemon.out.log y daemon.err.log"
echo "Logs watchdog: ${PROJECT_DIR}/logs/healthcheck.log, healthcheck.out.log y healthcheck.err.log"
echo
echo "Ejecuta smoke check:"
echo "  bash \"${SMOKE_SCRIPT}\""

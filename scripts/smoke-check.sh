#!/usr/bin/env bash
set -euo pipefail

LABEL="com.teopalatini.political-agent"
HEALTH_LABEL="com.teopalatini.political-agent.healthcheck"
PROJECT_DIR="/Users/teopalatini/Documents/political-agent"
HEARTBEAT_PATH="${PROJECT_DIR}/logs/heartbeat.json"
MAX_STALE_SEC="${MAX_STALE_SEC:-360}"

fail() {
  echo "❌ $1"
  exit 1
}

ok() {
  echo "✅ $1"
}

check_service_running() {
  local service="$1"
  if sudo -n true >/dev/null 2>&1; then
    sudo launchctl print "system/${service}" >/tmp/political-agent-smoke.txt 2>/dev/null || fail "No existe o no responde launchd para ${service}"
  else
    launchctl print "system/${service}" >/tmp/political-agent-smoke.txt 2>/dev/null || fail "No existe o no responde launchd para ${service}"
  fi
  if [[ ! -s /tmp/political-agent-smoke.txt ]]; then
    fail "No existe o no responde launchd para ${service}"
  fi
  if ! /usr/bin/grep -q "state = running" /tmp/political-agent-smoke.txt; then
    fail "Servicio ${service} no está running"
  fi
  ok "Servicio ${service} en running"
}

check_health_job() {
  if sudo -n true >/dev/null 2>&1; then
    sudo launchctl print "system/${HEALTH_LABEL}" >/tmp/political-agent-health-smoke.txt 2>/dev/null || fail "No existe o no responde launchd para ${HEALTH_LABEL}"
  else
    launchctl print "system/${HEALTH_LABEL}" >/tmp/political-agent-health-smoke.txt 2>/dev/null || fail "No existe o no responde launchd para ${HEALTH_LABEL}"
  fi
  if [[ ! -s /tmp/political-agent-health-smoke.txt ]]; then
    fail "No existe o no responde launchd para ${HEALTH_LABEL}"
  fi
  if /usr/bin/grep -q "last exit code = 126" /tmp/political-agent-health-smoke.txt; then
    fail "Healthcheck terminó con exit 126 (permiso/ejecución)"
  fi
  if /usr/bin/grep -q "last exit code = 1" /tmp/political-agent-health-smoke.txt; then
    fail "Healthcheck terminó con exit 1 (revisar /tmp/political-agent-healthcheck.log)"
  fi
  ok "Healthcheck job cargado y sin último error crítico"
}

check_heartbeat() {
  [[ -f "${HEARTBEAT_PATH}" ]] || fail "Falta heartbeat: ${HEARTBEAT_PATH}"
  local now_epoch mtime age
  now_epoch="$(date +%s)"
  mtime="$(stat -f %m "${HEARTBEAT_PATH}" 2>/dev/null || echo 0)"
  age="$((now_epoch - mtime))"
  [[ "${age}" -le "${MAX_STALE_SEC}" ]] || fail "Heartbeat stale (${age}s > ${MAX_STALE_SEC}s)"
  ok "Heartbeat reciente (${age}s)"
}

check_logs_writable() {
  for log_file in \
    "${PROJECT_DIR}/logs/daemon.out.log" \
    "${PROJECT_DIR}/logs/daemon.err.log" \
    "${PROJECT_DIR}/logs/healthcheck.log"; do
    [[ -f "${log_file}" ]] || touch "${log_file}"
    [[ -w "${log_file}" ]] || fail "Sin permiso de escritura en ${log_file}"
  done
  ok "Logs escribibles"
}

main() {
  echo "== Smoke check: political-agent =="
  check_service_running "${LABEL}"
  check_health_job
  check_heartbeat
  check_logs_writable
  echo "🎯 Smoke check completado"
}

main "$@"

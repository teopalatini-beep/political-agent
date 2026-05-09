#!/usr/bin/env bash
set -euo pipefail

LABEL="com.teopalatini.political-agent"
PROJECT_DIR="/Users/teopalatini/Documents/political-agent"
HEARTBEAT_PATH="${HEARTBEAT_PATH:-/tmp/political-agent-heartbeat.json}"
CHECK_LOG="${CHECK_LOG_PATH:-${PROJECT_DIR}/logs/healthcheck.log}"
MAX_STALE_SEC="${MAX_STALE_SEC:-600}"

log() {
  if ! touch "${CHECK_LOG}" >/dev/null 2>&1; then
    CHECK_LOG="/tmp/political-agent-healthcheck.log"
    touch "${CHECK_LOG}" >/dev/null 2>&1 || true
  fi
  printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$1" >> "${CHECK_LOG}"
}

restart_agent() {
  launchctl kickstart -k "system/${LABEL}" >/dev/null 2>&1 || true
}

is_running() {
  launchctl print "system/${LABEL}" 2>/dev/null | /usr/bin/grep -q "state = running"
}

heartbeat_is_stale() {
  if [[ ! -f "${HEARTBEAT_PATH}" ]]; then
    return 0
  fi

  local now_epoch mtime age
  now_epoch="$(date +%s)"
  mtime="$(stat -f %m "${HEARTBEAT_PATH}" 2>/dev/null || echo 0)"
  age="$((now_epoch - mtime))"
  [[ "${age}" -gt "${MAX_STALE_SEC}" ]]
}

if ! is_running; then
  log "[watchdog] servicio no corriendo -> reinicio"
  restart_agent
  exit 0
fi

if heartbeat_is_stale; then
  log "[watchdog] heartbeat ausente o stale -> reinicio"
  restart_agent
  exit 0
fi

log "[watchdog] ok"

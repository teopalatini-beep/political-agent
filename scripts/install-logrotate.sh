#!/usr/bin/env bash
set -euo pipefail

CONF_SOURCE="/Users/teopalatini/Documents/political-agent/scripts/com.teopalatini.political-agent.newsyslog.conf"
CONF_TARGET="/etc/newsyslog.d/com.teopalatini.political-agent.conf"

if [[ ! -f "${CONF_SOURCE}" ]]; then
  echo "ERROR: falta ${CONF_SOURCE}"
  exit 1
fi

echo "==> Instalando configuración de rotación (newsyslog)"
sudo cp "${CONF_SOURCE}" "${CONF_TARGET}"
sudo chown root:wheel "${CONF_TARGET}"
sudo chmod 644 "${CONF_TARGET}"

echo "==> Validando sintaxis"
sudo newsyslog -nv

echo "OK: rotación instalada en ${CONF_TARGET}"

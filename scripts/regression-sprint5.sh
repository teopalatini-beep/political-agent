#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="/Users/teopalatini/Documents/political-agent"
cd "${PROJECT_DIR}"

echo "== Sprint 5 regression suite =="

echo "-- Syntax checks --"
node --check server.js
node --check bot_main.js

echo "-- Script lint checks --"
bash -n scripts/smoke-check.sh
bash -n scripts/weekly-healthcheck.sh
bash -n scripts/scan-secrets.sh
bash -n scripts/healthcheck-daemon.sh

echo "-- Critical command presence --"
for cmd in start help status check newsletter preview preview_dedup quality test_email; do
  /usr/bin/grep -q "bot.command(\"${cmd}\"" bot_main.js || {
    echo "❌ Falta comando crítico: ${cmd}"
    exit 1
  }
done
echo "✅ Comandos críticos presentes"

echo "-- Newsletter quality blocks --"
/usr/bin/grep -q "const statsBar = " bot_main.js || { echo "❌ Falta barra de métricas del newsletter"; exit 1; }
/usr/bin/grep -q "computeNewsletterMetrics" bot_main.js || { echo "❌ Falta métrica editorial"; exit 1; }
echo "✅ Bloques de calidad presentes"

echo "-- Runtime smoke --"
bash scripts/smoke-check.sh

echo "-- Secrets scan --"
bash scripts/scan-secrets.sh

echo "🎯 Sprint 5 regression suite OK"

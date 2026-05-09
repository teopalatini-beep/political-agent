# Operacion 24x7 del Political Agent

## Instalacion inicial (LaunchDaemons)
1. `cd "/Users/teopalatini/Documents/political-agent"`
2. `bash "scripts/install-launchdaemon.sh"`
3. Confirmar estado:
   - `sudo launchctl print system/com.teopalatini.political-agent | sed -n '1,35p'`
   - `sudo launchctl print system/com.teopalatini.political-agent.healthcheck | sed -n '1,35p'`

## Verificacion diaria (2 minutos)
1. `bash "scripts/weekly-healthcheck.sh"`
2. Verificar heartbeat:
   - `ls -la logs/heartbeat.json`
3. Revisar errores recientes:
   - `rg -n "FATAL|Error|SMTP rechazado|bootstrap failed" logs/*.log`
4. Regresión funcional rápida (Sprint 5):
   - `npm run regression:sprint5`

## Recuperacion rapida
1. Reiniciar servicios:
   - `sudo launchctl kickstart -k system/com.teopalatini.political-agent`
   - `sudo launchctl kickstart -k system/com.teopalatini.political-agent.healthcheck`
2. Re-ejecutar smoke:
   - `bash "scripts/smoke-check.sh"`
3. Si sigue fallando:
   - `bash "scripts/install-launchdaemon.sh"`

## Fallas comunes
- `exit code 126` en healthcheck:
  - Revisar que exista `/usr/local/bin/political-agent-healthcheck.sh`
  - Reinstalar con `scripts/install-launchdaemon.sh`
- `heartbeat.json` ausente:
  - El proceso principal no esta escribiendo heartbeat
  - Revisar `logs/daemon.err.log` y reiniciar daemon principal
- `healthcheck` con `exit 1`:
  - Revisar `/tmp/political-agent-healthcheck.log`
  - Confirmar que exista `/tmp/political-agent-heartbeat.json`
- Newsletter no sale:
  - Ejecutar `/test_email` en Telegram
  - Revisar variables `EMAIL_FROM`, `EMAIL_PASS`, `EMAIL_TO`

## Criterio de operacion estable
- Ambos launchd en `state = running`
- Heartbeat actualizado en menos de 6 minutos
- `scripts/smoke-check.sh` en verde

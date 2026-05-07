// server.js — launcher
// Si DISABLE_BOT=true el proceso duerme (para launchd del Mac)
// En Fly.io no está seteado, entonces corre el bot real
require('dotenv').config();

if (process.env.DISABLE_BOT === 'true') {
  console.log('[Mac Standby] Bot activo en Fly.io. Esta instancia en modo reposo.');
  setInterval(() => {}, 3_600_000); // mantiene el proceso vivo para launchd
} else {
  require('./bot_main.js');
}

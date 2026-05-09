// server.js — launcher
// Si DISABLE_BOT=true el proceso entra en modo reposo pero mantiene heartbeat local.
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const HEARTBEAT_PATH = path.join(__dirname, "logs", "heartbeat.json");
const HEARTBEAT_COMPAT_PATH = process.env.HEARTBEAT_COMPAT_PATH || "/tmp/political-agent-heartbeat.json";
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || "60000");

function writeHeartbeat(status = "ok", mode = "active") {
  const payload = {
    status,
    mode,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
  };
  const targets = [HEARTBEAT_PATH, HEARTBEAT_COMPAT_PATH];
  for (const target of targets) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
    } catch (e) {
      console.error(`[Heartbeat] Error escribiendo ${target}:`, e.message);
    }
  }
}

if (process.env.DISABLE_BOT === "true") {
  console.log("[Mac Standby] Bot activo en Fly.io. Esta instancia en modo reposo.");
  writeHeartbeat("startup", "standby");
  const interval = Number.isFinite(HEARTBEAT_INTERVAL_MS)
    ? Math.max(15_000, HEARTBEAT_INTERVAL_MS)
    : 60_000;
  setInterval(() => writeHeartbeat("ok", "standby"), interval);
} else {
  require("./bot_main.js");
}

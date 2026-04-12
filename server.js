const { Telegraf } = require("telegraf");
require("dotenv").config();

// ─── VALIDACIÓN DE ENTORNO ────────────────────────────────────────────────────
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
if (!TELEGRAM_BOT_TOKEN) {
  console.error("FATAL: TELEGRAM_BOT_TOKEN no definido en .env");
  process.exit(1);
}

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const CONFIG = {
  FETCH_TIMEOUT_MS:    8_000,
  CACHE_TTL_MS:        5 * 60 * 1_000,
  MONITOR_INTERVAL_MS: 30 * 60 * 1_000,
  MAX_ITEMS_PER_SOURCE: 10,
  MAX_NEWS_PER_REGION:  10,
  MAX_GLOBAL_NEWS:      15,
  TELEGRAM_MAX_CHARS:   4_000,
  RATE_LIMIT_MS:        3_000,
};

// ─── FUENTES RSS ──────────────────────────────────────────────────────────────
const RSS_SOURCES = {
  usa:      [
    { name: "Reuters",     url: "https://feeds.reuters.com/Reuters/worldNews" },
    { name: "NPR Politics", url: "https://feeds.npr.org/1014/rss.xml" },
  ],
  europe:   [
    { name: "Euronews", url: "https://www.euronews.com/rss?level=theme&name=news" },
    { name: "DW News",  url: "https://rss.dw.com/rdf/rss-en-world" },
  ],
  china:    [
    { name: "SCMP",         url: "https://www.scmp.com/rss/91/feed" },
    { name: "Reuters Asia", url: "https://feeds.reuters.com/reuters/asiaPacificNews" },
  ],
  russia:   [{ name: "Moscow Times", url: "https://www.themoscowtimes.com/rss/news" }],
  mideast:  [{ name: "Al Jazeera",   url: "https://www.aljazeera.com/xml/rss/all.xml" }],
  brazil:   [{ name: "Folha",        url: "https://feeds.folha.uol.com.br/mundo/rss091.xml" }],
  argentina:[
    { name: "Infobae",   url: "https://www.infobae.com/feeds/rss/" },
    { name: "La Nación", url: "https://www.lanacion.com.ar/arcio/rss/" },
  ],
};

const KEYWORDS = {
  alta:  ["guerra","war","invasión","golpe","coup","asesinato","crisis",
          "sanción","sanction","nuclear","misil","ataque","attack","impeachment"],
  media: ["presidente","president","ministro","minister","congreso","ley",
          "protesta","protest","cumbre","summit","acuerdo","tratado"],
};

const EMOJIS = {
  usa:"🇺🇸", europe:"🇪🇺", china:"🇨🇳", russia:"🇷🇺",
  mideast:"🌍", brazil:"🇧🇷", argentina:"🇦🇷",
};

const REGION_NAMES = {
  usa:"Estados Unidos", europe:"Europa", china:"China", russia:"Rusia",
  mideast:"Medio Oriente", brazil:"Brasil", argentina:"Argentina",
};

// ─── CACHÉ ────────────────────────────────────────────────────────────────────
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CONFIG.CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.data;
}
function setCache(key, data) { cache.set(key, { ts: Date.now(), data }); }

// ─── RATE LIMITER ─────────────────────────────────────────────────────────────
const lastCommand = new Map();

function isRateLimited(userId) {
  const last = lastCommand.get(userId) || 0;
  if (Date.now() - last < CONFIG.RATE_LIMIT_MS) return true;
  lastCommand.set(userId, Date.now());
  return false;
}

// ─── AUTORIZACIÓN ─────────────────────────────────────────────────────────────
function isAuthorized(ctx) {
  if (!TELEGRAM_CHAT_ID) return true;
  return String(ctx.chat?.id) === String(TELEGRAM_CHAT_ID);
}

// ─── UTILS RSS ────────────────────────────────────────────────────────────────
function cleanText(text) {
  return text
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'").replace(/&#\d+;/g, "")
    .trim();
}

function escapeMd(text) {
  return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&");
}

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch { return false; }
}

async function fetchRSS(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const text = await res.text();
    const matches = text.match(/<item>([\s\S]*?)<\/item>/gi) || [];
    const items = [];

    for (const item of matches.slice(0, CONFIG.MAX_ITEMS_PER_SOURCE)) {
      const title = cleanText(item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/i)?.[1] || "");
      const link  = cleanText(item.match(/<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/i)?.[1] || "");
      const desc  = cleanText(item.match(/<description>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/description>/i)?.[1] || "");

      if (!title || !isValidUrl(link)) continue;
      items.push({ title, link, description: desc.substring(0, 200) });
    }
    return items;
  } catch (e) {
    console.error(`[RSS] ${url}: ${e.message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function getImportance(title, desc) {
  const text = `${title} ${desc}`.toLowerCase();
  if (KEYWORDS.alta.some(k => text.includes(k)))  return { level: "alta",  emoji: "🔴" };
  if (KEYWORDS.media.some(k => text.includes(k))) return { level: "media", emoji: "🟡" };
  return { level: "baja", emoji: "🟢" };
}

// ─── FETCH EN PARALELO + CACHÉ ────────────────────────────────────────────────
async function getRegionNews(regionId) {
  const cached = getCached(regionId);
  if (cached) return cached;

  const sources = RSS_SOURCES[regionId] || [];
  const results = await Promise.allSettled(
    sources.map(s =>
      fetchRSS(s.url).then(items =>
        items.map(item => ({
          ...item, source: s.name, region: regionId,
          importance: getImportance(item.title, item.description),
        }))
      )
    )
  );

  const seen = new Set();
  const news = results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => r.value)
    .filter(n => { if (seen.has(n.link)) return false; seen.add(n.link); return true; })
    .sort((a, b) => ({ alta: 3, media: 2, baja: 1 }[b.importance.level] - { alta: 3, media: 2, baja: 1 }[a.importance.level]))
    .slice(0, CONFIG.MAX_NEWS_PER_REGION);

  setCache(regionId, news);
  return news;
}

async function checkAllRegions() {
  const results = await Promise.allSettled(Object.keys(RSS_SOURCES).map(getRegionNews));
  return results
    .filter(r => r.status === "fulfilled")
    .flatMap(r => r.value)
    .filter(n => n.importance.level !== "baja")
    .slice(0, CONFIG.MAX_GLOBAL_NEWS);
}

// ─── TELEGRAM HELPERS ─────────────────────────────────────────────────────────
function splitMessage(text) {
  if (text.length <= CONFIG.TELEGRAM_MAX_CHARS) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > 0) {
    let chunk = remaining.substring(0, CONFIG.TELEGRAM_MAX_CHARS);
    const cut = chunk.lastIndexOf("\n");
    if (cut > CONFIG.TELEGRAM_MAX_CHARS * 0.7) chunk = chunk.substring(0, cut);
    chunks.push(chunk);
    remaining = remaining.substring(chunk.length).trimStart();
  }
  return chunks;
}

const SEND_OPTS = { parse_mode: "Markdown", disable_web_page_preview: true };

async function sendToCtx(ctx, text) {
  for (const chunk of splitMessage(text)) await ctx.reply(chunk, SEND_OPTS);
}

async function sendToChat(chatId, text) {
  for (const chunk of splitMessage(text)) await bot.telegram.sendMessage(chatId, chunk, SEND_OPTS);
}

// ─── BOT ──────────────────────────────────────────────────────────────────────
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

bot.use(async (ctx, next) => {
  if (!isAuthorized(ctx)) return;
  if (ctx.from && isRateLimited(ctx.from.id))
    return ctx.reply("⏳ Espera un momento antes del siguiente comando.");
  return next();
});

bot.command("start", ctx =>
  ctx.reply(
    `🌐 *Agente Político Gratuito*\n\n` +
    `Comandos:\n/check — Noticias importantes\n` +
    `/usa /europe /china /russia\n/mideast /brazil /argentina\n/all — Resumen global`,
    SEND_OPTS
  )
);

for (const [id, name] of Object.entries(REGION_NAMES)) {
  bot.command(id, async ctx => {
    await ctx.reply(`🔍 Buscando noticias de ${name}...`);
    const news = await getRegionNews(id);
    if (!news.length) return ctx.reply(`Sin noticias disponibles de ${name}.`);

    let msg = `${EMOJIS[id]} *${name}*\n\n`;
    for (const n of news.slice(0, 8))
      msg += `${n.importance.emoji} *${escapeMd(n.title)}*\n📰 ${escapeMd(n.source)} | [Link](${n.link})\n\n`;
    await sendToCtx(ctx, msg);
  });
}

bot.command("check", async ctx => {
  await ctx.reply("🔍 Buscando noticias importantes...");
  const news = await checkAllRegions();
  if (!news.length) return ctx.reply("✅ Sin noticias importantes ahora.");

  let msg = "🚨 *NOTICIAS IMPORTANTES*\n\n";
  for (const n of news)
    msg += `${EMOJIS[n.region]} ${n.importance.emoji} *${escapeMd(n.title)}*\n📰 ${escapeMd(n.source)} | [Link](${n.link})\n\n`;
  await sendToCtx(ctx, msg);
});

bot.command("all", async ctx => {
  await ctx.reply("🌍 Generando resumen global...");
  const entries = Object.entries(REGION_NAMES);
  const results = await Promise.allSettled(entries.map(([id]) => getRegionNews(id)));

  for (let i = 0; i < entries.length; i++) {
    const [id, name] = entries[i];
    const r = results[i];
    if (r.status !== "fulfilled" || !r.value.length) continue;

    let msg = `${EMOJIS[id]} *${name}*\n\n`;
    for (const n of r.value.slice(0, 3))
      msg += `${n.importance.emoji} ${escapeMd(n.title)}\n[Link](${n.link})\n\n`;
    await sendToCtx(ctx, msg);
    await new Promise(r => setTimeout(r, 300));
  }
});

// ─── MONITOREO AUTOMÁTICO ─────────────────────────────────────────────────────
function startMonitoring(chatId) {
  console.log("[Monitor] Iniciado — intervalo 30 min");
  setInterval(async () => {
    try {
      const critical = (await checkAllRegions()).filter(n => n.importance.level === "alta");
      if (!critical.length) return;
      let msg = "🚨 *ALERTA POLÍTICA*\n\n";
      for (const n of critical)
        msg += `${EMOJIS[n.region]} *${escapeMd(n.title)}*\n[Link](${n.link})\n\n`;
      await sendToChat(chatId, msg);
    } catch (e) {
      console.error("[Monitor] Error:", e.message);
    }
  }, CONFIG.MONITOR_INTERVAL_MS);
}

// ─── INICIO ───────────────────────────────────────────────────────────────────
bot.launch().then(async () => {
  console.log("🤖 Bot iniciado correctamente");
  if (TELEGRAM_CHAT_ID) {
    startMonitoring(TELEGRAM_CHAT_ID);
    await sendToChat(TELEGRAM_CHAT_ID,
      "🟢 *Agente iniciado*\nMonitoreando noticias cada 30 min\\.\nUsa /check ahora\\."
    );
  }
}).catch(e => {
  console.error("FATAL:", e.message);
  process.exit(1);
});

process.once("SIGINT",  () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

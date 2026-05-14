const { Telegraf } = require("telegraf");
const nodemailer = require("nodemailer");
const cron = require("node-cron");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

// ─── VALIDACIÓN DE ENTORNO ────────────────────────────────────────────────────
const { TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID } = process.env;
if (!TELEGRAM_BOT_TOKEN) {
  console.error("FATAL: TELEGRAM_BOT_TOKEN no definido en .env");
  process.exit(1);
}

function parseBooleanEnv(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  return ["1", "true", "yes", "y", "on"].includes(String(value).trim().toLowerCase());
}

// ─── CONFIGURACIÓN ────────────────────────────────────────────────────────────
const CONFIG = {
  FETCH_TIMEOUT_MS:     8_000,
  CACHE_TTL_MS:         5 * 60 * 1_000,
  MONITOR_INTERVAL_MS:  30 * 60 * 1_000,
  HEARTBEAT_INTERVAL_MS: Number(process.env.HEARTBEAT_INTERVAL_MS || "60000"),
  MAX_ITEMS_PER_SOURCE: 10,
  MAX_NEWS_PER_REGION:  10,
  MAX_GLOBAL_NEWS:      15,
  TELEGRAM_MAX_CHARS:   4_000,
  RATE_LIMIT_MS:        3_000,
  NEWSLETTER_HOUR:      process.env.NEWSLETTER_HOUR || "8",
  NEWSLETTER_MINUTE:    process.env.NEWSLETTER_MINUTE || "0",
  DEDUP_WINDOW_HOURS:   Number(process.env.DEDUP_WINDOW_HOURS || "48"),
  DEDUP_NEWSLETTER_ONLY: parseBooleanEnv(process.env.DEDUP_NEWSLETTER_ONLY, true),
  MAX_ITEMS_PER_SOURCE_REGION: Number(process.env.MAX_ITEMS_PER_SOURCE_REGION || "3"),
  ALERTS_LIMIT: Number(process.env.ALERTS_LIMIT || "6"),
  SEEN_LINKS_PATH:      path.join(__dirname, "seen_links.json"),
  HEARTBEAT_PATH:       path.join(__dirname, "logs", "heartbeat.json"),
  HEARTBEAT_COMPAT_PATH: process.env.HEARTBEAT_COMPAT_PATH || "/tmp/political-agent-heartbeat.json",
  NEWSLETTER_PREVIEW_PATH: path.join(__dirname, "latest_newsletter_preview.html"),
  NOTA_EDITORIAL_PATH:  path.join(__dirname, "nota_editorial.txt"),
  RECIPIENTS_PATH:      path.join(__dirname, "recipients.txt"),
  TIMEZONE:             process.env.TZ || "America/Argentina/Buenos_Aires",
};

// ─── FUENTES RSS ──────────────────────────────────────────────────────────────
const RSS_SOURCES = {
  usa:      [
    { name: "BBC World",    url: "https://feeds.bbci.co.uk/news/world/rss.xml" },
    { name: "NPR Politics", url: "https://feeds.npr.org/1014/rss.xml" },
  ],
  europe:   [
    { name: "Euronews", url: "https://www.euronews.com/rss?level=theme&name=news" },
    { name: "DW News",  url: "https://rss.dw.com/rdf/rss-en-world" },
  ],
  china:    [
    { name: "SCMP",      url: "https://www.scmp.com/rss/91/feed" },
    { name: "NYT Asia",  url: "https://rss.nytimes.com/services/xml/rss/nyt/AsiaPacific.xml" },
  ],
  russia:   [{ name: "Moscow Times", url: "https://www.themoscowtimes.com/rss/news" }],
  mideast:  [{ name: "Al Jazeera",   url: "https://www.aljazeera.com/xml/rss/all.xml" }],
  brazil:   [{ name: "Folha",        url: "https://feeds.folha.uol.com.br/mundo/rss091.xml" }],
  argentina:[
    { name: "La Nación", url: "https://www.lanacion.com.ar/arcio/rss/" },
    { name: "Clarín",    url: "https://www.clarin.com/rss/lo-ultimo/" },
  ],
};

// Fuentes de respaldo por región (solo se usan si las primarias no devuelven resultados)
const REGION_FALLBACK_SOURCES = {
  usa: [{ name: "Google News US Politics", url: "https://news.google.com/rss/search?q=US+politics&hl=en-US&gl=US&ceid=US:en" }],
  europe: [{ name: "Google News Europe", url: "https://news.google.com/rss/search?q=Europe+politics&hl=en-US&gl=US&ceid=US:en" }],
  china: [{ name: "Google News China", url: "https://news.google.com/rss/search?q=China+politics&hl=en-US&gl=US&ceid=US:en" }],
  russia: [{ name: "Google News Russia", url: "https://news.google.com/rss/search?q=Russia+politics&hl=en-US&gl=US&ceid=US:en" }],
  mideast: [{ name: "Google News Middle East", url: "https://news.google.com/rss/search?q=Middle+East+politics&hl=en-US&gl=US&ceid=US:en" }],
  brazil: [{ name: "Google News Brazil", url: "https://news.google.com/rss/search?q=Brazil+politics&hl=pt-BR&gl=BR&ceid=BR:pt-419" }],
  argentina: [{ name: "Google News Argentina", url: "https://news.google.com/rss/search?q=Argentina+politica&hl=es-419&gl=AR&ceid=AR:es-419" }],
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

// ─── CATEGORÍAS TEMÁTICAS ─────────────────────────────────────────────────────
// Paleta unificada: todos los cards usan el mismo estilo —
// el emoji es el único diferenciador visual (Morning Brew approach).
const CAT_STYLE = { color: "#0f172a", bg: "#f8fafc", border: "#e2e8f0", accent: "#1e3a5f" };

const CATEGORIES = {
  politica_mundial: {
    name: "Política Mundial",
    emoji: "🌐",
    ...CAT_STYLE,
    keywords: [
      "diplomacia","diplomacy","diplomatic","tratado","treaty","cumbre","summit",
      "onu","united nations","nato","otan","guerra","war","warfare","conflicto",
      "conflict","sanción","sanction","alianza","alliance","acuerdo","agreement",
      "presidente","president","premier","chancellor","canciller","minister",
      "elección","election","voto","vote","parlamento","parliament","senado",
      "senate","gobierno","government","congress","política exterior","foreign policy",
      "geopolítica","geopolitics","invasión","invasion","tropas","troops","milicia",
      "militia","cese al fuego","ceasefire","paz","peace","crisis diplomática",
    ],
  },
  argentina: {
    name: "Política Argentina",
    emoji: "🇦🇷",
    ...CAT_STYLE,
    keywords: [
      "argentina","milei","kirchner","peronismo","peronist","buenos aires",
      "casa rosada","diputados","senadores","ypf","vaca muerta","patagonia",
      "córdoba","rosario","mendoza","tucumán","la nación","clarín","infobae",
      "dólar blue","cepo cambiario","fmi argentina","imf argentina","indec",
      "anses","conicet","aerolíneas","pagina 12","ambito financiero",
      "javier milei","sergio massa","cristina","macri","larreta","kicillof",
    ],
  },
  economia: {
    name: "Economía",
    emoji: "💼",
    ...CAT_STYLE,
    keywords: [
      "economía","economy","economic","pbi","gdp","inflación","inflation",
      "precio","price","comercio","trade","banco","bank","reservas","deuda",
      "deficit","impuesto","tax","presupuesto","budget","desempleo","unemployment",
      "salario","wage","mercado","market","consumo","consumption","industria",
      "industry","crecimiento","growth","recesión","recession","pib","gdp",
      "déficit","surplus","exportación","importación","export","import",
      "balanza comercial","trade balance","producto bruto","tariff","arancel",
    ],
  },
  finanzas: {
    name: "Finanzas & Mercados",
    emoji: "💹",
    ...CAT_STYLE,
    keywords: [
      "bolsa","stock","acciones","shares","dólar","dollar","peso","euro",
      "crypto","bitcoin","ethereum","inversión","investment","fondo","fund",
      "bonos","bonds","wall street","nasdaq","s&p 500","merval","banco central",
      "fed","reserva federal","tasa de interés","interest rate","divisa","currency",
      "forex","devaluación","devaluation","swap","financiero","financial",
      "mercado financiero","hedge fund","private equity","ipo","acciones",
      "portfolio","rendimiento","yield","cotización","tipo de cambio",
    ],
  },
  inversiones: {
    name: "Inversiones",
    emoji: "📊",
    ...CAT_STYLE,
    keywords: [
      "inversión","investment","investor","venture capital","startup","unicornio",
      "unicorn","tesla","nvidia","apple","microsoft","amazon","alphabet","meta",
      "openai","semiconductor","chip","commodities","petróleo","oil","gas",
      "oro","gold","plata","silver","cobre","copper","energía","energy",
      "renovable","renewable","real estate","inmueble","propiedad","renta",
      "dividendo","dividend","rentabilidad","retorno","roi","etf","criptoactivo",
    ],
  },
  deporte: {
    name: "Deporte",
    emoji: "⚽",
    ...CAT_STYLE,
    keywords: [
      "fútbol","football","soccer","tenis","tennis","rugby","básquet","basketball",
      "atletismo","athletics","olimpiadas","olympics","mundial","world cup","copa",
      "championship","liga","league","torneo","tournament","jugador","player",
      "equipo","team","gol","goal","partido","match","fifa","uefa","conmebol",
      "nba","nfl","mlb","formula 1","f1","motogp","ciclismo","cycling","natación",
      "swimming","boxeo","boxing","mma","ufc","transferencia","transfer","fichaje",
    ],
  },
};

function classifyNewsItem(n) {
  const text = `${n.title} ${n.description || ""}`.toLowerCase();
  const scores = {};
  for (const [catId, cat] of Object.entries(CATEGORIES)) {
    scores[catId] = cat.keywords.filter(kw => text.includes(kw)).length;
  }
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : null;
}

function buildCategorySections(allNewsByRegion) {
  const flat = Object.values(allNewsByRegion).flat();
  const buckets = {};
  for (const catId of Object.keys(CATEGORIES)) buckets[catId] = [];

  for (const n of flat) {
    const catId = classifyNewsItem(n);
    if (catId && buckets[catId].length < 8) buckets[catId].push(n);
  }

  return Object.entries(CATEGORIES).map(([catId, cat]) => {
    const items = buckets[catId];
    if (!items.length) return "";

    const rows = items.map((n, i) => {
      let desc = (n.description || "").trim();
      if (desc.length > 220) {
        const cut = desc.lastIndexOf(". ", 220);
        desc = cut > 60 ? desc.substring(0, cut + 1) : desc.substring(0, 220) + "…";
      }
      const isAlert = n.importance.level === "alta";
      const dot = isAlert
        ? `<span style="display:inline-block;width:6px;height:6px;background:#ef4444;border-radius:50%;margin-right:5px;vertical-align:middle;"></span>`
        : "";
      const body = desc
        ? `${dot}<strong style="color:#111827;">${n.title}:</strong> <span style="color:#6b7280;font-size:13px;">${desc}</span>`
        : `${dot}<strong style="color:#111827;">${n.title}</strong>`;
      const regionTag = `<span style="font-size:10px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:4px;padding:1px 7px;margin-left:6px;white-space:nowrap;">${EMOJIS[n.region] || ""} ${REGION_NAMES[n.region] || n.region}</span>`;
      return `
      <tr>
        <td style="padding:11px 0;border-bottom:${i < items.length - 1 ? "1px solid #f1f5f9" : "none"};vertical-align:top;font-size:13.5px;line-height:1.65;">
          ${body}${regionTag}
          <div style="margin-top:5px;">
            <a href="${n.link}" style="color:#1e3a5f;text-decoration:none;font-size:12px;font-weight:600;">Leer más →</a>
            <span style="font-size:11px;color:#94a3b8;margin-left:8px;">📰 ${n.source}</span>
          </div>
        </td>
      </tr>`;
    }).join("");

    return `
    <div id="cat-${catId}" style="background:#fff;border:1px solid #e2e8f0;border-left:3px solid #0f172a;border-radius:8px;margin-bottom:12px;overflow:hidden;">
      <div style="padding:11px 20px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:14px;font-weight:700;color:#0f172a;">${cat.emoji}&nbsp; ${cat.name}</span>
        <span style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">${items.length} nota${items.length !== 1 ? "s" : ""}</span>
      </div>
      <div style="padding:0 20px;">
        <table style="width:100%;border-collapse:collapse;"><tbody>${rows}</tbody></table>
      </div>
    </div>`;
  }).join("");
}

// ─── FINANZAS ─────────────────────────────────────────────────────────────────
// Plan gratuito Twelve Data: 8 créditos/minuto (1 por símbolo por request).
// Usamos 6 símbolos totales (3+3) para quedar cómodamente bajo el límite de 8.
const SP500_SAMPLE  = ["NVDA","AAPL","MSFT"];        // top 3 del S&P 500
const MERVAL_SAMPLE = ["GGAL","YPF","MELI"];          // top 3 ADRs argentinos
const SP500_SET     = new Set(SP500_SAMPLE);
const MERVAL_SET    = new Set(MERVAL_SAMPLE);
const MERVAL_NAMES  = {
  "GGAL":"Galicia","BMA":"Banco Macro","PAM":"Pampa Energía",
  "LOMA":"Loma Negra","YPF":"YPF","TGS":"Transp. Gas Sur",
  "MELI":"MercadoLibre","GLOB":"Globant","IRS":"IRSA","CAAP":"Aeropuertos Arg.",
};

// ─── CACHÉ ────────────────────────────────────────────────────────────────────
const cache = new Map();
function getCached(key) {
  const e = cache.get(key);
  if (!e) return null;
  if (Date.now() - e.ts > CONFIG.CACHE_TTL_MS) { cache.delete(key); return null; }
  return e.data;
}
function setCache(key, data) { cache.set(key, { ts: Date.now(), data }); }

// ─── PERSISTENCIA DE LINKS ENVIADOS (ANTI-DUPLICADOS) ─────────────────────────
function loadSeenLinks() {
  try {
    if (!fs.existsSync(CONFIG.SEEN_LINKS_PATH)) return new Map();
    const raw = fs.readFileSync(CONFIG.SEEN_LINKS_PATH, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    return new Map(parsed.filter(([link, ts]) => typeof link === "string" && Number.isFinite(ts)));
  } catch (e) {
    console.error("[Dedup] Error cargando seen_links.json:", e.message);
    return new Map();
  }
}

const seenLinks = loadSeenLinks();

function pruneSeenLinks() {
  const maxAgeMs = CONFIG.DEDUP_WINDOW_HOURS * 60 * 60 * 1_000;
  const now = Date.now();
  for (const [link, ts] of seenLinks.entries()) {
    if (now - ts > maxAgeMs) seenLinks.delete(link);
  }
}

function persistSeenLinks() {
  try {
    pruneSeenLinks();
    fs.writeFileSync(CONFIG.SEEN_LINKS_PATH, JSON.stringify([...seenLinks.entries()], null, 2), "utf8");
  } catch (e) {
    console.error("[Dedup] Error guardando seen_links.json:", e.message);
  }
}

function wasRecentlySent(link) {
  pruneSeenLinks();
  const key = canonicalizeUrl(link);
  const ts = seenLinks.get(key) || seenLinks.get(link);
  if (!ts) return false;
  const maxAgeMs = CONFIG.DEDUP_WINDOW_HOURS * 60 * 60 * 1_000;
  return Date.now() - ts <= maxAgeMs;
}

function markLinksAsSent(links) {
  const now = Date.now();
  for (const link of links) {
    const key = canonicalizeUrl(link);
    if (key) seenLinks.set(key, now);
  }
  persistSeenLinks();
}

// ─── LISTA DE DESTINATARIOS ───────────────────────────────────────────────────
function getRecipients() {
  try {
    const fallback = process.env.EMAIL_TO || process.env.EMAIL_FROM || "";
    if (!fs.existsSync(CONFIG.RECIPIENTS_PATH)) return fallback ? [fallback] : [];
    const lines = fs.readFileSync(CONFIG.RECIPIENTS_PATH, "utf8")
      .split("\n")
      .map(l => l.trim())
      .filter(l => isValidEmail(l));
    return lines.length ? lines : (fallback ? [fallback] : []);
  } catch { return []; }
}

function saveRecipients(list) {
  fs.writeFileSync(CONFIG.RECIPIENTS_PATH, list.join("\n") + "\n", "utf8");
}

function addRecipient(email) {
  const list = getRecipients();
  if (list.includes(email)) return false; // ya existe
  list.push(email);
  saveRecipients(list);
  return true;
}

function removeRecipient(email) {
  const list = getRecipients();
  const filtered = list.filter(e => e !== email);
  if (filtered.length === list.length) return false; // no estaba
  saveRecipients(filtered);
  return true;
}

// ─── NOTA EDITORIAL ──────────────────────────────────────────────────────────
function getNotaEditorial() {
  try {
    if (!fs.existsSync(CONFIG.NOTA_EDITORIAL_PATH)) return "";
    return fs.readFileSync(CONFIG.NOTA_EDITORIAL_PATH, "utf8").trim();
  } catch { return ""; }
}

function setNotaEditorial(texto) {
  fs.writeFileSync(CONFIG.NOTA_EDITORIAL_PATH, texto.trim(), "utf8");
}

function clearNotaEditorial() {
  fs.writeFileSync(CONFIG.NOTA_EDITORIAL_PATH, "", "utf8");
}

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
  return String(text)
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&apos;/g, "'").replace(/&#\d+;/g, "")
    .trim();
}
function escapeMd(text) { return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, "\\$&"); }
function isValidUrl(str) {
  try { const u = new URL(str); return u.protocol === "http:" || u.protocol === "https:"; }
  catch { return false; }
}
function canonicalizeUrl(str) {
  try {
    const u = new URL(str);
    const trackingParams = [
      "utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content",
      "gclid", "fbclid", "igshid", "mc_cid", "mc_eid", "traffic_source",
    ];
    for (const param of trackingParams) u.searchParams.delete(param);
    u.hash = "";
    if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) {
      u.port = "";
    }
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch {
    return String(str || "").trim();
  }
}
function getNewsletterCronExpression() {
  return `${CONFIG.NEWSLETTER_MINUTE} ${CONFIG.NEWSLETTER_HOUR} * * *`;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function getConfigStatus() {
  const emailFrom = process.env.EMAIL_FROM || "";
  const emailTo = process.env.EMAIL_TO || emailFrom;
  const emailEnabled = Boolean(process.env.EMAIL_FROM && process.env.EMAIL_PASS && emailTo);
  const issues = [];

  if (!TELEGRAM_CHAT_ID) {
    issues.push("TELEGRAM_CHAT_ID no está definido: el bot responderá a cualquier chat.");
  }
  if (emailEnabled && (!isValidEmail(emailFrom) || !isValidEmail(emailTo))) {
    issues.push("EMAIL_FROM o EMAIL_TO tiene formato inválido.");
  }
  if (!emailEnabled) {
    issues.push("Email incompleto: faltan EMAIL_FROM, EMAIL_PASS y/o EMAIL_TO.");
  }

  return {
    telegramRestricted: Boolean(TELEGRAM_CHAT_ID),
    emailEnabled,
    emailTo,
    dedupHours: CONFIG.DEDUP_WINDOW_HOURS,
    dedupNewsletterOnly: CONFIG.DEDUP_NEWSLETTER_ONLY,
    issues,
  };
}

function logConfigurationStatus() {
  const status = getConfigStatus();
  if (!status.issues.length) {
    console.log("[Config] Variables de entorno OK ✅");
    return;
  }
  console.log("[Config] Advertencias de configuración:");
  for (const issue of status.issues) console.log(`- ${issue}`);
}

function computeNewsletterMetrics(newsByRegion) {
  const flat = Object.values(newsByRegion).flat();
  const sourceCounter = new Map();
  const regionCounter = new Map();
  for (const item of flat) {
    sourceCounter.set(item.source, (sourceCounter.get(item.source) || 0) + 1);
    regionCounter.set(item.region, (regionCounter.get(item.region) || 0) + 1);
  }
  return {
    totalNews: flat.length,
    totalRegions: regionCounter.size,
    totalSources: sourceCounter.size,
    high: flat.filter(n => n.importance.level === "alta").length,
    medium: flat.filter(n => n.importance.level === "media").length,
    low: flat.filter(n => n.importance.level === "baja").length,
    topSources: [...sourceCounter.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([source, count]) => `${source} (${count})`),
  };
}

function writeHeartbeat(status = "ok") {
  const payload = {
    status,
    pid: process.pid,
    updatedAt: new Date().toISOString(),
    uptimeSec: Math.floor(process.uptime()),
  };
  for (const target of [CONFIG.HEARTBEAT_PATH, CONFIG.HEARTBEAT_COMPAT_PATH]) {
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(payload, null, 2), "utf8");
    } catch (e) {
      console.error(`[Heartbeat] Error escribiendo ${target}:`, e.message);
    }
  }
}

function startHeartbeat() {
  writeHeartbeat("startup");
  const interval = Number.isFinite(CONFIG.HEARTBEAT_INTERVAL_MS)
    ? Math.max(15_000, CONFIG.HEARTBEAT_INTERVAL_MS)
    : 60_000;
  setInterval(() => writeHeartbeat("ok"), interval).unref();
  console.log(`[Heartbeat] Activo cada ${Math.floor(interval / 1000)}s`);
}

// ─── FETCH FINANCIERO ─────────────────────────────────────────────────────────
async function fetchJSON(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        ...headers,
      },
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    clearTimeout(timer);
    throw e;
  }
}

async function fetchCryptoTop10() {
  try {
    const data = await fetchJSON(
      "https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&price_change_percentage=7d"
    );
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error("[Crypto] Error:", e.message);
    return [];
  }
}

function yahooTickerToStooq(ticker) {
  const t = String(ticker).trim();
  if (!t) return null;
  if (/\.BA$/i.test(t)) return t.toLowerCase();
  return `${t.replace(/\./g, "-").toLowerCase()}.us`;
}

// Stooq: datos demorados, suele responder donde Yahoo bloquea con 401 (servidor/PM2).
async function fetchStooqChart(ticker) {
  const sym = yahooTickerToStooq(ticker);
  if (!sym) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);
  try {
    const url = `https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PoliticalAgent/1.0)" },
    });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 3) return null;
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const parts = lines[i].split(",");
      const close = parseFloat(parts[4]);
      if (Number.isFinite(close)) rows.push(close);
    }
    if (rows.length < 2) return null;
    const currentPrice = rows[rows.length - 1];
    const prevClose    = rows[rows.length - 2];
    const weekAgoClose = rows.length >= 5 ? rows[rows.length - 5] : rows[0];
    const dayChangePct  = prevClose ? ((currentPrice - prevClose) / prevClose) * 100 : null;
    const weekChangePct = weekAgoClose ? ((currentPrice - weekAgoClose) / weekAgoClose) * 100 : null;
    return {
      symbol:                     ticker,
      shortName:                  ticker,
      regularMarketPrice:         currentPrice,
      regularMarketChangePercent: dayChangePct,
      weekChangePercent:          weekChangePct,
    };
  } catch (e) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Yahoo Finance v8/chart — a veces devuelve 401 desde IPs de datacenter; probamos 2 hosts y caemos a Stooq.
async function fetchYahooChart(ticker) {
  const bases = [
    "https://query1.finance.yahoo.com/v8/finance/chart",
    "https://query2.finance.yahoo.com/v8/finance/chart",
  ];
  const params = "?interval=1d&range=5d";
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    Referer: "https://finance.yahoo.com/",
    Origin: "https://finance.yahoo.com",
  };

  for (const base of bases) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/${encodeURIComponent(ticker)}${params}`, {
        signal: controller.signal,
        headers,
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          console.error(`[Yahoo] ${ticker}: HTTP ${res.status} (${base.includes("query2") ? "query2" : "query1"})`);
        }
        continue;
      }
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) continue;

      const meta   = result.meta;
      const closes = (result.indicators?.quote?.[0]?.close || []).filter(c => c != null);
      const currentPrice = meta.regularMarketPrice;
      const prevClose    = meta.chartPreviousClose || meta.previousClose || closes.at(-2);
      const weekAgoClose = closes.length >= 2 ? closes[0] : null;

      const dayChangePct  = prevClose    ? ((currentPrice - prevClose)    / prevClose)    * 100 : null;
      const weekChangePct = weekAgoClose ? ((currentPrice - weekAgoClose) / weekAgoClose) * 100 : null;

      return {
        symbol:                     meta.symbol,
        shortName:                  meta.shortName || meta.symbol,
        regularMarketPrice:         currentPrice,
        regularMarketChangePercent: dayChangePct,
        weekChangePercent:          weekChangePct,
      };
    } catch (e) {
      // siguiente host
    } finally {
      clearTimeout(timer);
    }
  }

  const stooq = await fetchStooqChart(ticker);
  if (stooq) console.log(`[Stooq] ${ticker}: datos vía respaldo`);
  return stooq;
}

async function fetchYahooQuotes(tickers) {
  const results = await Promise.allSettled(tickers.map(t => fetchYahooChart(t)));
  return results
    .filter(r => r.status === "fulfilled" && r.value !== null)
    .map(r => r.value);
}

// ─── TWELVE DATA — fuente primaria de acciones ────────────────────────────────
// Plan gratuito: 8 créditos/minuto (1 crédito por símbolo por request).
// UNA sola request con los 8 símbolos combinados (SP500_SAMPLE + MERVAL_SAMPLE).
// Cache compartida: tanto /stocks como el newsletter usan el mismo resultado.

let _stocksInFlight = null; // evita doble-fetch cuando SP500 y Merval se piden en paralelo

async function fetchAllStocksOneCall() {
  const cached = getCached("stocks_combined");
  if (cached) return cached;
  if (_stocksInFlight) return _stocksInFlight; // reutiliza la request en curso

  const apiKey = process.env.TWELVE_DATA_KEY;
  if (!apiKey) return null;

  _stocksInFlight = (async () => {
    const symbols = [...SP500_SAMPLE, ...MERVAL_SAMPLE].join(",");

    const tryFetch = async () => {
      const raw = await fetchJSON(
        `https://api.twelvedata.com/quote?symbol=${symbols}&apikey=${apiKey}`
      );
      if (!raw) return null;
      // 429 = rate limit → esperamos 62 segundos y reintentamos una vez
      if (raw.code === 429) {
        console.warn("[TwelveData] Rate limit (429) — reintentando en 62 s...");
        await new Promise(r => setTimeout(r, 62_000));
        return fetchJSON(
          `https://api.twelvedata.com/quote?symbol=${symbols}&apikey=${apiKey}`
        );
      }
      return raw;
    };

    try {
      // 6 símbolos = 6 créditos = bajo el límite de 8 del plan gratuito
      const quoteRaw = await tryFetch();

      if (!quoteRaw || quoteRaw.code) {
        console.error("[TwelveData] Error:", quoteRaw?.message || "sin respuesta");
        return null;
      }

      // Multi-símbolo: { AAPL: {...}, NVDA: {...} }  |  Mono: { symbol: "AAPL", ... }
      const all = quoteRaw.symbol ? [quoteRaw] : Object.values(quoteRaw);
      const valid = all.filter(q => q && q.close && !q.code && q.status !== "error");
      if (!valid.length) {
        console.error("[TwelveData] Sin cotizaciones:", JSON.stringify(quoteRaw).slice(0, 200));
        return null;
      }

      const toQuote = q => ({
        symbol:                     q.symbol,
        shortName:                  q.name || q.symbol,
        regularMarketPrice:         parseFloat(q.close),
        regularMarketChangePercent: parseFloat(q.percent_change),
        weekChangePercent:          parseFloat(q.percent_change), // diario como proxy
      });

      const result = {
        sp500:  valid.filter(q => SP500_SET.has(q.symbol)).map(toQuote)
                     .sort((a, b) => (b.weekChangePercent || 0) - (a.weekChangePercent || 0)),
        merval: valid.filter(q => MERVAL_SET.has(q.symbol)).map(toQuote)
                     .sort((a, b) => (b.weekChangePercent || 0) - (a.weekChangePercent || 0)),
      };

      setCache("stocks_combined", result);
      console.log(`[TwelveData] OK — ${result.sp500.length} S&P500, ${result.merval.length} Merval`);
      return result;
    } catch (e) {
      console.error("[TwelveData] Error:", e.message);
      return null;
    } finally {
      _stocksInFlight = null;
    }
  })();

  return _stocksInFlight;
}

async function fetchSP500Stocks() {
  try {
    const data = await fetchAllStocksOneCall();
    return data?.sp500 || [];
  } catch (e) {
    console.error("[Stocks SP500] Error:", e.message);
    return [];
  }
}

async function fetchMervalStocks() {
  try {
    const data = await fetchAllStocksOneCall();
    return data?.merval || [];
  } catch (e) {
    console.error("[Stocks Merval] Error:", e.message);
    return [];
  }
}

async function fetchAllFinancialData() {
  const [cryptoRes, sp500Res, mervalRes] = await Promise.allSettled([
    fetchCryptoTop10(),
    fetchSP500Stocks(),
    fetchMervalStocks(),
  ]);
  return {
    crypto: cryptoRes.status  === "fulfilled" ? cryptoRes.value  : [],
    sp500:  sp500Res.status   === "fulfilled" ? sp500Res.value   : [],
    merval: mervalRes.status  === "fulfilled" ? mervalRes.value  : [],
  };
}

function fmtPct(pct) {
  if (pct == null) return "–";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}
function pctColor(pct) { return pct >= 0 ? "#16a34a" : "#dc2626"; }
function pctEmoji(pct) {
  if (pct == null) return "⬜";
  if (pct >= 5)  return "🚀";
  if (pct >= 2)  return "📈";
  if (pct >= 0)  return "🟢";
  if (pct >= -2) return "🔴";
  return "📉";
}

// ─── EMOJI CONTEXTUAL POR NOTICIA ────────────────────────────────────────────
function getNewsEmoji(title, desc = "") {
  const t = `${title} ${desc}`.toLowerCase();
  if (/nuclear|arma nuclear|weapon of mass|wmd|radiaci/.test(t))          return "☢️";
  if (/war|guerra|invasion|invasión|ataque|attack|bomb|troops|tropa|combat|offensive|ofensiva|missile|misil/.test(t)) return "⚔️";
  if (/sanction|sanción|embargo|blockade|bloqueo/.test(t))                return "🚫";
  if (/election|elección|vote|voto|ballot|referéndum|referendum|poll/.test(t)) return "🗳️";
  if (/president|presidente|prime minister|premier|chancellor|chancellor/.test(t)) return "🏛️";
  if (/summit|cumbre|treaty|tratado|agreement|acuerdo|diplomac|negociac/.test(t)) return "🤝";
  if (/tariff|arancel|trade war|guerra comercial|import|export|wto|omc/.test(t)) return "🛃";
  if (/economy|economía|inflation|inflación|gdp|pbi|recession|recesión|market|mercado|fed |banco central/.test(t)) return "💰";
  if (/oil|petróleo|gas |energy|energía|opec|pipeline|gasoducto/.test(t)) return "⛽";
  if (/climate|clima|environment|medio ambiente|carbon|emission|emisión|cop\d/.test(t)) return "🌱";
  if (/tech|tecnología|artificial intelligence|inteligencia artificial|cyber|digital|silicon|chip/.test(t)) return "💻";
  if (/health|salud|pandemic|pandemia|disease|enfermedad|vaccine|vacuna|virus|outbreak/.test(t)) return "🏥";
  if (/protest|protesta|strike|huelga|riot|disturbio|demonstration|manifestac/.test(t)) return "✊";
  if (/migration|migración|refugee|refugiado|border|frontera|asylum|asilo/.test(t)) return "🚶";
  if (/court|tribunal|arrest|detenido|sentenced|condena|trial|juicio|justice|justicia/.test(t)) return "⚖️";
  if (/earthquake|terremoto|flood|inundación|hurricane|huracán|wildfire|incendio|disaster/.test(t)) return "🆘";
  if (/space|espacio|nasa|rocket|cohete|satellite|satélite|moon|luna/.test(t)) return "🚀";
  if (/military|militar|navy|armada|army|ejército|air force|fuerza aérea|nato|otan/.test(t)) return "🎖️";
  if (/china|beijing|xi jinping/.test(t))    return "🇨🇳";
  if (/russia|rusia|putin|kremlin/.test(t))  return "🇷🇺";
  if (/ukraine|ucrania|zelensky/.test(t))    return "🇺🇦";
  if (/israel|gaza|palestin|hamas|hezbollah/.test(t)) return "🌍";
  if (/iran|persia|tehran|teherán/.test(t))  return "🌙";
  if (/trump|biden|white house|casa blanca|congress|congreso|senate|senado/.test(t)) return "🇺🇸";
  if (/argentina|milei|buenos aires/.test(t)) return "🇦🇷";
  if (/brazil|brasil|lula|bolsonaro/.test(t)) return "🇧🇷";
  return "📰";
}

function buildFinancialHTML(financial) {
  const { crypto, sp500, merval } = financial;

  // ── Market Overview: 3 metric cards (BTC, top SP500, top ADR) ──────────────
  const btc = crypto.find(c => c.symbol === "btc") || crypto[0];
  const topSp = sp500[0];
  const topAdr = merval[0];

  function metricCard(label, symbol, price, pct) {
    const sign = pct >= 0 ? "+" : "";
    const color = pct >= 0 ? "#16a34a" : "#dc2626";
    return `
    <td style="width:33%;text-align:center;padding:16px 8px;border-right:1px solid #f3f4f6;">
      <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.6px;color:#6b7280;margin-bottom:4px;">${label}</div>
      <div style="font-size:13px;font-weight:700;color:#111827;">${symbol}</div>
      <div style="font-size:15px;font-weight:700;color:#111827;margin:2px 0;">$${price}</div>
      <div style="font-size:12px;font-weight:600;color:${color};">${sign}${pct != null ? pct.toFixed(2) : "–"}%</div>
    </td>`;
  }

  const btcPrice  = btc ? btc.current_price?.toLocaleString("en-US", {maximumFractionDigits: 0}) : "–";
  const btcPct    = btc ? (btc.price_change_percentage_7d_in_currency ?? btc.price_change_percentage_24h) : null;
  const spPrice   = topSp ? topSp.regularMarketPrice?.toFixed(2) : "–";
  const spPct     = topSp ? (topSp.weekChangePercent ?? topSp.regularMarketChangePercent) : null;
  const adrPrice  = topAdr ? topAdr.regularMarketPrice?.toFixed(2) : "–";
  const adrPct    = topAdr ? (topAdr.weekChangePercent ?? topAdr.regularMarketChangePercent) : null;

  const overviewHTML = `
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px;overflow:hidden;">
    <div style="padding:12px 20px 10px;border-bottom:1px solid #f3f4f6;">
      <span style="font-size:15px;font-weight:700;color:#111827;">Market Overview</span>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        ${btc  ? metricCard("Bitcoin",  "BTC",  btcPrice, btcPct)  : `<td style="width:33%;padding:16px;text-align:center;color:#9ca3af;font-size:12px;border-right:1px solid #f3f4f6;">Sin datos</td>`}
        ${topSp ? metricCard("S&amp;P 500", topSp.symbol, spPrice, spPct)  : `<td style="width:33%;padding:16px;text-align:center;color:#9ca3af;font-size:12px;border-right:1px solid #f3f4f6;">Sin datos</td>`}
        ${topAdr ? metricCard("ADR Arg.", topAdr.symbol, adrPrice, adrPct) : `<td style="width:33%;padding:16px;text-align:center;color:#9ca3af;font-size:12px;">Sin datos</td>`}
      </tr>
    </table>
  </div>`;

  // ── Tabla auxiliar reutilizable ────────────────────────────────────────────
  function dataTable(rows) {
    if (!rows.length) return `<p style="font-size:12px;color:#9ca3af;margin:8px 0;">Sin datos disponibles</p>`;
    return `
    <table style="width:100%;border-collapse:collapse;">
      <thead>
        <tr>
          <th style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;text-align:left;padding:6px 0;border-bottom:1px solid #e5e7eb;">Activo</th>
          <th style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;text-align:right;padding:6px 0;border-bottom:1px solid #e5e7eb;">Precio</th>
          <th style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;text-align:right;padding:6px 0;border-bottom:1px solid #e5e7eb;">7d</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  }

  const tdBase = `style="font-size:13px;padding:8px 0;border-bottom:1px solid #f9fafb;color:#374151;"`;

  // Crypto rows
  const cryptoRows = crypto.map(c => {
    const pct  = c.price_change_percentage_7d_in_currency ?? c.price_change_percentage_24h;
    const col  = pct >= 0 ? "#16a34a" : "#dc2626";
    const sign = pct >= 0 ? "+" : "";
    const price = c.current_price?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "–";
    return `<tr>
      <td ${tdBase}><b>${c.symbol?.toUpperCase()}</b> <span style="color:#6b7280;font-size:11px;">${c.name}</span></td>
      <td ${tdBase} style="font-size:13px;padding:8px 0;border-bottom:1px solid #f9fafb;text-align:right;">$${price}</td>
      <td ${tdBase} style="font-size:13px;padding:8px 0;border-bottom:1px solid #f9fafb;text-align:right;font-weight:600;color:${col};">${sign}${pct != null ? pct.toFixed(2) : "–"}%</td>
    </tr>`;
  }).join("");

  // SP500 rows
  const sp500Rows = sp500.map(q => {
    const pct  = q.weekChangePercent ?? q.regularMarketChangePercent;
    const col  = pct >= 0 ? "#16a34a" : "#dc2626";
    const sign = pct >= 0 ? "+" : "";
    return `<tr>
      <td ${tdBase}><b>${q.symbol}</b> <span style="color:#6b7280;font-size:11px;">${q.shortName || ""}</span></td>
      <td ${tdBase} style="font-size:13px;padding:8px 0;border-bottom:1px solid #f9fafb;text-align:right;">$${q.regularMarketPrice?.toFixed(2) ?? "–"}</td>
      <td ${tdBase} style="font-size:13px;padding:8px 0;border-bottom:1px solid #f9fafb;text-align:right;font-weight:600;color:${col};">${sign}${pct != null ? pct.toFixed(2) : "–"}%</td>
    </tr>`;
  }).join("");

  // ADR rows
  const adrRows = merval.map(q => {
    const pct  = q.weekChangePercent ?? q.regularMarketChangePercent;
    const col  = pct >= 0 ? "#16a34a" : "#dc2626";
    const sign = pct >= 0 ? "+" : "";
    const name = MERVAL_NAMES[q.symbol] || q.shortName || q.symbol;
    return `<tr>
      <td ${tdBase}><b>${q.symbol}</b> <span style="color:#6b7280;font-size:11px;">${name}</span></td>
      <td ${tdBase} style="font-size:13px;padding:8px 0;border-bottom:1px solid #f9fafb;text-align:right;">$${q.regularMarketPrice?.toFixed(2) ?? "–"}</td>
      <td ${tdBase} style="font-size:13px;padding:8px 0;border-bottom:1px solid #f9fafb;text-align:right;font-weight:600;color:${col};">${sign}${pct != null ? pct.toFixed(2) : "–"}%</td>
    </tr>`;
  }).join("");

  const card = (title, content) => `
  <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px;overflow:hidden;">
    <div style="padding:12px 20px 10px;border-bottom:1px solid #f3f4f6;">
      <span style="font-size:15px;font-weight:700;color:#111827;">${title}</span>
    </div>
    <div style="padding:4px 20px 16px;">${content}</div>
  </div>`;

  return overviewHTML
    + card("Top 10 Criptomonedas <span style='font-size:11px;font-weight:400;color:#9ca3af;'>· var. 7 días</span>", dataTable(cryptoRows))
    + card("S&amp;P 500 <span style='font-size:11px;font-weight:400;color:#9ca3af;'>· var. semanal</span>", dataTable(sp500Rows))
    + card("ADRs Argentinos (NYSE) <span style='font-size:11px;font-weight:400;color:#9ca3af;'>· var. semanal</span>", dataTable(adrRows));
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
      items.push({ title, link, description: desc.substring(0, 500) });
    }
    return items;
  } catch (e) {
    console.error(`[RSS] ${url}: ${e.message}`);
    return [];
  } finally { clearTimeout(timer); }
}

async function fetchSourceWithFallbacks(source) {
  const urls = [source.url, ...(source.fallbackUrls || [])].filter(Boolean);
  for (const url of urls) {
    const items = await fetchRSS(url);
    if (items.length) return items;
  }
  return [];
}

function getImportance(title, desc) {
  const text = `${title} ${desc}`.toLowerCase();
  if (KEYWORDS.alta.some(k => text.includes(k)))  return { level: "alta",  emoji: "🔴" };
  if (KEYWORDS.media.some(k => text.includes(k))) return { level: "media", emoji: "🟡" };
  return { level: "baja", emoji: "🟢" };
}

// ─── "POR QUÉ IMPORTA" ───────────────────────────────────────────────────────
// Genera una línea de contexto para noticias de importancia alta.
// Usa patrones del título/descripción para inferir el impacto concreto.
function getPorQueImporta(title, desc) {
  const text = `${title} ${desc || ""}`.toLowerCase();

  // Patrones: [regex, template de impacto]
  const patterns = [
    [/guerra|ataque|bombardeo|misil|cohete|ofensiva|invasion|ocupaci/,
      "Escala el conflicto armado — puede afectar mercados de energía y cadenas de suministro globales."],
    [/sancion|embargo|bloqueo/,
      "Las sanciones económicas impactan directamente el comercio y el tipo de cambio."],
    [/eleccion|voto|ballotage|referendum|candidat/,
      "Define el rumbo político del país por los próximos años."],
    [/inflaci|precio|costo de vida|ipc|indec/,
      "Afecta el poder adquisitivo de millones de personas en tiempo real."],
    [/reservas|banco central|tipo de cambio|dolar|peso/,
      "Señal directa sobre la estabilidad cambiaria y el acceso a divisas."],
    [/imf|fmi|fondo monetario|deuda|bono|default/,
      "Condiciona el financiamiento del Estado y la política económica de corto plazo."],
    [/muer|falleci|victim|masacre|atentado/,
      "Crisis humanitaria activa — seguimiento internacional garantizado."],
    [/trump|biden|milei|lula|xi jinping|putin|zelensky/,
      "Decisión de liderazgo global con efecto inmediato en relaciones internacionales."],
    [/recesion|crisis economica|quiebra|desempleo|cierre/,
      "Indicador de contracción económica — puede anticipar medidas de emergencia."],
    [/petroleo|gas|energia|litio|commodit/,
      "Mueve los precios de materias primas estratégicas para Argentina y la región."],
    [/corrupci|juicio|condena|arresto|fiscal|imputad/,
      "Impacto político directo — puede redefinir el equilibrio de poder institucional."],
    [/acuerdo|tratado|alianza|cumbre|g20|g7|mercosur/,
      "Nuevo marco geopolítico o comercial con efectos de mediano plazo."],
    [/terremoto|inundaci|incendi|desastre|emergencia/,
      "Crisis de emergencia activa — requiere respuesta humanitaria inmediata."],
    [/ia|inteligencia artificial|tecnologia|regulacion tech/,
      "Define el marco regulatorio de la tecnología más disruptiva de la década."],
  ];

  for (const [regex, impact] of patterns) {
    if (regex.test(text)) return impact;
  }

  // Fallback: extraer la segunda oración de la descripción si existe
  if (desc) {
    const sentences = desc.split(/[.!?]/).map(s => s.trim()).filter(s => s.length > 30);
    if (sentences.length >= 2) return sentences[1] + ".";
  }
  return null;
}

// ─── NÚMERO DEL DÍA ──────────────────────────────────────────────────────────
// Extrae el dato numérico más impactante del conjunto de noticias del día.
function getNumeroDelDia(allNewsByRegion) {
  const flat = Object.values(allNewsByRegion).flat();
  const numRegex = /(\d[\d.,]*\s*(?:%|millones?|billones?|mil millones?|USD|km²?|personas?|muertos?|heridos?|votos?|años?))/i;

  for (const n of flat.filter(x => x.importance.level === "alta")) {
    const text = `${n.title} ${n.description || ""}`;
    const match = text.match(numRegex);
    if (match) {
      // Extraer contexto: hasta 80 chars alrededor del número
      const idx = text.indexOf(match[0]);
      const start = Math.max(0, idx - 30);
      const end = Math.min(text.length, idx + match[0].length + 50);
      const context = text.slice(start, end).trim().replace(/^[^A-Za-z0-9]/, "");
      return { numero: match[0], contexto: context, fuente: n.source };
    }
  }
  return null;
}

function getRelevanceScore(item) {
  const importanceWeight = { alta: 300, media: 200, baja: 100 }[item.importance.level] || 50;
  const title = (item.title || "").trim();
  const titleLenScore = Math.min(40, Math.max(0, title.length / 4));
  const sourceBonus = /google news/i.test(item.source || "") ? 0 : 20;
  return importanceWeight + titleLenScore + sourceBonus;
}

async function getRegionNews(regionId) {
  const cached = getCached(regionId);
  if (cached) return cached;
  const sources = RSS_SOURCES[regionId] || [];
  const fetchFromSources = async (sourceList) => {
    const results = await Promise.allSettled(
      sourceList.map(s => fetchSourceWithFallbacks(s).then(items =>
        items.map(item => ({ ...item, source: s.name, region: regionId, importance: getImportance(item.title, item.description) }))
      ))
    );
    return results.filter(r => r.status === "fulfilled").flatMap(r => r.value);
  };

  let aggregated = await fetchFromSources(sources);
  if (!aggregated.length && (REGION_FALLBACK_SOURCES[regionId] || []).length) {
    console.log(`[RSS] ${regionId}: sin resultados primarios, usando respaldo`);
    aggregated = await fetchFromSources(REGION_FALLBACK_SOURCES[regionId]);
  }

  const seen = new Set();
  const sourceCounter = new Map();
  const news = aggregated
    .filter(n => {
      const canonical = canonicalizeUrl(n.link);
      if (!canonical || seen.has(canonical)) return false;
      seen.add(canonical);
      n.link = canonical;
      return true;
    })
    .sort((a, b) => getRelevanceScore(b) - getRelevanceScore(a))
    .filter(n => {
      const count = sourceCounter.get(n.source) || 0;
      if (count >= CONFIG.MAX_ITEMS_PER_SOURCE_REGION) return false;
      sourceCounter.set(n.source, count + 1);
      return true;
    })
    .slice(0, CONFIG.MAX_NEWS_PER_REGION);
  setCache(regionId, news);
  return news;
}

async function collectAllNewsByRegion() {
  const allNewsByRegion = {};
  await Promise.allSettled(
    Object.keys(RSS_SOURCES).map(async id => {
      allNewsByRegion[id] = await getRegionNews(id);
    })
  );
  return allNewsByRegion;
}

function applyDedupFilter(newsByRegion) {
  const filtered = {};
  for (const [regionId, list] of Object.entries(newsByRegion)) {
    filtered[regionId] = list.filter(n => !wasRecentlySent(n.link));
  }
  return filtered;
}

async function checkAllRegions() {
  const results = await Promise.allSettled(Object.keys(RSS_SOURCES).map(getRegionNews));
  return results.filter(r => r.status === "fulfilled").flatMap(r => r.value)
    .filter(n => n.importance.level !== "baja").slice(0, CONFIG.MAX_GLOBAL_NEWS);
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
async function sendToCtx(ctx, text)    { for (const c of splitMessage(text)) await ctx.reply(c, SEND_OPTS); }
async function sendToChat(chatId, text) { for (const c of splitMessage(text)) await bot.telegram.sendMessage(chatId, c, SEND_OPTS); }

// ─── NEWSLETTER HTML ──────────────────────────────────────────────────────────
function buildNewsletterHTML(allNewsByRegion, financial = null) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("es-AR", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
    timeZone: CONFIG.TIMEZONE,
  });
  const dateCapitalized = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  const editionNum = Math.floor((now - new Date("2024-01-01")) / 86400000);

  // ── Editorial note ────────────────────────────────────────────────────────
  const nota = getNotaEditorial();
  const notaHTML = nota ? `
  <div style="background:linear-gradient(135deg,#1e3a5f 0%,#1d4ed8 100%);border-radius:10px;padding:22px 24px;margin-bottom:18px;">
    <div style="font-size:10px;font-weight:700;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">✍️ Del editor</div>
    <p style="font-size:15px;color:#f0f9ff;line-height:1.8;margin:0;font-style:italic;white-space:pre-wrap;">"${nota}"</p>
    <div style="margin-top:12px;font-size:11px;color:#60a5fa;">— Teo Palatini</div>
  </div>` : "";

  // ── Métricas ──────────────────────────────────────────────────────────────
  const flat = Object.values(allNewsByRegion).flat();
  const alerts = flat.filter(n => n.importance.level === "alta").slice(0, CONFIG.ALERTS_LIMIT);
  const metrics = computeNewsletterMetrics(allNewsByRegion);

  const statsBar = `
  <div style="display:flex;gap:0;margin-bottom:18px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
    <div style="flex:1;text-align:center;padding:12px 8px;border-right:1px solid #e5e7eb;background:#fff;">
      <div style="font-size:20px;font-weight:800;color:#111827;">${metrics.totalNews}</div>
      <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Noticias</div>
    </div>
    <div style="flex:1;text-align:center;padding:12px 8px;border-right:1px solid #e5e7eb;background:#fff;">
      <div style="font-size:20px;font-weight:800;color:#dc2626;">${metrics.high}</div>
      <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Alertas</div>
    </div>
    <div style="flex:1;text-align:center;padding:12px 8px;border-right:1px solid #e5e7eb;background:#fff;">
      <div style="font-size:20px;font-weight:800;color:#059669;">${metrics.totalRegions}</div>
      <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Regiones</div>
    </div>
    <div style="flex:1;text-align:center;padding:12px 8px;background:#fff;">
      <div style="font-size:20px;font-weight:800;color:#7c3aed;">${metrics.totalSources}</div>
      <div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Fuentes</div>
    </div>
  </div>`;

  // ── Número del día ────────────────────────────────────────────────────────
  const numeroDia = getNumeroDelDia(allNewsByRegion);
  const numeroDiaHTML = numeroDia ? `
  <div style="background:#fff;border:1px solid #e2e8f0;border-left:4px solid #1e3a5f;border-radius:8px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:flex-start;gap:14px;">
    <div style="font-size:28px;line-height:1;">📌</div>
    <div>
      <div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">El número del día</div>
      <div style="font-size:18px;font-weight:900;color:#1e3a5f;margin-bottom:3px;">${numeroDia.numero}</div>
      <div style="font-size:13px;color:#374151;line-height:1.5;">${numeroDia.contexto}</div>
      <div style="font-size:10px;color:#9ca3af;margin-top:4px;">📰 ${numeroDia.fuente}</div>
    </div>
  </div>` : "";

  // ── Alertas del día ───────────────────────────────────────────────────────
  const alertCard = alerts.length ? (() => {
    const rows = alerts.map(n => {
      let desc = (n.description || "").trim();
      if (desc.length > 240) {
        const cut = desc.lastIndexOf(". ", 240);
        desc = cut > 60 ? desc.substring(0, cut + 1) : desc.substring(0, 240) + "…";
      }
      const porQueImporta = getPorQueImporta(n.title, n.description);
      const body = desc
        ? `<strong style="color:#fff;">${n.title}:</strong> <span style="color:#fca5a5;">${desc}</span>`
        : `<strong style="color:#fff;">${n.title}</strong>`;
      const porQueHTML = porQueImporta
        ? `<div style="margin-top:6px;padding:6px 10px;background:rgba(0,0,0,0.2);border-radius:5px;font-size:12px;color:#fef3c7;font-style:italic;line-height:1.5;"><strong style="color:#fbbf24;">Por qué importa:</strong> ${porQueImporta}</div>`
        : "";
      return `
      <tr>
        <td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.1);vertical-align:top;font-size:13.5px;line-height:1.65;">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#fca5a5;margin-bottom:5px;">${EMOJIS[n.region] || ""} ${REGION_NAMES[n.region] || n.region}</div>
          ${body}
          ${porQueHTML}
          <div style="margin-top:6px;"><a href="${n.link}" style="color:#fbbf24;text-decoration:none;font-size:12px;font-weight:600;">Ver noticia →</a><span style="font-size:11px;color:#f87171;margin-left:8px;">📰 ${n.source}</span></div>
        </td>
      </tr>`;
    }).join("");
    return `
  <div style="background:linear-gradient(135deg,#7f1d1d 0%,#dc2626 100%);border-radius:10px;margin-bottom:18px;overflow:hidden;">
    <div style="padding:14px 22px 12px;">
      <span style="font-size:13px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.5px;">🚨 Alertas del día</span>
    </div>
    <div style="padding:0 22px 4px;">
      <table style="width:100%;border-collapse:collapse;"><tbody>${rows}</tbody></table>
    </div>
  </div>`;
  })() : "";

  // ── Noticias por región ───────────────────────────────────────────────────
  const regionCards = Object.entries(REGION_NAMES).map(([id, name]) => {
    const news = (allNewsByRegion[id] || []).slice(0, 6);
    if (!news.length) return "";
    const items = news.map((n, i) => {
      const emoji = getNewsEmoji(n.title, n.description);
      let desc = (n.description || "").trim();
      if (desc.length > 260) {
        const cut = desc.lastIndexOf(". ", 260);
        desc = cut > 60 ? desc.substring(0, cut + 1) : desc.substring(0, 260) + "…";
      }
      const importanceDot = n.importance.level === "alta"
        ? `<span style="display:inline-block;width:7px;height:7px;background:#ef4444;border-radius:50%;margin-right:5px;vertical-align:middle;"></span>`
        : n.importance.level === "media"
          ? `<span style="display:inline-block;width:7px;height:7px;background:#f59e0b;border-radius:50%;margin-right:5px;vertical-align:middle;"></span>`
          : "";
      const body = desc
        ? `${importanceDot}<strong style="color:#111827;">${n.title}:</strong> <span style="color:#6b7280;">${desc}</span>`
        : `${importanceDot}<strong style="color:#111827;">${n.title}</strong>`;
      const porQueRegion = n.importance.level === "alta" ? getPorQueImporta(n.title, n.description) : null;
      const porQueRegionHTML = porQueRegion
        ? `<div style="margin-top:5px;padding:5px 9px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:3px;font-size:11.5px;color:#78350f;font-style:italic;line-height:1.5;"><strong style="color:#d97706;">Por qué importa:</strong> ${porQueRegion}</div>`
        : "";
      return `
      <tr>
        <td style="padding:11px 0;border-bottom:${i < news.length - 1 ? "1px solid #f3f4f6" : "none"};vertical-align:top;font-size:13.5px;line-height:1.65;">
          <span style="font-size:16px;margin-right:5px;">${emoji}</span>${body}
          ${porQueRegionHTML}
          <div style="margin-top:4px;"><a href="${n.link}" style="color:#2563eb;text-decoration:none;font-size:12px;font-weight:600;">Leer más →</a><span style="font-size:11px;color:#9ca3af;margin-left:8px;">📰 ${n.source}</span></div>
        </td>
      </tr>`;
    }).join("");
    return `
    <div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
      <div style="padding:13px 22px 11px;background:linear-gradient(90deg,#f9fafb 0%,#fff 100%);border-bottom:1px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:15px;font-weight:700;color:#111827;">${EMOJIS[id]} ${name}</span>
        <span style="font-size:11px;color:#9ca3af;">${news.length} nota${news.length !== 1 ? "s" : ""}</span>
      </div>
      <div style="padding:2px 22px 6px;">
        <table style="width:100%;border-collapse:collapse;"><tbody>${items}</tbody></table>
      </div>
    </div>`;
  }).join("");

  // ── Por categorías ────────────────────────────────────────────────────────
  const categorySections = buildCategorySections(allNewsByRegion);

  // ── Índice de categorías (ToC clickeable) ────────────────────────────────
  const catIndex = Object.entries(CATEGORIES)
    .filter(([catId]) => {
      // Solo mostrar las que tienen contenido
      const flat2 = Object.values(allNewsByRegion).flat();
      return flat2.some(n => classifyNewsItem(n) === catId);
    })
    .map(([catId, cat]) =>
      `<a href="#cat-${catId}" style="display:inline-block;background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:5px 13px;font-size:12px;font-weight:600;color:#1e3a5f;text-decoration:none;white-space:nowrap;">${cat.emoji} ${cat.name}</a>`
    ).join(" ");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Agente Político — Newsletter #${editionNum}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:620px;margin:0 auto;padding:24px 16px 40px;">

  <!-- ══ HEADER ══ -->
  <div style="background:#0f172a;border-radius:14px;padding:34px 30px 28px;margin-bottom:18px;text-align:center;">

    <!-- Fecha + edición -->
    <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:1.4px;margin-bottom:20px;">${dateCapitalized} &nbsp;·&nbsp; Edición #${editionNum}</div>

    <!-- Logo + Título -->
    <div style="margin-bottom:14px;">
      <svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;">
        <rect width="48" height="48" rx="12" fill="#1e3a5f"/>
        <circle cx="24" cy="24" r="13" fill="none" stroke="white" stroke-width="1.4"/>
        <line x1="24" y1="11" x2="24" y2="37" stroke="white" stroke-width="1.4"/>
        <line x1="11" y1="24" x2="37" y2="24" stroke="white" stroke-width="1.4"/>
        <ellipse cx="24" cy="24" rx="6.5" ry="13" fill="none" stroke="white" stroke-width="1.2"/>
      </svg>
    </div>
    <div style="font-size:28px;font-weight:900;color:#f8fafc;letter-spacing:-0.5px;margin-bottom:5px;">Agente Político</div>
    <div style="font-size:12px;color:#64748b;letter-spacing:0.4px;">Política · Economía · Finanzas · Sin sesgo</div>

    <!-- Firma personal -->
    <div style="margin-top:22px;padding-top:18px;border-top:1px solid #1e293b;display:flex;align-items:center;justify-content:center;gap:12px;">
      <div style="width:34px;height:34px;background:#1e3a5f;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#93c5fd;flex-shrink:0;">T</div>
      <div style="text-align:left;">
        <div style="font-size:13px;font-weight:700;color:#e2e8f0;">Teo Palatini</div>
        <div style="font-size:10px;color:#64748b;margin-top:1px;">Buenos Aires · UDESA · tpalatini@udesa.edu.ar</div>
      </div>
    </div>

  </div>

  <!-- ══ NOTA EDITORIAL ══ -->
  ${notaHTML}

  <!-- ══ STATS ══ -->
  ${statsBar}

  <!-- ══ ÍNDICE DE CATEGORÍAS ══ -->
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;margin-bottom:18px;">
    <div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">En este número</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;line-height:1;">
      ${catIndex}
    </div>
  </div>

  <!-- ══ NÚMERO DEL DÍA ══ -->
  ${numeroDiaHTML}

  <!-- ══ FINANZAS ══ -->
  ${financial ? buildFinancialHTML(financial) : ""}

  <!-- ══ ALERTAS ══ -->
  ${alertCard}

  <!-- ══ NOTICIAS POR REGIÓN ══ -->
  <div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;margin-top:4px;">🗺️ Por región</div>
  ${regionCards}

  <!-- ══ DIVISOR ══ -->
  <div style="margin:30px 0 20px;text-align:center;">
    <div style="display:inline-block;background:#0f172a;color:#94a3b8;font-size:9px;font-weight:700;padding:5px 18px;border-radius:20px;letter-spacing:1.2px;text-transform:uppercase;">Por categoría</div>
  </div>

  <!-- ══ CATEGORÍAS ══ -->
  ${categorySections}

  <!-- ══ FOOTER ══ -->
  <div style="margin-top:30px;padding:22px 24px;background:#fff;border-radius:10px;border:1px solid #e2e8f0;text-align:center;">
    <div style="font-size:13px;font-weight:800;color:#0f172a;margin-bottom:6px;">Agente Político</div>
    <div style="font-size:11px;color:#94a3b8;line-height:2;">
      Curado por <strong style="color:#1e3a5f;">Teo Palatini</strong> · Buenos Aires · ${now.getFullYear()}<br>
      BBC · NPR · Euronews · DW · SCMP · Moscow Times · Al Jazeera · Folha · La Nación · Clarín<br>
      <span style="font-size:10px;color:#cbd5e1;">Agregá tu nota: <strong>/setnota</strong> en Telegram</span>
    </div>
  </div>

</div>
</body>
</html>`;
}

// ─── NEWSLETTER — ENVÍO ───────────────────────────────────────────────────────
function createTransporter() {
  const emailFrom = String(process.env.EMAIL_FROM || "").trim();
  const emailUser = String(process.env.EMAIL_USER || emailFrom).trim();
  let emailPass = String(process.env.EMAIL_PASS || "").trim();
  if (!emailFrom || !emailPass) return null;

  // Gmail muestra app passwords con espacios (xxxx xxxx xxxx xxxx).
  // Nodemailer necesita el valor continuo sin espacios.
  if (/@gmail\.com$/i.test(emailUser)) {
    emailPass = emailPass
      .replace(/\s+/g, "")
      .replace(/[^a-zA-Z0-9]/g, "")
      .toLowerCase();
  }

  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: emailUser, pass: emailPass },
  });
}

async function verifyEmailTransport() {
  const transporter = createTransporter();
  if (!transporter) return { ok: false, reason: "email_not_configured" };
  try {
    await transporter.verify();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "smtp_auth_failed", message: e.message || "unknown" };
  }
}

async function sendNewsletter() {
  const transporter = createTransporter();
  if (!transporter) {
    console.log("[Newsletter] Sin configuración de email — omitido");
    return { ok: false, reason: "email_not_configured" };
  }

  console.log("[Newsletter] Generando...");
  const [allNewsByRegion, financial] = await Promise.all([
    collectAllNewsByRegion(),
    fetchAllFinancialData(),
  ]);

  const now     = new Date();
  const dateStr = now.toLocaleDateString("es-AR", {
    day: "numeric", month: "long", year: "numeric", timeZone: CONFIG.TIMEZONE,
  });
  const finalNewsByRegion = CONFIG.DEDUP_NEWSLETTER_ONLY
    ? applyDedupFilter(allNewsByRegion)
    : allNewsByRegion;

  const remaining = Object.values(finalNewsByRegion).flat();
  const metrics = computeNewsletterMetrics(finalNewsByRegion);
  console.log(`[Newsletter] Métricas — total=${metrics.totalNews}, alertas=${metrics.high}, fuentes=${metrics.totalSources}, regiones=${metrics.totalRegions}`);
  if (!remaining.length) {
    console.log("[Newsletter] Sin noticias nuevas tras filtro anti-duplicados");
    return { ok: false, reason: "no_fresh_news" };
  }

  const html = buildNewsletterHTML(finalNewsByRegion, financial);
  try {
    fs.writeFileSync(CONFIG.NEWSLETTER_PREVIEW_PATH, html, "utf8");
  } catch (e) {
    console.error("[Preview] No se pudo escribir latest_newsletter_preview.html:", e.message);
  }

  const recipients = getRecipients();
  if (!recipients.length) {
    console.log("[Newsletter] Sin destinatarios configurados");
    return { ok: false, reason: "no_recipients" };
  }

  // ── Envío paralelo: email directo + Beehiiv ──────────────────────────────
  const [emailResult, beehiivResult, driveLink] = await Promise.allSettled([
    // 1. Email directo (nodemailer) a destinatarios manuales
    recipients.length
      ? transporter.sendMail({
          from: `"Agente Político 🌐" <${process.env.EMAIL_FROM}>`,
          to:   recipients.join(", "),
          subject: `🌐 Newsletter Político — ${dateStr}`,
          html,
        })
      : Promise.resolve(null),

    // 2. Beehiiv — publica y manda a todos los suscriptores de la publicación
    sendToBeehiiv(html, dateStr, metrics),

    // 3. Google Drive backup
    saveNewsletterToDrive(html, dateStr),
  ]);

  markLinksAsSent(remaining.map(n => n.link));

  const emailOk     = emailResult.status === "fulfilled";
  const beehiivOk   = beehiivResult.status === "fulfilled" && beehiivResult.value?.ok;
  const beehiivData = beehiivResult.status === "fulfilled" ? beehiivResult.value : {};
  const driveLinkVal = driveLink.status === "fulfilled" ? driveLink.value : null;

  if (emailOk && recipients.length)
    console.log(`[Newsletter] Email directo → ${recipients.join(", ")} ✅`);
  if (beehiivOk)
    console.log(`[Beehiiv] Newsletter publicado ✅ ${beehiivData.postUrl || ""}`);
  if (!emailOk && !beehiivOk)
    return { ok: false, reason: "all_channels_failed" };

  return {
    ok: true,
    email: emailOk,
    beehiiv: beehiivOk,
    beehiivUrl: beehiivData.postUrl || null,
    driveLink: driveLinkVal,
  };
}

// ─── BEEHIIV INTEGRATION ─────────────────────────────────────────────────────
/**
 * Convierte el HTML del newsletter en body_content compatible con Beehiiv.
 * Beehiiv strips <style> blocks pero mantiene style="" inline — nuestro HTML
 * ya usa 100% inline styles, así que funciona directo.
 * Solo extraemos el <body> interior para no mandar el wrapper completo.
 */
function extractBeehiivBody(fullHtml) {
  const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return bodyMatch ? bodyMatch[1].trim() : fullHtml;
}

async function sendToBeehiiv(html, dateStr, metrics) {
  const apiKey = process.env.BEEHIIV_API_KEY;
  const pubId  = process.env.BEEHIIV_PUBLICATION_ID;
  if (!apiKey || !pubId) {
    console.log("[Beehiiv] No configurado (faltan BEEHIIV_API_KEY o BEEHIIV_PUBLICATION_ID)");
    return { ok: false, reason: "not_configured" };
  }

  const nota = getNotaEditorial();
  const subtitle = nota
    ? nota.substring(0, 280)
    : `${metrics.totalNews} noticias · ${metrics.high} alertas · ${metrics.totalRegions} regiones · Sin sesgo editorial`;

  const bodyContent = extractBeehiivBody(html);

  const payload = {
    title: `🌐 Newsletter Político — ${dateStr}`,
    subtitle,
    body_content: bodyContent,
    status: "confirmed",           // published + sends email to subscribers
    email_settings: {
      subject_line: `🌐 Newsletter Político — ${dateStr}`,
      preview_text: subtitle,
      from_name: "Agente Político · Teo Palatini",
    },
    web_settings: {
      slug: `newsletter-${dateStr.replace(/\s/g, "-").toLowerCase()}`,
      hidden: false,
    },
    content_tags: ["política", "economía", "finanzas", "argentina"],
  };

  try {
    console.log("[Beehiiv] Publicando newsletter...");
    const res = await fetch(`https://api.beehiiv.com/v2/publications/${pubId}/posts`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[Beehiiv] Error ${res.status}:`, JSON.stringify(json).slice(0, 300));
      return { ok: false, reason: `http_${res.status}`, detail: json };
    }

    const postId  = json?.data?.id || "unknown";
    const postUrl = json?.data?.web_url || `https://your-pub.beehiiv.com/p/${postId}`;
    console.log(`[Beehiiv] ✅ Publicado — ID: ${postId}`);
    return { ok: true, postId, postUrl };
  } catch (err) {
    console.error("[Beehiiv] Error de red:", err.message);
    return { ok: false, reason: "network_error", detail: err.message };
  }
}

async function getBeehiivStats() {
  const apiKey = process.env.BEEHIIV_API_KEY;
  const pubId  = process.env.BEEHIIV_PUBLICATION_ID;
  if (!apiKey || !pubId) return null;
  try {
    const res = await fetch(`https://api.beehiiv.com/v2/publications/${pubId}`, {
      headers: { "Authorization": `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data || null;
  } catch { return null; }
}

// ─── GOOGLE DRIVE ─────────────────────────────────────────────────────────────
async function saveNewsletterToDrive(html, dateStr) {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!keyPath || !folderId) return null;

  try {
    const { google } = require("googleapis");
    const { Readable } = require("stream");
    const key = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    const auth = new google.auth.GoogleAuth({
      credentials: key,
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });
    const drive = google.drive({ version: "v3", auth: await auth.getClient() });
    const res = await drive.files.create({
      requestBody: {
        name: `Newsletter Político — ${dateStr}`,
        mimeType: "application/vnd.google-apps.document",
        parents: [folderId],
      },
      media: { mimeType: "text/html", body: Readable.from([html]) },
      fields: "id,webViewLink",
    });
    console.log(`[GDrive] Guardado: ${res.data.webViewLink}`);
    return res.data.webViewLink;
  } catch (e) {
    const msg = e.code === "MODULE_NOT_FOUND" && String(e.message).includes("googleapis")
      ? "Instalá dependencias: cd political-agent && npm install (falta el paquete googleapis)"
      : e.message;
    console.error("[GDrive] Error:", msg);
    return null;
  }
}

// ─── BOT ──────────────────────────────────────────────────────────────────────
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);
const COMMAND_HELP = [
  "🌐 *Agente Político*",
  "",
  "*Monitoreo*",
  "• /check — Alertas relevantes ahora",
  "• /all — Panorama global por regiones",
  "• /status — Estado de configuración y cron",
  "",
  "*Mercados*",
  "• /crypto — Top 10 cripto",
  "• /stocks — S&P 500 y ADRs argentinos",
  "",
  "*Newsletter*",
  "• /preview — Vista previa",
  "• /preview_dedup — Preview filtrado por dedup",
  "• /newsletter — Envío manual inmediato",
  "• /quality — Métricas editoriales del último fetch",
  "",
  "*Gestión*",
  "• /addmail /removemail /listmails",
  "• /setnota /nota /clearnota",
  "• /test_email",
].join("\n");

bot.use(async (ctx, next) => {
  if (!isAuthorized(ctx)) return;
  if (ctx.from && isRateLimited(ctx.from.id))
    return ctx.reply("⏳ Espera un momento antes del siguiente comando.");
  return next();
});

bot.command("start", ctx =>
  ctx.reply(COMMAND_HELP, SEND_OPTS)
);
bot.command("help", ctx => ctx.reply(COMMAND_HELP, SEND_OPTS));

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

bot.command("crypto", async ctx => {
  await ctx.reply("💹 Consultando criptomonedas...");
  const crypto = await fetchCryptoTop10();
  if (!crypto.length) return ctx.reply("❌ No se pudo obtener datos de CoinGecko. Intentá más tarde.");
  let msg = "💹 *Top 10 Criptomonedas*\n\n";
  for (const c of crypto) {
    const pct = c.price_change_percentage_7d_in_currency ?? c.price_change_percentage_24h;
    const price = c.current_price?.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 8 });
    msg += `${pctEmoji(pct)} *${escapeMd(c.symbol?.toUpperCase())}* — $${escapeMd(price ?? "–")}\n`;
    msg += `   ${escapeMd(c.name)} · 7d: ${escapeMd(fmtPct(pct))}\n\n`;
  }
  await sendToCtx(ctx, msg);
});

bot.command("stocks", async ctx => {
  await ctx.reply("📈 Consultando mercados...");
  const [sp500, merval] = await Promise.all([fetchSP500Stocks(), fetchMervalStocks()]);

  let msg = "🇺🇸 *Mejores acciones S\\&P 500 hoy*\n\n";
  if (sp500.length) {
    for (const q of sp500) {
      const pct = q.weekChangePercent ?? q.regularMarketChangePercent;
      msg += `${pctEmoji(pct)} *${escapeMd(q.symbol)}* — $${escapeMd(q.regularMarketPrice?.toFixed(2))}\n`;
      msg += `   ${escapeMd(q.shortName || "")} · 7d: ${escapeMd(fmtPct(pct))}\n\n`;
    }
  } else {
    msg += "_Sin datos disponibles_\n\n";
  }

  msg += "🇦🇷 *ADRs Argentinos \\(NYSE\\)*\n\n";
  if (merval.length) {
    for (const q of merval) {
      const pct = q.weekChangePercent ?? q.regularMarketChangePercent;
      const name = MERVAL_NAMES[q.symbol] || q.shortName || q.symbol;
      msg += `${pctEmoji(pct)} *${escapeMd(q.symbol)}* — $${escapeMd(q.regularMarketPrice?.toFixed(2))} USD\n`;
      msg += `   ${escapeMd(name)} · 7d: ${escapeMd(fmtPct(pct))}\n\n`;
    }
  } else {
    msg += "_Sin datos disponibles_\n\n";
  }

  await sendToCtx(ctx, msg);
});

// ─── DESTINATARIOS — comandos ─────────────────────────────────────────────────
bot.command("addmail", async ctx => {
  const email = ctx.message.text.replace(/^\/addmail\s*/i, "").trim().toLowerCase();
  if (!isValidEmail(email))
    return ctx.reply("❌ Email inválido. Uso: /addmail nombre@ejemplo.com");
  const added = addRecipient(email);
  if (!added) return ctx.reply(`⚠️ *${escapeMd(email)}* ya está en la lista.`, SEND_OPTS);
  const total = getRecipients().length;
  await ctx.reply(`✅ *${escapeMd(email)}* agregado.\nAhora el newsletter llega a *${total}* destinatario${total !== 1 ? "s" : ""}.`, SEND_OPTS);
});

bot.command("removemail", async ctx => {
  const email = ctx.message.text.replace(/^\/removemail\s*/i, "").trim().toLowerCase();
  if (!isValidEmail(email))
    return ctx.reply("❌ Email inválido. Uso: /removemail nombre@ejemplo.com");
  const removed = removeRecipient(email);
  if (!removed) return ctx.reply(`⚠️ *${escapeMd(email)}* no estaba en la lista.`, SEND_OPTS);
  await ctx.reply(`🗑️ *${escapeMd(email)}* eliminado de la lista.`, SEND_OPTS);
});

bot.command("listmails", async ctx => {
  const list = getRecipients();
  if (!list.length) return ctx.reply("📭 No hay destinatarios. Usá /addmail para agregar.");
  const items = list.map((e, i) => `${i + 1}. ${escapeMd(e)}`).join("\n");
  await ctx.reply(`📧 *Destinatarios del newsletter* (${list.length}):\n\n${items}`, SEND_OPTS);
});

// ─── NOTA EDITORIAL — comandos ────────────────────────────────────────────────
bot.command("setnota", async ctx => {
  const texto = ctx.message.text.replace(/^\/setnota\s*/i, "").trim();
  if (!texto) return ctx.reply("✏️ Uso: /setnota Tu texto aquí\n\nEjemplo:\n/setnota Esta semana estuvo marcada por la escalada en Medio Oriente y los movimientos del dólar en Argentina.");
  setNotaEditorial(texto);
  await ctx.reply(`✅ *Nota editorial guardada:*\n\n_${escapeMd(texto)}_\n\nAparecerá en el próximo newsletter.`, SEND_OPTS);
});

bot.command("clearnota", async ctx => {
  clearNotaEditorial();
  await ctx.reply("🗑️ Nota editorial borrada. El próximo newsletter saldrá sin nota del editor.");
});

bot.command("nota", async ctx => {
  const nota = getNotaEditorial();
  if (!nota) return ctx.reply("📭 No hay nota editorial activa.\nUsá /setnota <texto> para agregar una.");
  await ctx.reply(`📝 *Nota editorial actual:*\n\n_${escapeMd(nota)}_`, SEND_OPTS);
});

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

bot.command("newsletter", async ctx => {
  await ctx.reply("📧 Generando y enviando newsletter \\(email \\+ Beehiiv\\)\\.\\.\\.", SEND_OPTS);
  try {
    const result = await sendNewsletter();
    if (result.ok) {
      let msg = "✅ *Newsletter enviado*\n\n";
      if (result.email) msg += `📬 Email directo: enviado\n`;
      if (result.beehiiv) {
        msg += `🐝 Beehiiv: publicado y enviado a suscriptores`;
        if (result.beehiivUrl) msg += `\n🔗 [Ver en web](${result.beehiivUrl})`;
      } else {
        msg += `🐝 Beehiiv: no configurado o falló`;
      }
      if (result.driveLink) msg += `\n💾 [Google Drive](${result.driveLink})`;
      await ctx.reply(msg, SEND_OPTS);
    } else if (result.reason === "no_fresh_news") {
      await ctx.reply("ℹ️ No hay noticias nuevas dentro de la ventana anti\\-duplicados\\.", SEND_OPTS);
    } else {
      await ctx.reply("⚠️ No se pudo enviar por ningún canal\\. Verificá EMAIL y BEEHIIV en Fly\\.io secrets\\.", SEND_OPTS);
    }
  } catch (e) {
    console.error("[Newsletter] Error:", e.message);
    await ctx.reply(`❌ Error: ${escapeMd(e.message || "desconocido")}`, SEND_OPTS);
  }
});

bot.command("beehiiv", async ctx => {
  const sub = ctx.message.text.replace(/^\/beehiiv\s*/i, "").trim().toLowerCase();

  // /beehiiv status
  if (!sub || sub === "status") {
    const apiKey = process.env.BEEHIIV_API_KEY;
    const pubId  = process.env.BEEHIIV_PUBLICATION_ID;
    if (!apiKey || !pubId) {
      return ctx.reply(
        "🐝 *Beehiiv — No configurado*\n\n" +
        "Necesitás agregar dos secrets en Fly\\.io:\n" +
        "`fly secrets set BEEHIIV_API_KEY=tu_key`\n" +
        "`fly secrets set BEEHIIV_PUBLICATION_ID=pub_xxx`\n\n" +
        "Encontrás ambos en *beehiiv\\.com → Settings → API*",
        SEND_OPTS
      );
    }
    await ctx.reply("🔍 Verificando conexión con Beehiiv\\.\\.\\.", SEND_OPTS);
    const pub = await getBeehiivStats();
    if (!pub) {
      return ctx.reply("❌ No se pudo conectar con Beehiiv\\. Verificá el API key y Publication ID\\.", SEND_OPTS);
    }
    const subs = pub.stats?.active_subscriptions ?? pub.active_subscriptions ?? "—";
    const name = escapeMd(pub.name || "tu publicación");
    await ctx.reply(
      `🐝 *Beehiiv — Conectado* ✅\n\n` +
      `📰 Publicación: *${name}*\n` +
      `👥 Suscriptores activos: *${subs}*\n` +
      `🆔 Publication ID: \`${escapeMd(pubId)}\`\n\n` +
      `El newsletter llega a Beehiiv automáticamente cada día a las 8 AM\\.`,
      SEND_OPTS
    );
    return;
  }

  // /beehiiv send — fuerza publicación ahora
  if (sub === "send") {
    await ctx.reply("🐝 Publicando en Beehiiv ahora mismo\\.\\.\\.", SEND_OPTS);
    try {
      const result = await sendNewsletter();
      if (result.beehiiv) {
        let msg = `✅ *Publicado en Beehiiv*\n`;
        if (result.beehiivUrl) msg += `🔗 [Ver post](${result.beehiivUrl})`;
        await ctx.reply(msg, SEND_OPTS);
      } else {
        await ctx.reply("⚠️ No se pudo publicar en Beehiiv\\. Revisá los secrets en Fly\\.io\\.", SEND_OPTS);
      }
    } catch (e) {
      await ctx.reply(`❌ Error: ${escapeMd(e.message)}`, SEND_OPTS);
    }
    return;
  }

  await ctx.reply("📖 Uso: `/beehiiv status` o `/beehiiv send`", SEND_OPTS);
});

bot.command("test_email", async ctx => {
  await ctx.reply("🧪 Probando conexión SMTP con Gmail...");
  const result = await verifyEmailTransport();
  if (result.ok) {
    return ctx.reply("✅ SMTP autenticado correctamente. El problema no es la conexión de email.");
  }
  if (result.reason === "email_not_configured") {
    return ctx.reply("⚠️ Email no configurado. Falta EMAIL_FROM, EMAIL_PASS y/o EMAIL_TO en el .env");
  }
  return ctx.reply(`❌ SMTP rechazado por Gmail: ${escapeMd(result.message || "sin detalle")}`, SEND_OPTS);
});

bot.command("preview", async ctx => {
  await ctx.reply("🧪 Generando vista previa del newsletter...");
  try {
    const allNewsByRegion = await collectAllNewsByRegion();
    const html = buildNewsletterHTML(allNewsByRegion);
    fs.writeFileSync(CONFIG.NEWSLETTER_PREVIEW_PATH, html, "utf8");

    await ctx.replyWithDocument(
      { source: fs.createReadStream(CONFIG.NEWSLETTER_PREVIEW_PATH), filename: "newsletter-preview.html" },
      { caption: "Abrí este archivo en tu navegador para ver el diseño completo." }
    );
  } catch (e) {
    console.error("[Preview] Error:", e.message);
    await ctx.reply("❌ No se pudo generar la vista previa.");
  }
});

bot.command("preview_dedup", async ctx => {
  await ctx.reply("🧪 Generando preview con anti-duplicados...");
  try {
    const allNewsByRegion = await collectAllNewsByRegion();
    const finalNewsByRegion = CONFIG.DEDUP_NEWSLETTER_ONLY
      ? applyDedupFilter(allNewsByRegion)
      : allNewsByRegion;

    const remaining = Object.values(finalNewsByRegion).flat();
    if (!remaining.length) {
      return ctx.reply("ℹ️ No hay noticias nuevas según la ventana anti-duplicados.");
    }

    const html = buildNewsletterHTML(finalNewsByRegion);
    fs.writeFileSync(CONFIG.NEWSLETTER_PREVIEW_PATH, html, "utf8");

    await ctx.replyWithDocument(
      { source: fs.createReadStream(CONFIG.NEWSLETTER_PREVIEW_PATH), filename: "newsletter-preview-dedup.html" },
      { caption: "Este preview refleja exactamente lo que saldría en el próximo envío por email." }
    );
  } catch (e) {
    console.error("[PreviewDedup] Error:", e.message);
    await ctx.reply("❌ No se pudo generar el preview con anti-duplicados.");
  }
});

bot.command("status", async ctx => {
  const status = getConfigStatus();
  const cronExpr = getNewsletterCronExpression();
  const lines = [
    "🧭 *Estado del agente*",
    "",
    `• Telegram restringido por chat: ${status.telegramRestricted ? "✅ Sí" : "⚠️ No"}`,
    `• Newsletter por email: ${status.emailEnabled ? "✅ Activo" : "❌ Incompleto"}`,
    `• Destino email: ${escapeMd(status.emailTo || "(sin definir)")}`,
    `• Ventana anti-duplicados: ${status.dedupHours}h`,
    `• Dedup solo newsletter: ${status.dedupNewsletterOnly ? "✅ Sí" : "❌ No"}`,
    `• Max notas por fuente/región: ${CONFIG.MAX_ITEMS_PER_SOURCE_REGION}`,
    `• Programación: \`${cronExpr}\` (${escapeMd(CONFIG.TIMEZONE)})`,
    "",
    "Comandos útiles: /check /all /newsletter /preview /preview_dedup /quality",
  ];

  if (status.issues.length) {
    lines.push("", "*Advertencias:*");
    for (const issue of status.issues) lines.push(`• ${escapeMd(issue)}`);
  }
  await sendToCtx(ctx, lines.join("\n"));
});

bot.command("quality", async ctx => {
  await ctx.reply("📊 Calculando métricas editoriales...");
  const allNewsByRegion = await collectAllNewsByRegion();
  const finalNewsByRegion = CONFIG.DEDUP_NEWSLETTER_ONLY
    ? applyDedupFilter(allNewsByRegion)
    : allNewsByRegion;
  const metrics = computeNewsletterMetrics(finalNewsByRegion);
  const lines = [
    "📊 *Calidad editorial (snapshot)*",
    "",
    `• Noticias: *${metrics.totalNews}*`,
    `• Alertas: *${metrics.high}*`,
    `• Prioridad media: *${metrics.medium}*`,
    `• Prioridad baja: *${metrics.low}*`,
    `• Regiones activas: *${metrics.totalRegions}*`,
    `• Fuentes activas: *${metrics.totalSources}*`,
  ];
  if (metrics.topSources.length) {
    lines.push("", "*Top fuentes:*");
    for (const source of metrics.topSources) lines.push(`• ${escapeMd(source)}`);
  }
  await sendToCtx(ctx, lines.join("\n"));
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
    } catch (e) { console.error("[Monitor] Error:", e.message); }
  }, CONFIG.MONITOR_INTERVAL_MS);
}

// ─── NEWSLETTER DIARIO ────────────────────────────────────────────────────────
function startDailyNewsletter() {
  const expr = getNewsletterCronExpression();
  if (!cron.validate(expr)) {
    console.error(`[Newsletter] Expresión cron inválida: ${expr}`);
    return;
  }
  cron.schedule(expr, async () => {
    console.log(`[Newsletter] Enviando newsletter diario (${CONFIG.NEWSLETTER_HOUR}:${CONFIG.NEWSLETTER_MINUTE})...`);
    try {
      const result = await sendNewsletter();
      if (TELEGRAM_CHAT_ID && result.ok)
        await sendToChat(TELEGRAM_CHAT_ID, "📧 *Newsletter diario enviado a tu email* ✅", SEND_OPTS);
    } catch (e) { console.error("[Newsletter] Error en envío diario:", e.message); }
  }, { timezone: CONFIG.TIMEZONE });

  console.log(`[Newsletter] Programado — todos los días a las ${CONFIG.NEWSLETTER_HOUR}:${CONFIG.NEWSLETTER_MINUTE} (${CONFIG.TIMEZONE})`);
}

// ─── INICIO ───────────────────────────────────────────────────────────────────
startHeartbeat();

// ─── HEALTH CHECK SERVER (requerido por Fly.io para no matar el proceso) ─────
// Sin esto Fly.io manda SIGTERM al proceso porque no detecta actividad.
const http = require("http");
const HEALTH_PORT = Number(process.env.PORT || 8080);
const healthServer = http.createServer((req, res) => {
  const hb = (() => { try { return JSON.parse(fs.readFileSync(CONFIG.HEARTBEAT_PATH, "utf8")); } catch { return null; } })();
  const status = hb?.status || "ok";
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status, uptime: Math.floor(process.uptime()), pid: process.pid }));
});
healthServer.listen(HEALTH_PORT, () => {
  console.log(`[Health] Servidor HTTP escuchando en :${HEALTH_PORT}`);
});

bot.launch().then(async () => {
  console.log("🤖 Bot iniciado correctamente");
  logConfigurationStatus();

  if (TELEGRAM_CHAT_ID) {
    startMonitoring(TELEGRAM_CHAT_ID);
    await bot.telegram.sendMessage(
      TELEGRAM_CHAT_ID,
      "🟢 *Agente iniciado*\nMonitoreo cada 30 min activo\\.\nUsa /check para ver noticias ahora\\.",
      SEND_OPTS
    );
  }

  startDailyNewsletter();

}).catch(e => { console.error("FATAL:", e.message); process.exit(1); });

process.once("SIGINT",  () => { writeHeartbeat("stopping"); bot.stop("SIGINT"); });
process.once("SIGTERM", () => { writeHeartbeat("stopping"); bot.stop("SIGTERM"); });

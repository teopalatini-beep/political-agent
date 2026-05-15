#!/usr/bin/env node
// Standalone newsletter sender for GitHub Actions.
// Extracts and runs the newsletter pipeline without Telegram/bot dependencies.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { Resend } = require("resend");

const ROOT = path.join(__dirname, "..");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const CONFIG = {
  FETCH_TIMEOUT_MS: 8_000,
  MAX_ITEMS_PER_SOURCE: 10,
  MAX_NEWS_PER_REGION: 10,
  DEDUP_WINDOW_HOURS: Number(process.env.DEDUP_WINDOW_HOURS || "48"),
  DEDUP_NEWSLETTER_ONLY: parseBooleanEnv(process.env.DEDUP_NEWSLETTER_ONLY, true),
  MAX_ITEMS_PER_SOURCE_REGION: Number(process.env.MAX_ITEMS_PER_SOURCE_REGION || "3"),
  ALERTS_LIMIT: Number(process.env.ALERTS_LIMIT || "6"),
  SEEN_LINKS_PATH: path.join(ROOT, "seen_links.json"),
  NOTA_EDITORIAL_PATH: path.join(ROOT, "nota_editorial.txt"),
  RECIPIENTS_PATH: path.join(ROOT, "recipients.txt"),
  TIMEZONE: process.env.TZ || "America/Argentina/Buenos_Aires",
};

function parseBooleanEnv(value, defaultValue = false) {
  if (value === undefined) return defaultValue;
  return ["1", "true", "yes", "y", "on"].includes(String(value).trim().toLowerCase());
}

// ─── RSS SOURCES ─────────────────────────────────────────────────────────────
const RSS_SOURCES = {
  usa:       [{ name: "BBC World", url: "https://feeds.bbci.co.uk/news/world/rss.xml" }, { name: "NPR Politics", url: "https://feeds.npr.org/1014/rss.xml" }],
  europe:    [{ name: "Euronews", url: "https://www.euronews.com/rss?level=theme&name=news" }, { name: "DW News", url: "https://rss.dw.com/rdf/rss-en-world" }],
  china:     [{ name: "SCMP", url: "https://www.scmp.com/rss/91/feed" }, { name: "NYT Asia", url: "https://rss.nytimes.com/services/xml/rss/nyt/AsiaPacific.xml" }],
  russia:    [{ name: "Moscow Times", url: "https://www.themoscowtimes.com/rss/news" }],
  mideast:   [{ name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml" }],
  brazil:    [{ name: "Folha", url: "https://feeds.folha.uol.com.br/mundo/rss091.xml" }],
  argentina: [{ name: "La Nación", url: "https://www.lanacion.com.ar/arcio/rss/" }, { name: "Clarín", url: "https://www.clarin.com/rss/lo-ultimo/" }],
};

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
  alta:  ["guerra","war","invasión","golpe","coup","asesinato","crisis","sanción","sanction","nuclear","misil","ataque","attack","impeachment"],
  media: ["presidente","president","ministro","minister","congreso","ley","protesta","protest","cumbre","summit","acuerdo","tratado"],
};

const EMOJIS = { usa:"🇺🇸", europe:"🇪🇺", china:"🇨🇳", russia:"🇷🇺", mideast:"🌍", brazil:"🇧🇷", argentina:"🇦🇷" };
const REGION_NAMES = { usa:"Estados Unidos", europe:"Europa", china:"China", russia:"Rusia", mideast:"Medio Oriente", brazil:"Brasil", argentina:"Argentina" };

const CAT_STYLE = { color: "#0f172a", bg: "#f8fafc", border: "#e2e8f0", accent: "#1e3a5f" };
const CATEGORIES = {
  politica_mundial: { name: "Política Mundial", emoji: "🌐", ...CAT_STYLE, keywords: ["diplomacia","diplomacy","diplomatic","tratado","treaty","cumbre","summit","onu","united nations","nato","otan","guerra","war","warfare","conflicto","conflict","sanción","sanction","alianza","alliance","acuerdo","agreement","presidente","president","premier","chancellor","canciller","minister","elección","election","voto","vote","parlamento","parliament","senado","senate","gobierno","government","congress","política exterior","foreign policy","geopolítica","geopolitics","invasión","invasion","tropas","troops","milicia","militia","cese al fuego","ceasefire","paz","peace","crisis diplomática"] },
  argentina: { name: "Política Argentina", emoji: "🇦🇷", ...CAT_STYLE, keywords: ["argentina","milei","kirchner","peronismo","peronist","buenos aires","casa rosada","diputados","senadores","ypf","vaca muerta","patagonia","córdoba","rosario","mendoza","tucumán","la nación","clarín","infobae","dólar blue","cepo cambiario","fmi argentina","imf argentina","indec","anses","conicet","aerolíneas","pagina 12","ambito financiero","javier milei","sergio massa","cristina","macri","larreta","kicillof"] },
  economia: { name: "Economía", emoji: "💼", ...CAT_STYLE, keywords: ["economía","economy","economic","pbi","gdp","inflación","inflation","precio","price","comercio","trade","banco","bank","reservas","deuda","deficit","impuesto","tax","presupuesto","budget","desempleo","unemployment","salario","wage","mercado","market","consumo","consumption","industria","industry","crecimiento","growth","recesión","recession","pib","gdp","déficit","surplus","exportación","importación","export","import","balanza comercial","trade balance","producto bruto","tariff","arancel"] },
  finanzas: { name: "Finanzas & Mercados", emoji: "💹", ...CAT_STYLE, keywords: ["bolsa","stock","acciones","shares","dólar","dollar","peso","euro","crypto","bitcoin","ethereum","inversión","investment","fondo","fund","bonos","bonds","wall street","nasdaq","s&p 500","merval","banco central","fed","reserva federal","tasa de interés","interest rate","divisa","currency","forex","devaluación","devaluation","swap","financiero","financial","mercado financiero","hedge fund","private equity","ipo","acciones","portfolio","rendimiento","yield","cotización","tipo de cambio"] },
  inversiones: { name: "Inversiones", emoji: "📊", ...CAT_STYLE, keywords: ["inversión","investment","investor","venture capital","startup","unicornio","unicorn","tesla","nvidia","apple","microsoft","amazon","alphabet","meta","openai","semiconductor","chip","commodities","petróleo","oil","gas","oro","gold","plata","silver","cobre","copper","energía","energy","renovable","renewable","real estate","inmueble","propiedad","renta","dividendo","dividend","rentabilidad","retorno","roi","etf","criptoactivo"] },
  deporte: { name: "Deporte", emoji: "⚽", ...CAT_STYLE, keywords: ["fútbol","football","soccer","tenis","tennis","rugby","básquet","basketball","atletismo","athletics","olimpiadas","olympics","mundial","world cup","copa","championship","liga","league","torneo","tournament","jugador","player","equipo","team","gol","goal","partido","match","fifa","uefa","conmebol","nba","nfl","mlb","formula 1","f1","motogp","ciclismo","cycling","natación","swimming","boxeo","boxing","mma","ufc","transferencia","transfer","fichaje"] },
};

const SP500_SAMPLE  = ["NVDA","AAPL","MSFT"];
const MERVAL_SAMPLE = ["GGAL","YPF","MELI"];
const SP500_SET     = new Set(SP500_SAMPLE);
const MERVAL_SET    = new Set(MERVAL_SAMPLE);
const MERVAL_NAMES  = { "GGAL":"Galicia","BMA":"Banco Macro","PAM":"Pampa Energía","LOMA":"Loma Negra","YPF":"YPF","TGS":"Transp. Gas Sur","MELI":"MercadoLibre","GLOB":"Globant","IRS":"IRSA","CAAP":"Aeropuertos Arg." };

// ─── UTILS ───────────────────────────────────────────────────────────────────
function cleanText(text) {
  return String(text).replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&apos;/g, "'").replace(/&#\d+;/g, "").trim();
}
function isValidUrl(str) { try { const u = new URL(str); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; } }
function canonicalizeUrl(str) {
  try {
    const u = new URL(str);
    for (const p of ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","gclid","fbclid","igshid","mc_cid","mc_eid","traffic_source"]) u.searchParams.delete(p);
    u.hash = "";
    if ((u.protocol === "http:" && u.port === "80") || (u.protocol === "https:" && u.port === "443")) u.port = "";
    u.pathname = u.pathname.replace(/\/+$/, "") || "/";
    return u.toString();
  } catch { return String(str || "").trim(); }
}
function isValidEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim()); }

// ─── DEDUP ───────────────────────────────────────────────────────────────────
function loadSeenLinks() {
  try {
    if (!fs.existsSync(CONFIG.SEEN_LINKS_PATH)) return new Map();
    const parsed = JSON.parse(fs.readFileSync(CONFIG.SEEN_LINKS_PATH, "utf8"));
    if (!Array.isArray(parsed)) return new Map();
    return new Map(parsed.filter(([link, ts]) => typeof link === "string" && Number.isFinite(ts)));
  } catch { return new Map(); }
}
const seenLinks = loadSeenLinks();

function pruneSeenLinks() {
  const maxAgeMs = CONFIG.DEDUP_WINDOW_HOURS * 60 * 60 * 1_000;
  const now = Date.now();
  for (const [link, ts] of seenLinks.entries()) { if (now - ts > maxAgeMs) seenLinks.delete(link); }
}
function wasRecentlySent(link) {
  pruneSeenLinks();
  const key = canonicalizeUrl(link);
  const ts = seenLinks.get(key) || seenLinks.get(link);
  if (!ts) return false;
  return Date.now() - ts <= CONFIG.DEDUP_WINDOW_HOURS * 60 * 60 * 1_000;
}
function markLinksAsSent(links) {
  const now = Date.now();
  for (const link of links) { const key = canonicalizeUrl(link); if (key) seenLinks.set(key, now); }
  pruneSeenLinks();
  fs.writeFileSync(CONFIG.SEEN_LINKS_PATH, JSON.stringify([...seenLinks.entries()], null, 2), "utf8");
}

// ─── RECIPIENTS & EDITORIAL ──────────────────────────────────────────────────
function getRecipients() {
  try {
    const fallback = process.env.EMAIL_TO || process.env.EMAIL_FROM || "";
    if (!fs.existsSync(CONFIG.RECIPIENTS_PATH)) return fallback ? [fallback] : [];
    const lines = fs.readFileSync(CONFIG.RECIPIENTS_PATH, "utf8").split("\n").map(l => l.trim()).filter(l => isValidEmail(l));
    return lines.length ? lines : (fallback ? [fallback] : []);
  } catch { return []; }
}
function getNotaEditorial() {
  try { if (!fs.existsSync(CONFIG.NOTA_EDITORIAL_PATH)) return ""; return fs.readFileSync(CONFIG.NOTA_EDITORIAL_PATH, "utf8").trim(); } catch { return ""; }
}

// ─── FETCH HELPERS ───────────────────────────────────────────────────────────
async function fetchJSON(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36", Accept: "application/json", ...headers } });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) { clearTimeout(timer); throw e; }
}

async function fetchRSS(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; NewsBot/1.0)" } });
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
  } catch (e) { console.error(`[RSS] ${url}: ${e.message}`); return []; }
  finally { clearTimeout(timer); }
}

async function fetchSourceWithFallbacks(source) {
  const urls = [source.url, ...(source.fallbackUrls || [])].filter(Boolean);
  for (const url of urls) { const items = await fetchRSS(url); if (items.length) return items; }
  return [];
}

// ─── NEWS PROCESSING ─────────────────────────────────────────────────────────
function getImportance(title, desc) {
  const text = `${title} ${desc}`.toLowerCase();
  if (KEYWORDS.alta.some(k => text.includes(k)))  return { level: "alta",  emoji: "🔴" };
  if (KEYWORDS.media.some(k => text.includes(k))) return { level: "media", emoji: "🟡" };
  return { level: "baja", emoji: "🟢" };
}

function getRelevanceScore(item) {
  const w = { alta: 300, media: 200, baja: 100 }[item.importance.level] || 50;
  const titleLen = Math.min(40, Math.max(0, (item.title || "").trim().length / 4));
  const sourceBonus = /google news/i.test(item.source || "") ? 0 : 20;
  return w + titleLen + sourceBonus;
}

async function getRegionNews(regionId) {
  const sources = RSS_SOURCES[regionId] || [];
  const fetchFromSources = async (sourceList) => {
    const results = await Promise.allSettled(sourceList.map(s => fetchSourceWithFallbacks(s).then(items => items.map(item => ({ ...item, source: s.name, region: regionId, importance: getImportance(item.title, item.description) })))));
    return results.filter(r => r.status === "fulfilled").flatMap(r => r.value);
  };
  let aggregated = await fetchFromSources(sources);
  if (!aggregated.length && (REGION_FALLBACK_SOURCES[regionId] || []).length) {
    console.log(`[RSS] ${regionId}: sin resultados primarios, usando respaldo`);
    aggregated = await fetchFromSources(REGION_FALLBACK_SOURCES[regionId]);
  }
  const seen = new Set();
  const sourceCounter = new Map();
  return aggregated
    .filter(n => { const c = canonicalizeUrl(n.link); if (!c || seen.has(c)) return false; seen.add(c); n.link = c; return true; })
    .sort((a, b) => getRelevanceScore(b) - getRelevanceScore(a))
    .filter(n => { const count = sourceCounter.get(n.source) || 0; if (count >= CONFIG.MAX_ITEMS_PER_SOURCE_REGION) return false; sourceCounter.set(n.source, count + 1); return true; })
    .slice(0, CONFIG.MAX_NEWS_PER_REGION);
}

async function collectAllNewsByRegion() {
  const allNewsByRegion = {};
  await Promise.allSettled(Object.keys(RSS_SOURCES).map(async id => { allNewsByRegion[id] = await getRegionNews(id); }));
  return allNewsByRegion;
}

function applyDedupFilter(newsByRegion) {
  const filtered = {};
  for (const [regionId, list] of Object.entries(newsByRegion)) filtered[regionId] = list.filter(n => !wasRecentlySent(n.link));
  return filtered;
}

// ─── FINANCIAL DATA ──────────────────────────────────────────────────────────
async function fetchCryptoTop10() {
  try {
    const data = await fetchJSON("https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=10&page=1&price_change_percentage=7d");
    return Array.isArray(data) ? data : [];
  } catch (e) { console.error("[Crypto] Error:", e.message); return []; }
}

function yahooTickerToStooq(ticker) { const t = String(ticker).trim(); if (!t) return null; if (/\.BA$/i.test(t)) return t.toLowerCase(); return `${t.replace(/\./g, "-").toLowerCase()}.us`; }

async function fetchStooqChart(ticker) {
  const sym = yahooTickerToStooq(ticker);
  if (!sym) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`https://stooq.com/q/d/l/?s=${encodeURIComponent(sym)}&i=d`, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; PoliticalAgent/1.0)" } });
    if (!res.ok) return null;
    const text = await res.text();
    const lines = text.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 3) return null;
    const rows = [];
    for (let i = 1; i < lines.length; i++) { const close = parseFloat(lines[i].split(",")[4]); if (Number.isFinite(close)) rows.push(close); }
    if (rows.length < 2) return null;
    const cur = rows[rows.length - 1], prev = rows[rows.length - 2], week = rows.length >= 5 ? rows[rows.length - 5] : rows[0];
    return { symbol: ticker, shortName: ticker, regularMarketPrice: cur, regularMarketChangePercent: prev ? ((cur - prev) / prev) * 100 : null, weekChangePercent: week ? ((cur - week) / week) * 100 : null };
  } catch { return null; }
  finally { clearTimeout(timer); }
}

async function fetchYahooChart(ticker) {
  const bases = ["https://query1.finance.yahoo.com/v8/finance/chart", "https://query2.finance.yahoo.com/v8/finance/chart"];
  const params = "?interval=1d&range=5d";
  const headers = { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36", Accept: "application/json", "Accept-Language": "en-US,en;q=0.9", Referer: "https://finance.yahoo.com/", Origin: "https://finance.yahoo.com" };
  for (const base of bases) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CONFIG.FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(`${base}/${encodeURIComponent(ticker)}${params}`, { signal: controller.signal, headers });
      if (!res.ok) continue;
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      if (!result) continue;
      const meta = result.meta, closes = (result.indicators?.quote?.[0]?.close || []).filter(c => c != null);
      const cur = meta.regularMarketPrice, prev = meta.chartPreviousClose || meta.previousClose || closes.at(-2), week = closes.length >= 2 ? closes[0] : null;
      return { symbol: meta.symbol, shortName: meta.shortName || meta.symbol, regularMarketPrice: cur, regularMarketChangePercent: prev ? ((cur - prev) / prev) * 100 : null, weekChangePercent: week ? ((cur - week) / week) * 100 : null };
    } catch {} finally { clearTimeout(timer); }
  }
  const stooq = await fetchStooqChart(ticker);
  if (stooq) console.log(`[Stooq] ${ticker}: datos vía respaldo`);
  return stooq;
}

async function fetchAllStocksOneCall() {
  const apiKey = process.env.TWELVE_DATA_KEY;
  if (!apiKey) { const results = await Promise.allSettled([...SP500_SAMPLE, ...MERVAL_SAMPLE].map(t => fetchYahooChart(t))); const valid = results.filter(r => r.status === "fulfilled" && r.value).map(r => r.value); return { sp500: valid.filter(q => SP500_SET.has(q.symbol)), merval: valid.filter(q => MERVAL_SET.has(q.symbol)) }; }
  const symbols = [...SP500_SAMPLE, ...MERVAL_SAMPLE].join(",");
  try {
    let quoteRaw = await fetchJSON(`https://api.twelvedata.com/quote?symbol=${symbols}&apikey=${apiKey}`);
    if (quoteRaw?.code === 429) { console.warn("[TwelveData] Rate limit — retrying in 62s..."); await new Promise(r => setTimeout(r, 62_000)); quoteRaw = await fetchJSON(`https://api.twelvedata.com/quote?symbol=${symbols}&apikey=${apiKey}`); }
    if (!quoteRaw || quoteRaw.code) { console.error("[TwelveData] Error:", quoteRaw?.message || "no response"); return { sp500: [], merval: [] }; }
    const all = quoteRaw.symbol ? [quoteRaw] : Object.values(quoteRaw);
    const valid = all.filter(q => q && q.close && !q.code && q.status !== "error");
    const toQuote = q => ({ symbol: q.symbol, shortName: q.name || q.symbol, regularMarketPrice: parseFloat(q.close), regularMarketChangePercent: parseFloat(q.percent_change), weekChangePercent: parseFloat(q.percent_change) });
    return {
      sp500: valid.filter(q => SP500_SET.has(q.symbol)).map(toQuote).sort((a, b) => (b.weekChangePercent || 0) - (a.weekChangePercent || 0)),
      merval: valid.filter(q => MERVAL_SET.has(q.symbol)).map(toQuote).sort((a, b) => (b.weekChangePercent || 0) - (a.weekChangePercent || 0)),
    };
  } catch (e) { console.error("[TwelveData] Error:", e.message); return { sp500: [], merval: [] }; }
}

async function fetchAllFinancialData() {
  const [cryptoRes, stocksRes] = await Promise.allSettled([fetchCryptoTop10(), fetchAllStocksOneCall()]);
  const stocks = stocksRes.status === "fulfilled" ? stocksRes.value : { sp500: [], merval: [] };
  return { crypto: cryptoRes.status === "fulfilled" ? cryptoRes.value : [], sp500: stocks.sp500 || [], merval: stocks.merval || [] };
}

// ─── METRICS ─────────────────────────────────────────────────────────────────
function computeNewsletterMetrics(newsByRegion) {
  const flat = Object.values(newsByRegion).flat();
  const sourceCounter = new Map(), regionCounter = new Map();
  for (const item of flat) { sourceCounter.set(item.source, (sourceCounter.get(item.source) || 0) + 1); regionCounter.set(item.region, (regionCounter.get(item.region) || 0) + 1); }
  return { totalNews: flat.length, totalRegions: regionCounter.size, totalSources: sourceCounter.size, high: flat.filter(n => n.importance.level === "alta").length, medium: flat.filter(n => n.importance.level === "media").length, low: flat.filter(n => n.importance.level === "baja").length, topSources: [...sourceCounter.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([s, c]) => `${s} (${c})`) };
}

// ─── CLASSIFY & CATEGORY SECTIONS ────────────────────────────────────────────
function classifyNewsItem(n) {
  const text = `${n.title} ${n.description || ""}`.toLowerCase();
  const scores = {};
  for (const [catId, cat] of Object.entries(CATEGORIES)) scores[catId] = cat.keywords.filter(kw => text.includes(kw)).length;
  const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return best && best[1] > 0 ? best[0] : null;
}

function getNewsEmoji(title, desc = "") {
  const t = `${title} ${desc}`.toLowerCase();
  if (/nuclear|arma nuclear/.test(t)) return "☢️";
  if (/war|guerra|invasion|invasión|ataque|attack|bomb|troops|tropa/.test(t)) return "⚔️";
  if (/sanction|sanción|embargo/.test(t)) return "🚫";
  if (/election|elección|vote|voto/.test(t)) return "🗳️";
  if (/president|presidente/.test(t)) return "🏛️";
  if (/summit|cumbre|treaty|tratado/.test(t)) return "🤝";
  if (/tariff|arancel|trade war/.test(t)) return "🛃";
  if (/economy|economía|inflation|inflación|gdp|pbi|recession/.test(t)) return "💰";
  if (/oil|petróleo|gas |energy|energía/.test(t)) return "⛽";
  if (/climate|clima|environment/.test(t)) return "🌱";
  if (/tech|tecnología|artificial intelligence/.test(t)) return "💻";
  if (/protest|protesta|strike|huelga/.test(t)) return "✊";
  if (/court|tribunal|arrest|sentenced/.test(t)) return "⚖️";
  if (/earthquake|terremoto|flood|hurricane/.test(t)) return "🆘";
  if (/china|beijing|xi jinping/.test(t)) return "🇨🇳";
  if (/russia|rusia|putin|kremlin/.test(t)) return "🇷🇺";
  if (/ukraine|ucrania|zelensky/.test(t)) return "🇺🇦";
  if (/israel|gaza|palestin|hamas/.test(t)) return "🌍";
  if (/trump|biden|white house/.test(t)) return "🇺🇸";
  if (/argentina|milei|buenos aires/.test(t)) return "🇦🇷";
  if (/brazil|brasil|lula/.test(t)) return "🇧🇷";
  return "📰";
}

function getPorQueImporta(title, desc) {
  const text = `${title} ${desc || ""}`.toLowerCase();
  const patterns = [
    [/guerra|ataque|bombardeo|misil|ofensiva|invasion/, "Escala el conflicto armado — puede afectar mercados de energía y cadenas de suministro globales."],
    [/sancion|embargo|bloqueo/, "Las sanciones económicas impactan directamente el comercio y el tipo de cambio."],
    [/eleccion|voto|ballotage|referendum/, "Define el rumbo político del país por los próximos años."],
    [/inflaci|precio|costo de vida|ipc|indec/, "Afecta el poder adquisitivo de millones de personas en tiempo real."],
    [/reservas|banco central|tipo de cambio|dolar|peso/, "Señal directa sobre la estabilidad cambiaria y el acceso a divisas."],
    [/imf|fmi|fondo monetario|deuda|bono|default/, "Condiciona el financiamiento del Estado y la política económica de corto plazo."],
    [/muer|falleci|victim|masacre|atentado/, "Crisis humanitaria activa — seguimiento internacional garantizado."],
    [/trump|biden|milei|lula|xi jinping|putin|zelensky/, "Decisión de liderazgo global con efecto inmediato en relaciones internacionales."],
    [/recesion|crisis economica|quiebra|desempleo/, "Indicador de contracción económica — puede anticipar medidas de emergencia."],
    [/petroleo|gas|energia|litio|commodit/, "Mueve los precios de materias primas estratégicas para Argentina y la región."],
    [/corrupci|juicio|condena|arresto|fiscal/, "Impacto político directo — puede redefinir el equilibrio de poder institucional."],
    [/acuerdo|tratado|alianza|cumbre|g20|g7/, "Nuevo marco geopolítico o comercial con efectos de mediano plazo."],
    [/terremoto|inundaci|incendi|desastre|emergencia/, "Crisis de emergencia activa — requiere respuesta humanitaria inmediata."],
  ];
  for (const [regex, impact] of patterns) { if (regex.test(text)) return impact; }
  if (desc) { const sentences = desc.split(/[.!?]/).map(s => s.trim()).filter(s => s.length > 30); if (sentences.length >= 2) return sentences[1] + "."; }
  return null;
}

function getNumeroDelDia(allNewsByRegion) {
  const flat = Object.values(allNewsByRegion).flat();
  const numRegex = /(\d[\d.,]*\s*(?:%|millones?|billones?|mil millones?|USD|km²?|personas?|muertos?|heridos?|votos?|años?))/i;
  for (const n of flat.filter(x => x.importance.level === "alta")) {
    const text = `${n.title} ${n.description || ""}`;
    const match = text.match(numRegex);
    if (match) {
      const idx = text.indexOf(match[0]);
      const start = Math.max(0, idx - 30), end = Math.min(text.length, idx + match[0].length + 50);
      return { numero: match[0], contexto: text.slice(start, end).trim().replace(/^[^A-Za-z0-9]/, ""), fuente: n.source };
    }
  }
  return null;
}

// ─── HTML BUILDERS ───────────────────────────────────────────────────────────
function buildCategorySections(allNewsByRegion) {
  const flat = Object.values(allNewsByRegion).flat();
  const buckets = {};
  for (const catId of Object.keys(CATEGORIES)) buckets[catId] = [];
  for (const n of flat) { const catId = classifyNewsItem(n); if (catId && buckets[catId].length < 8) buckets[catId].push(n); }
  return Object.entries(CATEGORIES).map(([catId, cat]) => {
    const items = buckets[catId];
    if (!items.length) return "";
    const rows = items.map((n, i) => {
      let desc = (n.description || "").trim();
      if (desc.length > 220) { const cut = desc.lastIndexOf(". ", 220); desc = cut > 60 ? desc.substring(0, cut + 1) : desc.substring(0, 220) + "…"; }
      const isAlert = n.importance.level === "alta";
      const dot = isAlert ? `<span style="display:inline-block;width:6px;height:6px;background:#ef4444;border-radius:50%;margin-right:5px;vertical-align:middle;"></span>` : "";
      const body = desc ? `${dot}<strong style="color:#111827;">${n.title}:</strong> <span style="color:#6b7280;font-size:13px;">${desc}</span>` : `${dot}<strong style="color:#111827;">${n.title}</strong>`;
      const regionTag = `<span style="font-size:10px;background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;border-radius:4px;padding:1px 7px;margin-left:6px;white-space:nowrap;">${EMOJIS[n.region] || ""} ${REGION_NAMES[n.region] || n.region}</span>`;
      return `<tr><td style="padding:11px 0;border-bottom:${i < items.length - 1 ? "1px solid #f1f5f9" : "none"};vertical-align:top;font-size:13.5px;line-height:1.65;">${body}${regionTag}<div style="margin-top:5px;"><a href="${n.link}" style="color:#1e3a5f;text-decoration:none;font-size:12px;font-weight:600;">Leer más →</a><span style="font-size:11px;color:#94a3b8;margin-left:8px;">📰 ${n.source}</span></div></td></tr>`;
    }).join("");
    return `<div id="cat-${catId}" style="background:#fff;border:1px solid #e2e8f0;border-left:3px solid #0f172a;border-radius:8px;margin-bottom:12px;overflow:hidden;"><div style="padding:11px 20px 10px;background:#f8fafc;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;"><span style="font-size:14px;font-weight:700;color:#0f172a;">${cat.emoji}&nbsp; ${cat.name}</span><span style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:0.5px;">${items.length} nota${items.length !== 1 ? "s" : ""}</span></div><div style="padding:0 20px;"><table style="width:100%;border-collapse:collapse;"><tbody>${rows}</tbody></table></div></div>`;
  }).join("");
}

function buildFinancialHTML(financial) {
  const { crypto, sp500, merval } = financial;
  const btc = crypto.find(c => c.symbol === "btc") || crypto[0];
  const topSp = sp500[0], topAdr = merval[0];
  function metricCard(label, symbol, price, pct) {
    const sign = pct >= 0 ? "+" : "", color = pct >= 0 ? "#16a34a" : "#dc2626";
    return `<td style="width:33%;text-align:center;padding:16px 8px;border-right:1px solid #f3f4f6;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.6px;color:#6b7280;margin-bottom:4px;">${label}</div><div style="font-size:13px;font-weight:700;color:#111827;">${symbol}</div><div style="font-size:15px;font-weight:700;color:#111827;margin:2px 0;">$${price}</div><div style="font-size:12px;font-weight:600;color:${color};">${sign}${pct != null ? pct.toFixed(2) : "–"}%</div></td>`;
  }
  const btcPrice = btc ? btc.current_price?.toLocaleString("en-US", { maximumFractionDigits: 0 }) : "–";
  const btcPct = btc ? (btc.price_change_percentage_7d_in_currency ?? btc.price_change_percentage_24h) : null;
  const spPrice = topSp ? topSp.regularMarketPrice?.toFixed(2) : "–";
  const spPct = topSp ? (topSp.weekChangePercent ?? topSp.regularMarketChangePercent) : null;
  const adrPrice = topAdr ? topAdr.regularMarketPrice?.toFixed(2) : "–";
  const adrPct = topAdr ? (topAdr.weekChangePercent ?? topAdr.regularMarketChangePercent) : null;
  const emptyTd = `<td style="width:33%;padding:16px;text-align:center;color:#9ca3af;font-size:12px;border-right:1px solid #f3f4f6;">Sin datos</td>`;
  const overviewHTML = `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px;overflow:hidden;"><div style="padding:12px 20px 10px;border-bottom:1px solid #f3f4f6;"><span style="font-size:15px;font-weight:700;color:#111827;">Market Overview</span></div><table style="width:100%;border-collapse:collapse;"><tr>${btc ? metricCard("Bitcoin", "BTC", btcPrice, btcPct) : emptyTd}${topSp ? metricCard("S&amp;P 500", topSp.symbol, spPrice, spPct) : emptyTd}${topAdr ? metricCard("ADR Arg.", topAdr.symbol, adrPrice, adrPct) : emptyTd.replace("border-right:1px solid #f3f4f6;", "")}</tr></table></div>`;
  const tdBase = `style="font-size:13px;padding:8px 0;border-bottom:1px solid #f9fafb;color:#374151;"`;
  function dataTable(rows) { if (!rows) return `<p style="font-size:12px;color:#9ca3af;margin:8px 0;">Sin datos disponibles</p>`; return `<table style="width:100%;border-collapse:collapse;"><thead><tr><th style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;text-align:left;padding:6px 0;border-bottom:1px solid #e5e7eb;">Activo</th><th style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;text-align:right;padding:6px 0;border-bottom:1px solid #e5e7eb;">Precio</th><th style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#6b7280;text-align:right;padding:6px 0;border-bottom:1px solid #e5e7eb;">7d</th></tr></thead><tbody>${rows}</tbody></table>`; }
  const cryptoRows = crypto.map(c => { const pct = c.price_change_percentage_7d_in_currency ?? c.price_change_percentage_24h; const col = pct >= 0 ? "#16a34a" : "#dc2626"; const sign = pct >= 0 ? "+" : ""; const price = c.current_price?.toLocaleString("en-US", { maximumFractionDigits: 2 }) ?? "–"; return `<tr><td ${tdBase}><b>${c.symbol?.toUpperCase()}</b> <span style="color:#6b7280;font-size:11px;">${c.name}</span></td><td ${tdBase} style="font-size:13px;padding:8px 0;border-bottom:1px solid #f9fafb;text-align:right;">$${price}</td><td ${tdBase} style="font-size:13px;padding:8px 0;border-bottom:1px solid #f9fafb;text-align:right;font-weight:600;color:${col};">${sign}${pct != null ? pct.toFixed(2) : "–"}%</td></tr>`; }).join("");
  const sp500Rows = sp500.map(q => { const pct = q.weekChangePercent ?? q.regularMarketChangePercent; const col = pct >= 0 ? "#16a34a" : "#dc2626"; const sign = pct >= 0 ? "+" : ""; return `<tr><td ${tdBase}><b>${q.symbol}</b> <span style="color:#6b7280;font-size:11px;">${q.shortName || ""}</span></td><td ${tdBase} style="font-size:13px;padding:8px 0;border-bottom:1px solid #f9fafb;text-align:right;">$${q.regularMarketPrice?.toFixed(2) ?? "–"}</td><td ${tdBase} style="font-size:13px;padding:8px 0;border-bottom:1px solid #f9fafb;text-align:right;font-weight:600;color:${col};">${sign}${pct != null ? pct.toFixed(2) : "–"}%</td></tr>`; }).join("");
  const adrRows = merval.map(q => { const pct = q.weekChangePercent ?? q.regularMarketChangePercent; const col = pct >= 0 ? "#16a34a" : "#dc2626"; const sign = pct >= 0 ? "+" : ""; const name = MERVAL_NAMES[q.symbol] || q.shortName || q.symbol; return `<tr><td ${tdBase}><b>${q.symbol}</b> <span style="color:#6b7280;font-size:11px;">${name}</span></td><td ${tdBase} style="font-size:13px;padding:8px 0;border-bottom:1px solid #f9fafb;text-align:right;">$${q.regularMarketPrice?.toFixed(2) ?? "–"}</td><td ${tdBase} style="font-size:13px;padding:8px 0;border-bottom:1px solid #f9fafb;text-align:right;font-weight:600;color:${col};">${sign}${pct != null ? pct.toFixed(2) : "–"}%</td></tr>`; }).join("");
  const card = (title, content) => `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:16px;overflow:hidden;"><div style="padding:12px 20px 10px;border-bottom:1px solid #f3f4f6;"><span style="font-size:15px;font-weight:700;color:#111827;">${title}</span></div><div style="padding:4px 20px 16px;">${content}</div></div>`;
  return overviewHTML + card("Top 10 Criptomonedas <span style='font-size:11px;font-weight:400;color:#9ca3af;'>· var. 7 días</span>", dataTable(cryptoRows)) + card("S&amp;P 500 <span style='font-size:11px;font-weight:400;color:#9ca3af;'>· var. semanal</span>", dataTable(sp500Rows)) + card("ADRs Argentinos (NYSE) <span style='font-size:11px;font-weight:400;color:#9ca3af;'>· var. semanal</span>", dataTable(adrRows));
}

// ─── BUILD NEWSLETTER HTML ───────────────────────────────────────────────────
function buildNewsletterHTML(allNewsByRegion, financial = null) {
  const now = new Date();
  const dateStr = now.toLocaleDateString("es-AR", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: CONFIG.TIMEZONE });
  const dateCapitalized = dateStr.charAt(0).toUpperCase() + dateStr.slice(1);
  const editionNum = Math.floor((now - new Date("2024-01-01")) / 86400000);
  const nota = getNotaEditorial();
  const notaHTML = nota ? `<div style="background:linear-gradient(135deg,#1e3a5f 0%,#1d4ed8 100%);border-radius:10px;padding:22px 24px;margin-bottom:18px;"><div style="font-size:10px;font-weight:700;color:#93c5fd;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">✍️ Del editor</div><p style="font-size:15px;color:#f0f9ff;line-height:1.8;margin:0;font-style:italic;white-space:pre-wrap;">"${nota}"</p><div style="margin-top:12px;font-size:11px;color:#60a5fa;">— Teo Palatini</div></div>` : "";
  const flat = Object.values(allNewsByRegion).flat();
  const alerts = flat.filter(n => n.importance.level === "alta").slice(0, CONFIG.ALERTS_LIMIT);
  const metrics = computeNewsletterMetrics(allNewsByRegion);
  const statsBar = `<div style="display:flex;gap:0;margin-bottom:18px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;"><div style="flex:1;text-align:center;padding:12px 8px;border-right:1px solid #e5e7eb;background:#fff;"><div style="font-size:20px;font-weight:800;color:#111827;">${metrics.totalNews}</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Noticias</div></div><div style="flex:1;text-align:center;padding:12px 8px;border-right:1px solid #e5e7eb;background:#fff;"><div style="font-size:20px;font-weight:800;color:#dc2626;">${metrics.high}</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Alertas</div></div><div style="flex:1;text-align:center;padding:12px 8px;border-right:1px solid #e5e7eb;background:#fff;"><div style="font-size:20px;font-weight:800;color:#059669;">${metrics.totalRegions}</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Regiones</div></div><div style="flex:1;text-align:center;padding:12px 8px;background:#fff;"><div style="font-size:20px;font-weight:800;color:#7c3aed;">${metrics.totalSources}</div><div style="font-size:10px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;margin-top:2px;">Fuentes</div></div></div>`;
  const numeroDia = getNumeroDelDia(allNewsByRegion);
  const numeroDiaHTML = numeroDia ? `<div style="background:#fff;border:1px solid #e2e8f0;border-left:4px solid #1e3a5f;border-radius:8px;padding:14px 18px;margin-bottom:18px;display:flex;align-items:flex-start;gap:14px;"><div style="font-size:28px;line-height:1;">📌</div><div><div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;">El número del día</div><div style="font-size:18px;font-weight:900;color:#1e3a5f;margin-bottom:3px;">${numeroDia.numero}</div><div style="font-size:13px;color:#374151;line-height:1.5;">${numeroDia.contexto}</div><div style="font-size:10px;color:#9ca3af;margin-top:4px;">📰 ${numeroDia.fuente}</div></div></div>` : "";
  const alertCard = alerts.length ? (() => {
    const rows = alerts.map(n => {
      let desc = (n.description || "").trim();
      if (desc.length > 240) { const cut = desc.lastIndexOf(". ", 240); desc = cut > 60 ? desc.substring(0, cut + 1) : desc.substring(0, 240) + "…"; }
      const porQueImporta = getPorQueImporta(n.title, n.description);
      const body = desc ? `<strong style="color:#fff;">${n.title}:</strong> <span style="color:#fca5a5;">${desc}</span>` : `<strong style="color:#fff;">${n.title}</strong>`;
      const porQueHTML = porQueImporta ? `<div style="margin-top:6px;padding:6px 10px;background:rgba(0,0,0,0.2);border-radius:5px;font-size:12px;color:#fef3c7;font-style:italic;line-height:1.5;"><strong style="color:#fbbf24;">Por qué importa:</strong> ${porQueImporta}</div>` : "";
      return `<tr><td style="padding:12px 0;border-bottom:1px solid rgba(255,255,255,0.1);vertical-align:top;font-size:13.5px;line-height:1.65;"><div style="font-size:10px;text-transform:uppercase;letter-spacing:0.5px;color:#fca5a5;margin-bottom:5px;">${EMOJIS[n.region] || ""} ${REGION_NAMES[n.region] || n.region}</div>${body}${porQueHTML}<div style="margin-top:6px;"><a href="${n.link}" style="color:#fbbf24;text-decoration:none;font-size:12px;font-weight:600;">Ver noticia →</a><span style="font-size:11px;color:#f87171;margin-left:8px;">📰 ${n.source}</span></div></td></tr>`;
    }).join("");
    return `<div style="background:linear-gradient(135deg,#7f1d1d 0%,#dc2626 100%);border-radius:10px;margin-bottom:18px;overflow:hidden;"><div style="padding:14px 22px 12px;"><span style="font-size:13px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.5px;">🚨 Alertas del día</span></div><div style="padding:0 22px 4px;"><table style="width:100%;border-collapse:collapse;"><tbody>${rows}</tbody></table></div></div>`;
  })() : "";
  const regionCards = Object.entries(REGION_NAMES).map(([id, name]) => {
    const news = (allNewsByRegion[id] || []).slice(0, 6);
    if (!news.length) return "";
    const items = news.map((n, i) => {
      const emoji = getNewsEmoji(n.title, n.description);
      let desc = (n.description || "").trim();
      if (desc.length > 260) { const cut = desc.lastIndexOf(". ", 260); desc = cut > 60 ? desc.substring(0, cut + 1) : desc.substring(0, 260) + "…"; }
      const importanceDot = n.importance.level === "alta" ? `<span style="display:inline-block;width:7px;height:7px;background:#ef4444;border-radius:50%;margin-right:5px;vertical-align:middle;"></span>` : n.importance.level === "media" ? `<span style="display:inline-block;width:7px;height:7px;background:#f59e0b;border-radius:50%;margin-right:5px;vertical-align:middle;"></span>` : "";
      const body = desc ? `${importanceDot}<strong style="color:#111827;">${n.title}:</strong> <span style="color:#6b7280;">${desc}</span>` : `${importanceDot}<strong style="color:#111827;">${n.title}</strong>`;
      const porQueRegion = n.importance.level === "alta" ? getPorQueImporta(n.title, n.description) : null;
      const porQueRegionHTML = porQueRegion ? `<div style="margin-top:5px;padding:5px 9px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:3px;font-size:11.5px;color:#78350f;font-style:italic;line-height:1.5;"><strong style="color:#d97706;">Por qué importa:</strong> ${porQueRegion}</div>` : "";
      return `<tr><td style="padding:11px 0;border-bottom:${i < news.length - 1 ? "1px solid #f3f4f6" : "none"};vertical-align:top;font-size:13.5px;line-height:1.65;"><span style="font-size:16px;margin-right:5px;">${emoji}</span>${body}${porQueRegionHTML}<div style="margin-top:4px;"><a href="${n.link}" style="color:#2563eb;text-decoration:none;font-size:12px;font-weight:600;">Leer más →</a><span style="font-size:11px;color:#9ca3af;margin-left:8px;">📰 ${n.source}</span></div></td></tr>`;
    }).join("");
    return `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:14px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.04);"><div style="padding:13px 22px 11px;background:linear-gradient(90deg,#f9fafb 0%,#fff 100%);border-bottom:1px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between;"><span style="font-size:15px;font-weight:700;color:#111827;">${EMOJIS[id]} ${name}</span><span style="font-size:11px;color:#9ca3af;">${news.length} nota${news.length !== 1 ? "s" : ""}</span></div><div style="padding:2px 22px 6px;"><table style="width:100%;border-collapse:collapse;"><tbody>${items}</tbody></table></div></div>`;
  }).join("");
  const categorySections = buildCategorySections(allNewsByRegion);
  const catIndex = Object.entries(CATEGORIES).filter(([catId]) => flat.some(n => classifyNewsItem(n) === catId)).map(([catId, cat]) => `<a href="#cat-${catId}" style="display:inline-block;background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:5px 13px;font-size:12px;font-weight:600;color:#1e3a5f;text-decoration:none;white-space:nowrap;">${cat.emoji} ${cat.name}</a>`).join(" ");

  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Agente Político — Newsletter #${editionNum}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<div style="max-width:620px;margin:0 auto;padding:24px 16px 40px;">
  <div style="background:#0f172a;border-radius:14px;padding:34px 30px 28px;margin-bottom:18px;text-align:center;">
    <div style="font-size:10px;color:#475569;text-transform:uppercase;letter-spacing:1.4px;margin-bottom:20px;">${dateCapitalized} &nbsp;·&nbsp; Edición #${editionNum}</div>
    <div style="margin-bottom:14px;"><svg width="48" height="48" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" style="display:inline-block;"><rect width="48" height="48" rx="12" fill="#1e3a5f"/><circle cx="24" cy="24" r="13" fill="none" stroke="white" stroke-width="1.4"/><line x1="24" y1="11" x2="24" y2="37" stroke="white" stroke-width="1.4"/><line x1="11" y1="24" x2="37" y2="24" stroke="white" stroke-width="1.4"/><ellipse cx="24" cy="24" rx="6.5" ry="13" fill="none" stroke="white" stroke-width="1.2"/></svg></div>
    <div style="font-size:28px;font-weight:900;color:#f8fafc;letter-spacing:-0.5px;margin-bottom:5px;">Agente Político</div>
    <div style="font-size:12px;color:#64748b;letter-spacing:0.4px;">Política · Economía · Finanzas · Sin sesgo</div>
    <div style="margin-top:22px;padding-top:18px;border-top:1px solid #1e293b;display:flex;align-items:center;justify-content:center;gap:12px;">
      <div style="width:34px;height:34px;background:#1e3a5f;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:#93c5fd;flex-shrink:0;">T</div>
      <div style="text-align:left;"><div style="font-size:13px;font-weight:700;color:#e2e8f0;">Teo Palatini</div><div style="font-size:10px;color:#64748b;margin-top:1px;">Buenos Aires · UDESA · tpalatini@udesa.edu.ar</div></div>
    </div>
  </div>
  ${notaHTML}${statsBar}
  <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:14px 18px;margin-bottom:18px;"><div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;">En este número</div><div style="display:flex;flex-wrap:wrap;gap:6px;line-height:1;">${catIndex}</div></div>
  ${numeroDiaHTML}${financial ? buildFinancialHTML(financial) : ""}${alertCard}
  <div style="font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-bottom:10px;margin-top:4px;">🗺️ Por región</div>
  ${regionCards}
  <div style="margin:30px 0 20px;text-align:center;"><div style="display:inline-block;background:#0f172a;color:#94a3b8;font-size:9px;font-weight:700;padding:5px 18px;border-radius:20px;letter-spacing:1.2px;text-transform:uppercase;">Por categoría</div></div>
  ${categorySections}
  <div style="margin-top:30px;padding:22px 24px;background:#fff;border-radius:10px;border:1px solid #e2e8f0;text-align:center;"><div style="font-size:13px;font-weight:800;color:#0f172a;margin-bottom:6px;">Agente Político</div><div style="font-size:11px;color:#94a3b8;line-height:2;">Curado por <strong style="color:#1e3a5f;">Teo Palatini</strong> · Buenos Aires · ${now.getFullYear()}<br>BBC · NPR · Euronews · DW · SCMP · Moscow Times · Al Jazeera · Folha · La Nación · Clarín</div></div>
</div></body></html>`;
}

// ─── BEEHIIV ─────────────────────────────────────────────────────────────────
function extractBeehiivBody(fullHtml) {
  const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  return bodyMatch ? bodyMatch[1].trim() : fullHtml;
}

async function sendToBeehiiv(html, dateStr, metrics) {
  const apiKey = process.env.BEEHIIV_API_KEY, pubId = process.env.BEEHIIV_PUBLICATION_ID;
  if (!apiKey || !pubId) { console.log("[Beehiiv] No configurado"); return { ok: false }; }
  const nota = getNotaEditorial();
  const subtitle = nota ? nota.substring(0, 280) : `${metrics.totalNews} noticias · ${metrics.high} alertas · ${metrics.totalRegions} regiones · Sin sesgo editorial`;
  try {
    const res = await fetch(`https://api.beehiiv.com/v2/publications/${pubId}/posts`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ title: `🌐 Newsletter Político — ${dateStr}`, subtitle, body_content: extractBeehiivBody(html), status: "confirmed", email_settings: { subject_line: `🌐 Newsletter Político — ${dateStr}`, preview_text: subtitle, from_name: "Agente Político · Teo Palatini" }, web_settings: { slug: `newsletter-${dateStr.replace(/\s/g, "-").toLowerCase()}`, hidden: false }, content_tags: ["política", "economía", "finanzas", "argentina"] }),
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) { console.error(`[Beehiiv] Error ${res.status}:`, JSON.stringify(json).slice(0, 300)); return { ok: false }; }
    console.log(`[Beehiiv] ✅ Publicado — ID: ${json?.data?.id}`);
    return { ok: true, postId: json?.data?.id, postUrl: json?.data?.web_url };
  } catch (err) { console.error("[Beehiiv] Error:", err.message); return { ok: false }; }
}

// ─── GOOGLE DRIVE ────────────────────────────────────────────────────────────
async function saveNewsletterToDrive(html, dateStr) {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY, folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!keyPath || !folderId) return null;
  try {
    const { google } = require("googleapis");
    const { Readable } = require("stream");
    const key = JSON.parse(fs.readFileSync(keyPath, "utf8"));
    const auth = new google.auth.GoogleAuth({ credentials: key, scopes: ["https://www.googleapis.com/auth/drive.file"] });
    const drive = google.drive({ version: "v3", auth: await auth.getClient() });
    const res = await drive.files.create({
      requestBody: { name: `Newsletter Político — ${dateStr}`, mimeType: "application/vnd.google-apps.document", parents: [folderId] },
      media: { mimeType: "text/html", body: Readable.from([html]) },
      fields: "id,webViewLink",
    });
    console.log(`[GDrive] Guardado: ${res.data.webViewLink}`);
    return res.data.webViewLink;
  } catch (e) { console.error("[GDrive] Error:", e.message); return null; }
}

// ─── TELEGRAM NOTIFICATION ───────────────────────────────────────────────────
async function notifyTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: message, parse_mode: "Markdown", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) { console.error("[Telegram] Notification failed:", e.message); }
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("[Newsletter] Starting standalone send...");

  const resend = getResendClient();
  if (!resend) { console.error("FATAL: RESEND_API_KEY not set"); process.exit(1); }

  const [allNewsByRegion, financial] = await Promise.all([collectAllNewsByRegion(), fetchAllFinancialData()]);

  const now = new Date();
  const dateStr = now.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric", timeZone: CONFIG.TIMEZONE });
  const finalNewsByRegion = CONFIG.DEDUP_NEWSLETTER_ONLY ? applyDedupFilter(allNewsByRegion) : allNewsByRegion;
  const remaining = Object.values(finalNewsByRegion).flat();
  const metrics = computeNewsletterMetrics(finalNewsByRegion);
  console.log(`[Newsletter] Metrics — total=${metrics.totalNews}, alerts=${metrics.high}, sources=${metrics.totalSources}, regions=${metrics.totalRegions}`);

  if (!remaining.length) { console.log("[Newsletter] No fresh news after dedup"); await notifyTelegram("⚠️ Newsletter: sin noticias nuevas hoy (filtro anti-duplicados)"); process.exit(0); }

  const html = buildNewsletterHTML(finalNewsByRegion, financial);

  const recipients = getRecipients();
  if (!recipients.length) { console.error("FATAL: No recipients configured"); process.exit(1); }

  const [emailResult, beehiivResult, driveLink] = await Promise.allSettled([
    resend.emails.send({ from: "Agente Político <onboarding@resend.dev>", to: recipients, subject: `🌐 Newsletter Político — ${dateStr}`, html }),
    sendToBeehiiv(html, dateStr, metrics),
    saveNewsletterToDrive(html, dateStr),
  ]);

  markLinksAsSent(remaining.map(n => n.link));

  const emailOk = emailResult.status === "fulfilled";
  const beehiivOk = beehiivResult.status === "fulfilled" && beehiivResult.value?.ok;
  const driveLinkVal = driveLink.status === "fulfilled" ? driveLink.value : null;

  if (emailOk) console.log(`[Newsletter] Email sent to ${recipients.join(", ")} ✅`);
  else console.error("[Newsletter] Email FAILED:", emailResult.reason?.message || emailResult.reason);

  if (beehiivOk) console.log("[Beehiiv] Published ✅");
  if (driveLinkVal) console.log(`[GDrive] Saved: ${driveLinkVal}`);

  if (!emailOk && !beehiivOk) {
    await notifyTelegram("❌ *Newsletter FALLÓ* — ni email ni Beehiiv funcionaron");
    process.exit(1);
  }

  await notifyTelegram(`📧 *Newsletter enviado* ✅\n📬 ${recipients.length} destinatarios\n📰 ${metrics.totalNews} noticias · ${metrics.high} alertas`);
  console.log("[Newsletter] Done ✅");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });

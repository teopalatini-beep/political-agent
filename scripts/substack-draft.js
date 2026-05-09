#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
require("dotenv").config();

const ROOT = path.resolve(__dirname, "..");
const CONFIG_PATH = path.join(ROOT, "substack.config.json");
const TEMPLATE_PATH = path.join(ROOT, "templates", "substack-draft-template.md");
const SEEN_LINKS_PATH = path.join(ROOT, "seen_links.json");
const OUTPUT_DIR = path.join(ROOT, "drafts", "substack");

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [key, ...rest] = arg.slice(2).split("=");
    parsed[key] = rest.length ? rest.join("=") : "true";
  }
  return parsed;
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function readTemplate() {
  const fallback = [
    "# {{TITLE}}",
    "## {{SUBTITLE}}",
    "",
    "**Formato:** {{FORMAT}}",
    "**Audiencia:** {{AUDIENCE}}",
    "**Tono:** {{TONE}}",
    "**Fecha:** {{DATE}}",
    "",
    "### Apertura",
    "{{OPENING}}",
    "",
    "### Que cambio y por que importa",
    "{{WHY_IT_MATTERS}}",
    "",
    "### Mi lectura",
    "{{ANALYSIS}}",
    "",
    "### Que mirar en las proximas 72 horas",
    "- {{WATCH_1}}",
    "- {{WATCH_2}}",
    "- {{WATCH_3}}",
    "",
    "### Fuentes base",
    "{{SOURCES}}",
    "",
    "### Cierre",
    "{{CLOSING}}",
    "",
    "### CTA",
    "{{CTA}}"
  ].join("\n");

  try {
    if (!fs.existsSync(TEMPLATE_PATH)) return fallback;
    return fs.readFileSync(TEMPLATE_PATH, "utf8");
  } catch {
    return fallback;
  }
}

function slugify(input) {
  return String(input || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

function pickSources(maxSources) {
  const raw = readJson(SEEN_LINKS_PATH, []);
  if (!Array.isArray(raw)) return [];

  const sorted = raw
    .filter(entry => Array.isArray(entry) && typeof entry[0] === "string" && Number.isFinite(entry[1]))
    .sort((a, b) => b[1] - a[1]);

  const seenHost = new Set();
  const links = [];

  for (const [url] of sorted) {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (seenHost.has(host)) continue;
      seenHost.add(host);
      links.push({ host, url });
      if (links.length >= maxSources) break;
    } catch {
      // ignore invalid URL entries
    }
  }

  return links;
}

function render(template, map) {
  return Object.entries(map).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
    template
  );
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = readJson(CONFIG_PATH, {});
  const template = readTemplate();

  const topic = args.topic || "Panorama politico de la semana";
  const angle = args.angle || config.content_pillars?.[0] || "geopolitica";
  const format = args.format || "analisis";
  const tone = args.tone || config.default_tone || "analitico";
  const audience = args.audience || config.default_audience || "lectores de politica";
  const cta = args.cta || config.default_cta || "Suscribite para recibir el proximo analisis.";
  const publicationName = config.publication_name || "Tu publicacion";
  const authorName = config.author_name || "Autor";

  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  const dateStamp = `${yyyy}-${mm}-${dd}`;
  const dateHuman = now.toLocaleDateString("es-AR", { year: "numeric", month: "long", day: "numeric" });

  const title = args.title || `${topic}: la jugada que puede mover la proxima semana`;
  const subtitle = args.subtitle || `Un analisis en clave ${angle} para entender riesgo, oportunidad y escenario base.`;
  const fileSlug = args.slug || slugify(`${dateStamp}-${topic}`);

  const maxSources = Number.isFinite(Number(config.max_sources_in_draft))
    ? Number(config.max_sources_in_draft)
    : 6;
  const sources = pickSources(maxSources);
  const sourcesBlock = sources.length
    ? sources.map((s, idx) => `${idx + 1}. [${s.host}](${s.url})`).join("\n")
    : "- Agregar fuentes verificables antes de publicar.";

  const opening = [
    `Hoy quiero mirar ${topic} sin ruido y con foco en decisiones.`,
    `La pregunta central no es solo que paso, sino que cambia en incentivos y poder.`,
    `Si leemos bien esta semana, podemos anticipar el siguiente movimiento.`
  ].join(" ");

  const whyItMatters = [
    `En clave ${angle}, hay tres fuerzas en juego: narrativa politica, restricciones economicas y timing.`,
    "Cuando esas tres variables se alinean, el costo de reaccionar tarde sube.",
    "Por eso este post propone escenario base, riesgos y gatillos de confirmacion."
  ].join(" ");

  const analysis = [
    "Escenario base: continuidad con volatilidad controlada, sin ruptura inmediata.",
    "Riesgo alcista: acuerdos tacticos que reduzcan incertidumbre en el corto plazo.",
    "Riesgo bajista: eventos de cola politica o financiera que cambien expectativas rapido."
  ].join(" ");

  const closing = [
    `Mi sesgo hoy es prudente: ${topic} todavia admite lecturas opuestas.`,
    "La ventaja competitiva no esta en adivinar titulares, sino en detectar senales temprano.",
    `En ${publicationName} vamos a seguir este tema con criterio y evidencia.`
  ].join(" ");

  const content = render(template, {
    TITLE: title,
    SUBTITLE: subtitle,
    FORMAT: format,
    AUDIENCE: audience,
    TONE: tone,
    DATE: dateHuman,
    OPENING: opening,
    WHY_IT_MATTERS: whyItMatters,
    ANALYSIS: analysis,
    WATCH_1: "Cambio de tono en actores clave (discursos, comunicados, filtraciones).",
    WATCH_2: "Datos macro o de mercado que confirmen o nieguen la tesis base.",
    WATCH_3: "Eventos calendario con capacidad real de alterar expectativas.",
    SOURCES: sourcesBlock,
    CLOSING: closing,
    CTA: cta
  });

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const draftPath = path.join(OUTPUT_DIR, `${fileSlug}.md`);
  fs.writeFileSync(draftPath, content, "utf8");

  const meta = {
    generated_at: now.toISOString(),
    topic,
    angle,
    format,
    tone,
    audience,
    title,
    subtitle,
    author: authorName,
    publication: publicationName,
    draft_path: draftPath,
    sources_count: sources.length
  };

  const metaPath = path.join(OUTPUT_DIR, `${fileSlug}.meta.json`);
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), "utf8");

  console.log("Draft generado:");
  console.log(`- ${draftPath}`);
  console.log(`- ${metaPath}`);
  console.log("");
  console.log("Siguiente paso:");
  console.log("1) Editar el .md");
  console.log("2) Copiar al editor de Substack");
  console.log("3) Programar/publicar");
}

main();

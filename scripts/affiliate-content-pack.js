#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTENT_CONFIG = path.join(ROOT, "affiliate.content.config.json");
const OFFERS_FILE = path.join(ROOT, "affiliate.offers.ranked.json");
const TEMPLATE_FILE = path.join(ROOT, "templates", "affiliate-video-template.md");
const OUTPUT_DIR = path.join(ROOT, "drafts", "affiliate");

function parseArgs(argv) {
  const args = {};
  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const [k, ...rest] = arg.slice(2).split("=");
    args[k] = rest.length ? rest.join("=") : "true";
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function readText(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return fs.readFileSync(filePath, "utf8");
}

function render(template, data) {
  return Object.entries(data).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, String(value)),
    template
  );
}

function dateStamp(baseDate, dayOffset) {
  const d = new Date(baseDate);
  d.setDate(d.getDate() + dayOffset);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function pickByMix(mix, index) {
  const software = "software_ai";
  const fitness = "fitness_weightloss";
  const softwareRatio = Math.max(0, Math.min(1, mix[software] || 0.7));
  const fitnessRatio = Math.max(0, Math.min(1, mix[fitness] || 0.3));
  const total = softwareRatio + fitnessRatio || 1;

  const softwareSlots = Math.max(1, Math.round((softwareRatio / total) * 5));
  const fitnessSlots = Math.max(1, 5 - softwareSlots);
  const pattern = [];

  for (let i = 0; i < softwareSlots; i += 1) pattern.push(software);
  for (let i = 0; i < fitnessSlots; i += 1) pattern.push(fitness);

  return pattern[index % pattern.length];
}

function chooseOffer(offers, niche, index) {
  const filtered = offers.filter((item) => item.niche === niche);
  if (!filtered.length) return null;
  return filtered[index % filtered.length];
}

function buildDraftEntry({ config, offer, niche, index }) {
  const hookBase = config.hooks[index % config.hooks.length]
    .replace("{outcome}", niche === "software_ai" ? "faster workflows" : "better fat-loss consistency")
    .replace("{insight}", niche === "software_ai" ? "tool fit" : "habit design")
    .replace("{painPoint}", niche === "software_ai" ? "content production" : "home training")
    .replace("{outcome}", niche === "software_ai" ? "saving time" : "staying consistent");

  const isSoftware = niche === "software_ai";

  return {
    title: isSoftware
      ? `AI Workflow: ${offer.name}`
      : `Fitness System: ${offer.name}`,
    hook: hookBase,
    problem: isSoftware
      ? "Most creators lose hours switching apps and never ship."
      : "Most people fail because workouts are random and hard to sustain.",
    solution: isSoftware
      ? `Use ${offer.name} as your base system and remove one manual step every day.`
      : `Use ${offer.name} with a simple weekly structure and track only one key metric.`,
    proof: isSoftware
      ? "Show before/after timeline, cleaner process, faster output."
      : "Show adherence framework, easier execution, less decision fatigue.",
    cta: config.ctas[index % config.ctas.length],
    broll1: isSoftware ? "screen capture of workflow" : "home workout setup",
    broll2: isSoftware ? "calendar and task checklist" : "exercise form demo",
    broll3: isSoftware ? "result output examples" : "progress tracking board",
    disclosure: config.brand.defaultDisclosure,
    niche,
    offerName: offer.name,
    network: offer.network || "Amazon",
    trackingUrl: offer.tracking_url || "REPLACE_LINK",
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const days = Number(args.days || 7);
  const template = readText(
    TEMPLATE_FILE,
    "# {{TITLE}}\n\nHook: {{HOOK}}\nProblem: {{PROBLEM}}\nSolution: {{SOLUTION}}\nProof: {{PROOF}}\nCTA: {{CTA}}\nDisclosure: {{DISCLOSURE}}\n"
  );

  const config = readJson(CONTENT_CONFIG);
  const ranked = readJson(OFFERS_FILE);
  const digital = ranked.digital_offers || [];
  const amazon = ranked.amazon_products || [];
  const allOffers = [...digital, ...amazon];

  if (!allOffers.length) {
    throw new Error("No ranked offers found. Run npm run affiliate:score first.");
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const start = new Date();
  const manifest = [];

  for (let i = 0; i < days; i += 1) {
    const niche = pickByMix(config.mix, i);
    const offer = chooseOffer(allOffers, niche, i);
    if (!offer) continue;

    const data = buildDraftEntry({ config, offer, niche, index: i });
    const stamp = dateStamp(start, i);
    const slug = `${stamp}-${niche}-${offer.id}`;
    const filePath = path.join(OUTPUT_DIR, `${slug}.md`);

    const content = render(template, {
      TITLE: data.title,
      HOOK: data.hook,
      PROBLEM: data.problem,
      SOLUTION: data.solution,
      PROOF: data.proof,
      CTA: data.cta,
      BROLL_1: data.broll1,
      BROLL_2: data.broll2,
      BROLL_3: data.broll3,
      DISCLOSURE: data.disclosure,
    });

    fs.writeFileSync(filePath, content, "utf8");
    manifest.push({
      date: stamp,
      niche: data.niche,
      offer: data.offerName,
      network: data.network,
      trackingUrl: data.trackingUrl,
      filePath,
    });
  }

  const manifestPath = path.join(OUTPUT_DIR, "content-manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

  console.log("Affiliate content pack generated:");
  console.log(`- ${manifestPath}`);
  console.log(`- Draft files in: ${OUTPUT_DIR}`);
}

main();

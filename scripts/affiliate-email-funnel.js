#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const TEMPLATE = path.join(ROOT, "templates", "affiliate-email-sequence-template.json");
const LEAD_MAGNET = path.join(ROOT, "templates", "affiliate-lead-magnet-checklist.md");
const OUTPUT_DIR = path.join(ROOT, "drafts", "affiliate");
const OUTPUT_SEQUENCE = path.join(OUTPUT_DIR, "email-sequence.json");
const OUTPUT_LEAD_MAGNET = path.join(OUTPUT_DIR, "lead-magnet.md");

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

function replaceVars(template, values) {
  let output = template;
  for (const [key, value] of Object.entries(values)) {
    output = output.replaceAll(`{{${key}}}`, value);
  }
  return output;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const leadMagnetUrl = args.leadMagnetUrl || "REPLACE_LEAD_MAGNET_URL";
  const primaryOffer = args.primaryOffer || "REPLACE_PRIMARY_OFFER_URL";
  const backupOffer = args.backupOffer || "REPLACE_BACKUP_OFFER_URL";
  const disclosure =
    args.disclosure || "Disclosure: I may earn a commission from qualifying purchases.";

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const template = readJson(TEMPLATE);
  const hydrated = {
    ...template,
    generatedAt: new Date().toISOString(),
    emails: template.emails.map((email) => ({
      ...email,
      body: replaceVars(email.body_template, {
        first_name: "{{ first_name | default: 'there' }}",
        lead_magnet_url: leadMagnetUrl,
        offer_url_primary: primaryOffer,
        offer_url_backup: backupOffer,
        disclosure,
      }),
    })),
  };

  fs.writeFileSync(OUTPUT_SEQUENCE, JSON.stringify(hydrated, null, 2), "utf8");
  fs.copyFileSync(LEAD_MAGNET, OUTPUT_LEAD_MAGNET);

  console.log("Email funnel assets generated:");
  console.log(`- ${OUTPUT_SEQUENCE}`);
  console.log(`- ${OUTPUT_LEAD_MAGNET}`);
}

main();

#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const CONTENT_MANIFEST = path.join(ROOT, "drafts", "affiliate", "content-manifest.json");
const AUTOMATION_CONFIG = path.join(ROOT, "affiliate.automation.config.json");
const OUTPUT_QUEUE = path.join(ROOT, "drafts", "affiliate", "publish-queue.json");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function inferRiskLevel(entry) {
  const text = `${entry.offer} ${entry.niche}`.toLowerCase();
  if (text.includes("weight") || text.includes("fitness")) return "medium";
  return "low";
}

function buildCaption(entry, config) {
  return [
    `${entry.offer} can help if you want a simpler ${entry.niche === "software_ai" ? "workflow" : "fitness routine"}.`,
    config.defaultCaptionBlocks.cta,
    config.defaultCaptionBlocks.disclosure,
  ].join("\n");
}

function postingTimeForDate(dateString, platform) {
  const date = new Date(`${dateString}T00:00:00`);
  const hour = platform === "tiktok" ? 15 : platform === "instagram_reels" ? 13 : 18;
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
}

function main() {
  if (!fs.existsSync(CONTENT_MANIFEST)) {
    throw new Error("Missing content manifest. Run npm run affiliate:content first.");
  }

  const manifest = readJson(CONTENT_MANIFEST);
  const config = readJson(AUTOMATION_CONFIG);
  const platforms = Object.keys(config.platforms).filter((p) => config.platforms[p].enabled);

  const queue = [];
  for (const entry of manifest) {
    const risk = inferRiskLevel(entry);
    for (const platform of platforms) {
      queue.push({
        id: `${entry.date}-${platform}-${entry.offer.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        platform,
        scheduledAt: postingTimeForDate(entry.date, platform),
        status: config.workflow.requireHumanApproval ? "pending_human_review" : "ready_to_publish",
        reviewReason:
          config.workflow.highRiskTopicsRequireApproval && risk !== "low"
            ? "topic_requires_human_review"
            : "default_review_policy",
        riskLevel: risk,
        caption: buildCaption(entry, config),
        sourceDraft: entry.filePath,
        affiliateLink: entry.trackingUrl,
      });
    }
  }

  fs.writeFileSync(OUTPUT_QUEUE, JSON.stringify(queue, null, 2), "utf8");
  console.log("Publish queue generated:");
  console.log(`- ${OUTPUT_QUEUE}`);
  console.log(`- Jobs: ${queue.length}`);
}

main();

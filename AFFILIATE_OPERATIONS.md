# Affiliate Operations Runbook

## 1) Build and rank offer shortlist

```bash
npm run affiliate:score
```

Outputs:
- `affiliate.offers.ranked.json`
- `AFFILIATE_OFFERS_RANKED.md`

## 2) Generate faceless video drafts (weekly pack)

```bash
npm run affiliate:content
```

Outputs:
- `drafts/affiliate/content-manifest.json`
- `drafts/affiliate/*.md` (video script drafts)

## 3) Generate email funnel assets

```bash
npm run affiliate:emails
```

Optional:

```bash
node scripts/affiliate-email-funnel.js --leadMagnetUrl=https://example.com/checklist --primaryOffer=https://example.com/offerA --backupOffer=https://example.com/offerB
```

Outputs:
- `drafts/affiliate/email-sequence.json`
- `drafts/affiliate/lead-magnet.md`

## 4) Build publishing queue (semi-automatic agent mode)

```bash
npm run affiliate:queue
```

Output:
- `drafts/affiliate/publish-queue.json`

Default behavior:
- all jobs are marked `pending_human_review`
- medium-risk topics are explicitly flagged for review

## 5) Track KPI and iterate weekly

```bash
npm run affiliate:kpi
```

Input:
- `affiliate.metrics.sample.csv` (replace with your real weekly export)

Output:
- `AFFILIATE_KPI_SUMMARY.md`

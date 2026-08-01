#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv/config');

const fs = require('fs/promises');
const path = require('path');
const pdfParse = require('pdf-parse');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

const { extractTradesFromPdfText } = require('./sync-house-ptr.js');

const PTR_PDF_URL = (year, docId) => `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${year}/${docId}.pdf`;
const LOG_PATH = path.join(process.cwd(), 'logs', 'reparse-house-ptr-tickers.jsonl');

function getPostgresUrl() {
  const direct =
    process.env.TRADING_STORAGE_POSTGRES_URL ||
    process.env.TRADING_STORAGE_PRISMA_DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL;
  if (!direct) {
    throw new Error('Missing direct Postgres URL. Set TRADING_STORAGE_POSTGRES_URL (or POSTGRES_URL).');
  }
  return direct;
}

async function logResult(entry) {
  await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
  await fs.appendFile(LOG_PATH, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, 'utf8');
}

const FETCH_TIMEOUT_MS = 20_000;

async function fetchAndParse(docId, year) {
  // A plain fetch() has no default timeout and can hang indefinitely on a stalled
  // connection (observed: a run sat stuck on one request for hours) — bound it.
  const res = await fetch(PTR_PDF_URL(year, docId), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const parsed = await pdfParse(buf);
  return extractTradesFromPdfText(docId, parsed.text);
}

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;
  return { dryRun, limit };
}

async function run() {
  const { dryRun, limit } = parseArgs(process.argv.slice(2));
  const adapter = new PrismaPg({ connectionString: getPostgresUrl() });
  const prisma = new PrismaClient({ adapter });

  let affected = await prisma.$queryRaw`
    SELECT DISTINCT d.id, d.doc_id, d.filed_date, d.trade_date
    FROM disclosures d
    JOIN trades t ON t.disclosure_id = d.id
    JOIN members m ON m.bioguide = d.bioguide
    WHERE t.ticker IS NULL AND t.asset_name IS NULL AND m.chamber = 'house' AND d.doc_id ~ '^[0-9]+$'
    ORDER BY d.id
  `;
  if (limit) affected = affected.slice(0, limit);

  console.log(
    `Found ${affected.length} House disclosures with at least one still-unresolved (no ticker, no asset name) trade.${dryRun ? ' (DRY RUN — no writes)' : ''}`
  );

  let updated = 0;
  let unchangedNoImprovement = 0;
  let skippedMismatch = 0;
  let fetchFailed = 0;
  let processed = 0;

  async function processOne(row) {
    const baseYear = row.filed_date
      ? new Date(row.filed_date).getUTCFullYear()
      : row.trade_date
        ? new Date(row.trade_date).getUTCFullYear()
        : null;

    if (!baseYear) {
      skippedMismatch += 1;
      await logResult({ docId: row.doc_id, disclosureId: row.id, outcome: 'skipped_no_year' });
      return;
    }

    let parsedRows = null;
    let usedYear = null;
    for (const year of [baseYear, baseYear + 1, baseYear - 1]) {
      try {
        const rows = await fetchAndParse(row.doc_id, year);
        if (rows.length > 0) {
          parsedRows = rows;
          usedYear = year;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!parsedRows) {
      fetchFailed += 1;
      await logResult({ docId: row.doc_id, disclosureId: row.id, outcome: 'fetch_or_parse_failed' });
      return;
    }

    const existingTrades = await prisma.trades.findMany({
      where: { disclosure_id: row.id },
      orderBy: { id: 'asc' },
    });

    // Order-independent match: pair each parsed row with an unused existing trade on
    // the same (trade_date, amount) — same-day/same-amount entries can extract in a
    // different sequence between the original ingestion and a fresh parse, and a
    // strict positional comparison would wrongly reject an otherwise-clean match.
    // Duplicate (date, amount) pairs are interchangeable with each other by definition,
    // so assignment order among them doesn't matter.
    const usedExistingIds = new Set();
    const matches = [];
    for (const parsed of parsedRows) {
      const candidate = existingTrades.find(
        (existing) =>
          !usedExistingIds.has(existing.id) &&
          existing.trade_date === parsed.tradeDate &&
          existing.amount != null &&
          Math.abs(existing.amount - parsed.amount) < 1
      );
      if (candidate) {
        usedExistingIds.add(candidate.id);
        matches.push({ existing: candidate, parsed });
      }
    }

    // If most rows don't match at all, this is probably a different filing/format
    // entirely (e.g. an old-layout PDF our parser garbles) — too risky to trust.
    const matchRatio = matches.length / Math.max(existingTrades.length, parsedRows.length, 1);
    if (matchRatio < 0.5) {
      skippedMismatch += 1;
      await logResult({
        docId: row.doc_id,
        disclosureId: row.id,
        outcome: 'skipped_low_match_ratio',
        existingCount: existingTrades.length,
        parsedCount: parsedRows.length,
        matched: matches.length,
        year: usedYear,
      });
      return;
    }

    // Only touch matched rows that are currently unresolved — never overwrite a trade
    // that already has a ticker/asset_name from an earlier pass.
    const improvable = matches.filter(
      (m) => (m.parsed.ticker || m.parsed.assetName) && !m.existing.ticker && !m.existing.asset_name
    );

    if (improvable.length === 0) {
      unchangedNoImprovement += 1;
      return;
    }

    if (!dryRun) {
      // Large filings (100+ trades) need more than Prisma's 5s default interactive-
      // transaction timeout to run that many sequential updates — this crashed a run.
      await prisma.$transaction(
        async (tx) => {
          for (const { existing, parsed } of improvable) {
            await tx.trades.update({
              where: { id: existing.id },
              data: { ticker: parsed.ticker, asset_name: parsed.assetName ?? null },
            });
          }
          const firstTicker = matches.find((m) => m.parsed.ticker)?.parsed.ticker;
          if (firstTicker) {
            await tx.disclosures.update({ where: { id: row.id }, data: { ticker: firstTicker } });
          }
        },
        { timeout: 60_000 }
      );
    }

    updated += 1;
    await logResult({
      docId: row.doc_id,
      disclosureId: row.id,
      outcome: dryRun ? 'would_update' : 'updated',
      year: usedYear,
      existingCount: existingTrades.length,
      parsedCount: parsedRows.length,
      matched: matches.length,
      improved: improvable.length,
      sample: improvable.slice(0, 3).map((m) => ({ ticker: m.parsed.ticker, assetName: m.parsed.assetName })),
    });
  }

  for (const row of affected) {
    processed += 1;
    try {
      await processOne(row);
    } catch (error) {
      // A single disclosure's failure (e.g. a transaction timeout on an unusually large
      // filing) must never take down the whole batch — log it and move on.
      fetchFailed += 1;
      await logResult({
        docId: row.doc_id,
        disclosureId: row.id,
        outcome: 'unexpected_error',
        error: String(error?.message ?? error),
      });
    }

    if (processed % 100 === 0) {
      console.log(
        `... ${processed}/${affected.length} processed (updated=${updated}, unchanged=${unchangedNoImprovement}, mismatch=${skippedMismatch}, fetchFailed=${fetchFailed})`
      );
    }

    // Polite pacing so we don't hammer the House Clerk site.
    await new Promise((r) => setTimeout(r, 120));
  }

  console.log(
    `\nDone. total=${affected.length} updated=${updated} unchanged=${unchangedNoImprovement} skippedMismatch=${skippedMismatch} fetchFailed=${fetchFailed}`
  );
  await prisma.$disconnect();
}

run().catch((error) => {
  console.error('Reparse failed:', error);
  process.exit(1);
});

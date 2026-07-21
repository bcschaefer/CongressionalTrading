#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Retries Senate PTR reports that were previously skipped due to db_write_failed
 * or no_parseable_transactions by fetching individual report pages directly.
 * This works even when the /search/report/data/ search endpoint is under maintenance.
 */
require('dotenv/config');

const fs = require('fs/promises');
const path = require('path');

const {
  SENATE_BASE_URL,
  normalizeWhitespace,
  createSenateSession,
  buildMemberIndex,
  resolveBioguideForName,
  extractTransactionsFromReportHtml,
  createPrismaClient,
} = require('./senate-efd-common');

const SKIPPED_LOG_PATH = path.join(process.cwd(), 'logs', 'senate-ptr-skipped.jsonl');

// Retry these skip reasons; ignore paper/member_not_resolved (not fixable)
const RETRYABLE_REASONS = new Set([
  'db_write_failed',
  'no_parseable_transactions',
  'page_existing_lookup_failed',
]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toIsoDate(mmddyyyy) {
  const m = String(mmddyyyy ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const yyyy = Number(m[3]);
  const d = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function summarizeDisclosure(trades, fallbackDate) {
  const sorted = [...trades].sort((a, b) => String(a.tradeDate).localeCompare(String(b.tradeDate)));
  const first = sorted[0];
  const typeSet = new Set(sorted.map((t) => t.tradeType));
  const total = sorted.reduce((sum, t) => sum + (t.amount ?? 0), 0);
  const avg = sorted.length > 0 ? total / sorted.length : 0;
  const rounded = Math.round(avg);

  return {
    ticker: first?.ticker ?? null,
    transactionType: typeSet.size === 1 ? first.tradeType : 'MIXED',
    tradeDate: first?.tradeDate ?? fallbackDate,
    amountRange: `$${rounded.toLocaleString()} - $${rounded.toLocaleString()}`,
  };
}

async function run() {
  // Load skipped log
  let raw;
  try {
    raw = await fs.readFile(SKIPPED_LOG_PATH, 'utf8');
  } catch {
    console.error('No skipped log found at', SKIPPED_LOG_PATH);
    process.exit(1);
  }

  const entries = raw
    .trim()
    .split('\n')
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const retryable = entries.filter((e) => {
    const base = e.reason?.split(':')[0];
    return RETRYABLE_REASONS.has(base) && e.report?.reportId && e.report?.reportPath;
  });

  // Deduplicate by reportId (keep last entry)
  const byId = new Map();
  for (const e of retryable) {
    byId.set(e.report.reportId, e);
  }
  const todo = [...byId.values()];

  console.log(`Skipped log: ${entries.length} total, ${todo.length} unique retryable reports`);

  const prisma = await createPrismaClient();

  // Build existing doc_id set (handle both {uuid} and SENATE-{uuid} formats)
  const existingRaw = await prisma.$queryRaw`SELECT doc_id FROM disclosures WHERE doc_id IS NOT NULL`;
  const existingIds = new Set(existingRaw.map((r) => r.doc_id));

  const members = await prisma.members.findMany({
    select: { bioguide: true, full_name: true },
  });
  const memberIndex = buildMemberIndex(members);

  console.log(`Existing disclosure IDs: ${existingIds.size}, Members: ${members.length}`);
  console.log('Establishing Senate session...');

  const session = await createSenateSession();
  console.log('Session established. Starting retry...');

  let inserted = 0;
  let skippedExists = 0;
  let skippedNoTrades = 0;
  let skippedNoMatch = 0;
  let skippedFetchError = 0;
  let skippedDbError = 0;

  for (let i = 0; i < todo.length; i += 1) {
    const { report } = todo[i];
    const { reportId, reportPath, firstName, lastName, officeText, filedDateIso, filedDateText } = report;

    // Check both id formats
    if (existingIds.has(reportId) || existingIds.has(`SENATE-${reportId}`)) {
      skippedExists += 1;
      continue;
    }

    const bioguide = resolveBioguideForName(firstName, lastName, memberIndex);
    if (!bioguide) {
      skippedNoMatch += 1;
      continue;
    }

    let reportHtml;
    try {
      const reportUrl = `${SENATE_BASE_URL}${reportPath}`;
      const res = await fetch(reportUrl, {
        headers: {
          cookie: Object.entries(session.cookieJar).map(([k, v]) => `${k}=${v}`).join('; '),
          referer: `${SENATE_BASE_URL}/search/`,
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      reportHtml = await res.text();
    } catch (err) {
      skippedFetchError += 1;
      console.warn(`  [${i + 1}/${todo.length}] Fetch failed for ${firstName} ${lastName} (${reportId}): ${err.message}`);
      continue;
    }

    const parsedTrades = extractTransactionsFromReportHtml(reportHtml);
    if (!parsedTrades.length) {
      skippedNoTrades += 1;
      continue;
    }

    const fallbackDate = filedDateIso ?? toIsoDate(filedDateText);
    const summary = summarizeDisclosure(parsedTrades, fallbackDate);

    try {
      await prisma.$transaction(async (tx) => {
        const disclosure = await tx.disclosures.create({
          data: {
            doc_id: reportId,
            bioguide,
            ticker: summary.ticker,
            transaction_type: summary.transactionType,
            trade_date: summary.tradeDate,
            amount_range: summary.amountRange,
            sector: normalizeWhitespace(`${officeText ?? 'Senate'} PTR`) || 'Senate PTR',
          },
          select: { id: true },
        });

        if (parsedTrades.length > 0) {
          await tx.trades.createMany({
            data: parsedTrades.map((trade) => ({
              disclosure_id: disclosure.id,
              ticker: trade.ticker,
              trade_date: trade.tradeDate,
              trade_type: trade.tradeType,
              amount: trade.amount,
            })),
            skipDuplicates: true,
          });
        }
      });

      inserted += 1;
      existingIds.add(reportId); // Prevent re-inserting if it appears again in log

      if ((i + 1) % 25 === 0) {
        console.log(`  [${i + 1}/${todo.length}] inserted=${inserted} skippedExists=${skippedExists} skippedNoTrades=${skippedNoTrades} skippedNoMatch=${skippedNoMatch} fetchErrors=${skippedFetchError}`);
      }
    } catch (err) {
      skippedDbError += 1;
      console.warn(`  [${i + 1}/${todo.length}] DB write failed for ${firstName} ${lastName} (${reportId}): ${err.message}`);
    }

    // Gentle rate limiting
    await sleep(150);
  }

  await prisma.$disconnect();

  console.log('\nRetry complete.');
  console.log(`  inserted=${inserted}`);
  console.log(`  skippedExists=${skippedExists}`);
  console.log(`  skippedNoTrades=${skippedNoTrades}`);
  console.log(`  skippedNoMatch=${skippedNoMatch}`);
  console.log(`  skippedFetchError=${skippedFetchError}`);
  console.log(`  skippedDbError=${skippedDbError}`);
}

run().catch((err) => {
  console.error('retry-senate-ptr-skipped failed:', err);
  process.exit(1);
});

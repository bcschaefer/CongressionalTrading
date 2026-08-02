#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv/config');

const fs = require('fs/promises');
const path = require('path');

const {
  SENATE_BASE_URL,
  createSenateSession,
  extractTransactionsFromReportHtml,
  createPrismaClient,
} = require('./senate-efd-common');

const LOG_PATH = path.join(process.cwd(), 'logs', 'reparse-senate-ptr-tickers.jsonl');

// Node's fetch/undici stack occasionally throws from internal TLS socket teardown
// (`ssl.destroySSL is not a function`) well after a request already completed —
// unrelated to any particular row's outcome. Log and keep going instead of losing
// the whole run to it.
process.on('uncaughtException', (err) => {
  console.error(`Uncaught exception (continuing): ${err?.message ?? err}`);
});

async function logResult(entry) {
  await fs.mkdir(path.dirname(LOG_PATH), { recursive: true });
  await fs.appendFile(LOG_PATH, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`, 'utf8');
}

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  const limitArg = argv.find((a) => a.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : null;
  const afterIdArg = argv.find((a) => a.startsWith('--after-id='));
  const afterId = afterIdArg ? Number(afterIdArg.split('=')[1]) : 0;
  return { dryRun, limit, afterId };
}

function isConnectionError(error) {
  const msg = String(error?.message ?? error ?? '');
  return /connection terminated|connection reset|econnreset|server has gone away/i.test(msg);
}

async function run() {
  const { dryRun, limit, afterId } = parseArgs(process.argv.slice(2));
  // Reassigned on reconnect — a single connection held open for the ~15-30 minutes
  // this script can run for isn't reliable against the remote Postgres proxy, so we
  // detect the drop and get a fresh connection rather than losing the rest of the run.
  let prisma = await createPrismaClient();
  async function reconnect() {
    try {
      await prisma.$disconnect();
    } catch {
      // already dead — nothing to clean up
    }
    prisma = await createPrismaClient();
  }
  const session = await createSenateSession();

  // Plain numeric doc_ids come from a legacy stock-watcher import with no matching
  // eFD report to fetch — exclude them here rather than paying the cost of visiting
  // and logging each one as unsupported. --after-id resumes a run that died partway
  // through (a single connection held open for 15+ minutes against the remote
  // Postgres proxy isn't reliable — it can be dropped mid-run).
  let disclosures = await prisma.$queryRaw`
    SELECT d.id, d.doc_id
    FROM disclosures d
    JOIN members m ON m.bioguide = d.bioguide
    WHERE m.chamber = 'senate' AND d.doc_id !~ '^[0-9]+$' AND d.id > ${afterId}
    ORDER BY d.id
  `;
  if (limit) disclosures = disclosures.slice(0, limit);

  console.log(
    `Found ${disclosures.length} Senate disclosures to reparse.${dryRun ? ' (DRY RUN — no writes)' : ''}`
  );

  let updated = 0;
  let unchangedNoImprovement = 0;
  let skippedMismatch = 0;
  let fetchFailed = 0;
  let processed = 0;

  async function processOne(row) {
    // Most Senate disclosures carry the bare eFD report GUID, but a subset (from an
    // older/different import path) prefix it with "SENATE-", and a further subset are
    // plain numeric IDs from a legacy stock-watcher import with no matching eFD report
    // at all — only the first two forms are fetchable here.
    if (/^[0-9]+$/.test(row.doc_id)) {
      skippedMismatch += 1;
      await logResult({ docId: row.doc_id, disclosureId: row.id, outcome: 'skipped_unsupported_doc_id_format' });
      return;
    }
    const reportId = row.doc_id.startsWith('SENATE-') ? row.doc_id.slice('SENATE-'.length) : row.doc_id;

    let reportHtml;
    try {
      const res = await fetch(`${SENATE_BASE_URL}/search/view/ptr/${reportId}/`, {
        headers: {
          cookie: Object.entries(session.cookieJar).map(([k, v]) => `${k}=${v}`).join('; '),
          referer: `${SENATE_BASE_URL}/search/`,
        },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      reportHtml = await res.text();
    } catch (error) {
      fetchFailed += 1;
      await logResult({ docId: row.doc_id, disclosureId: row.id, outcome: 'fetch_failed', error: String(error?.message ?? error) });
      return;
    }

    const parsedTrades = extractTransactionsFromReportHtml(reportHtml);
    if (parsedTrades.length === 0) {
      fetchFailed += 1;
      await logResult({ docId: row.doc_id, disclosureId: row.id, outcome: 'no_parseable_transactions' });
      return;
    }

    const existingTrades = await prisma.trades.findMany({
      where: { disclosure_id: row.id },
      orderBy: { id: 'asc' },
    });

    // Order-independent match on (trade_date, amount) — same reasoning as the House
    // ticker backfill: same-day/same-amount rows can extract in a different order
    // than the original ingestion did.
    const usedExistingIds = new Set();
    const matches = [];
    for (const parsed of parsedTrades) {
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

    const matchRatio = matches.length / Math.max(existingTrades.length, parsedTrades.length, 1);
    if (matchRatio < 0.5) {
      skippedMismatch += 1;
      await logResult({
        docId: row.doc_id,
        disclosureId: row.id,
        outcome: 'skipped_low_match_ratio',
        existingCount: existingTrades.length,
        parsedCount: parsedTrades.length,
        matched: matches.length,
      });
      return;
    }

    // Unlike the House backfill, the OLD senate ticker extraction was actively wrong
    // (grabbing state abbreviations etc. out of asset descriptions), so the fixed
    // parser's output is authoritative here — overwrite rather than only fill gaps.
    const changed = matches.filter(
      (m) => m.existing.ticker !== m.parsed.ticker || m.existing.asset_name !== (m.parsed.assetName ?? null)
    );

    if (changed.length === 0) {
      unchangedNoImprovement += 1;
      return;
    }

    if (!dryRun) {
      // Plain sequential updates instead of $transaction — each row update is
      // independently safe to apply, and a long-lived interactive transaction per
      // disclosure was implicated in a connection/listener leak on long runs.
      for (const { existing, parsed } of changed) {
        await prisma.trades.update({
          where: { id: existing.id },
          data: { ticker: parsed.ticker, asset_name: parsed.assetName ?? null },
        });
      }
    }

    updated += 1;
    await logResult({
      docId: row.doc_id,
      disclosureId: row.id,
      outcome: dryRun ? 'would_update' : 'updated',
      existingCount: existingTrades.length,
      parsedCount: parsedTrades.length,
      matched: matches.length,
      changed: changed.length,
      sample: changed.slice(0, 3).map((m) => ({
        before: { ticker: m.existing.ticker, assetName: m.existing.asset_name },
        after: { ticker: m.parsed.ticker, assetName: m.parsed.assetName },
      })),
    });
  }

  for (const row of disclosures) {
    processed += 1;
    try {
      await processOne(row);
    } catch (error) {
      if (isConnectionError(error)) {
        await reconnect();
        try {
          await processOne(row);
        } catch (retryError) {
          fetchFailed += 1;
          await logResult({
            docId: row.doc_id,
            disclosureId: row.id,
            outcome: 'unexpected_error_after_reconnect',
            error: String(retryError?.message ?? retryError),
          });
        }
      } else {
        fetchFailed += 1;
        await logResult({
          docId: row.doc_id,
          disclosureId: row.id,
          outcome: 'unexpected_error',
          error: String(error?.message ?? error),
        });
      }
    }

    if (processed % 100 === 0) {
      console.log(
        `... ${processed}/${disclosures.length} processed (updated=${updated}, unchanged=${unchangedNoImprovement}, mismatch=${skippedMismatch}, fetchFailed=${fetchFailed})`
      );
    }

    // Polite pacing so we don't hammer the Senate eFD site.
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(
    `\nDone. total=${disclosures.length} updated=${updated} unchanged=${unchangedNoImprovement} skippedMismatch=${skippedMismatch} fetchFailed=${fetchFailed}`
  );
  await prisma.$disconnect();
}

run().catch((error) => {
  console.error('Reparse failed:', error);
  process.exit(1);
});

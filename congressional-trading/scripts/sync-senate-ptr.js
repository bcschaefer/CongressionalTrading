#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv/config');

const fs = require('fs/promises');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Client: PgClient } = require('pg');
const {
  SenateEfdClient,
  normalizeWhitespace,
  stripTags,
  parseReportRow,
  mmddyyyyToIso,
} = require('./senate-efd-client');

const DEFAULT_START_DATE = '01/01/2012';
const SKIP_LOG_PATH = path.join(process.cwd(), 'logs', 'senate-ptr-skipped.jsonl');
const CHECKPOINT_PATH = path.join(process.cwd(), 'logs', 'senate-ptr-checkpoint.json');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const out = {
    startDate: DEFAULT_START_DATE,
    endDate: null,
    pageSize: 100,
    includeFormer: true,
    resume: true,
    resetCheckpoint: false,
  };

  for (const arg of argv) {
    if (arg.startsWith('--start-date=')) out.startDate = arg.split('=')[1];
    if (arg.startsWith('--end-date=')) out.endDate = arg.split('=')[1];
    if (arg.startsWith('--page-size=')) out.pageSize = Number(arg.split('=')[1]) || out.pageSize;
    if (arg === '--active-only') out.includeFormer = false;
    if (arg === '--no-resume') out.resume = false;
    if (arg === '--reset-checkpoint') out.resetCheckpoint = true;
  }

  if (!out.endDate) {
    const now = new Date();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(now.getUTCDate()).padStart(2, '0');
    const yyyy = now.getUTCFullYear();
    out.endDate = `${mm}/${dd}/${yyyy}`;
  }

  return out;
}

function checkpointSignature(args) {
  return JSON.stringify({
    startDate: args.startDate,
    endDate: args.endDate,
    includeFormer: args.includeFormer,
    reportTypes: [11],
  });
}

async function readCheckpoint() {
  try {
    const raw = await fs.readFile(CHECKPOINT_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeCheckpoint(data) {
  await fs.mkdir(path.dirname(CHECKPOINT_PATH), { recursive: true });
  await fs.writeFile(CHECKPOINT_PATH, JSON.stringify(data, null, 2), 'utf8');
}

async function clearCheckpoint() {
  try {
    await fs.unlink(CHECKPOINT_PATH);
  } catch {
    // ignore missing checkpoint file
  }
}

function normalizeName(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[.,']/g, '')
    .replace(/\b(hon|mr|mrs|ms|dr|jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getPostgresUrl() {
  const direct =
    process.env.TRADING_STORAGE_POSTGRES_URL ||
    process.env.TRADING_STORAGE_PRISMA_DATABASE_URL ||
    process.env.POSTGRES_URL;

  const dbUrl = process.env.DATABASE_URL;

  const base = direct && direct.startsWith('postgres') ? direct : dbUrl;
  if (base && base.startsWith('postgres')) {
    const url = new URL(base);
    // Keep idle TLS connections healthier during long sync jobs.
    if (!url.searchParams.has('keepalives')) url.searchParams.set('keepalives', '1');
    if (!url.searchParams.has('keepalives_idle')) url.searchParams.set('keepalives_idle', '30');
    if (!url.searchParams.has('keepalives_interval')) url.searchParams.set('keepalives_interval', '10');
    if (!url.searchParams.has('keepalives_count')) url.searchParams.set('keepalives_count', '5');
    if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '10');
    return url.toString();
  }

  throw new Error('Missing direct Postgres URL. Set TRADING_STORAGE_POSTGRES_URL (or POSTGRES_URL).');
}

function resolveBioguide(firstName, lastName, members) {
  const full = normalizeName(`${firstName} ${lastName}`);
  const exact = members.find((m) => m.normalized === full);
  if (exact) return exact.bioguide;

  const first = normalizeName(firstName).split(' ')[0] ?? '';
  const last = normalizeName(lastName);
  if (!first || !last) return null;

  const candidates = members.filter((m) => {
    const tokens = m.normalized.split(' ');
    return tokens.includes(last) || m.normalized.endsWith(` ${last}`);
  });

  const tokenMatch = candidates.find((m) => m.normalized.split(' ').includes(first));
  if (tokenMatch) return tokenMatch.bioguide;

  if (candidates.length === 1) return candidates[0].bioguide;
  return null;
}

function parseAmountRange(amountText) {
  const values = String(amountText ?? '')
    .replace(/[$,]/g, '')
    .split(' - ')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v));

  if (values.length === 0) return null;
  if (values.length === 1) return values[0];
  return (values[0] + values[1]) / 2;
}

function mapTradeType(typeText) {
  const t = normalizeWhitespace(typeText).toLowerCase();
  if (t.startsWith('purchase')) return 'PURCHASE';
  if (t.startsWith('sale')) return 'SALE';
  if (t.startsWith('exchange')) return 'EXCHANGE';
  return t.toUpperCase() || 'UNKNOWN';
}

function extractTableRows(tableHtml) {
  const rows = [];
  const trRegex = /<tr>([\s\S]*?)<\/tr>/gi;
  let trMatch = trRegex.exec(tableHtml);
  while (trMatch) {
    const rowHtml = trMatch[1];
    const cells = [];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tdMatch = tdRegex.exec(rowHtml);
    while (tdMatch) {
      cells.push(stripTags(tdMatch[1]));
      tdMatch = tdRegex.exec(rowHtml);
    }
    if (cells.length > 0) rows.push(cells);
    trMatch = trRegex.exec(tableHtml);
  }
  return rows;
}

function parsePtrTransactions(html) {
  const tableMatch = String(html).match(/<table[^>]*class="[^"]*table-striped[^"]*"[^>]*>[\s\S]*?<\/table>/i);
  if (!tableMatch) return [];

  const rows = extractTableRows(tableMatch[0]);
  const transactions = [];

  for (const cells of rows) {
    // Expected columns: #, date, owner, ticker, asset, asset type, type, amount, comment
    if (cells.length < 8) continue;

    const dateIso = mmddyyyyToIso(cells[1]);
    const ticker = normalizeWhitespace(cells[3]) || null;
    const amount = parseAmountRange(cells[7]);
    const tradeType = mapTradeType(cells[6]);

    if (!dateIso || !amount || amount <= 0) continue;
    if (!ticker || ticker === '--') continue;

    transactions.push({
      tradeDate: dateIso,
      ticker,
      amount,
      tradeType,
    });
  }

  return transactions;
}

function isRetryableDbError(error) {
  const msg = String(error?.message ?? '').toLowerCase();
  const code = String(error?.code ?? error?.cause?.code ?? '').toUpperCase();

  if (code === 'ECONNRESET' || code === 'ETIMEDOUT') return true;
  if (msg.includes('connection terminated unexpectedly')) return true;
  if (msg.includes('server closed the connection unexpectedly')) return true;
  if (msg.includes('econnreset') || msg.includes('fetch failed')) return true;
  return false;
}

async function logSkip(reason, report) {
  await fs.mkdir(path.dirname(SKIP_LOG_PATH), { recursive: true });
  await fs.appendFile(
    SKIP_LOG_PATH,
    `${JSON.stringify({ reason, report, at: new Date().toISOString() })}\n`,
    'utf8'
  );
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const pgClient = new PgClient({ connectionString: getPostgresUrl() });
  const adapter = new PrismaPg(pgClient);
  const prisma = new PrismaClient({ adapter });
  const senateClient = new SenateEfdClient();

  await prisma.$connect();

  let discovered = 0;
  let insertedReports = 0;
  let insertedTrades = 0;
  let skippedPaper = 0;
  let skippedNoMatch = 0;
  let skippedNoTrades = 0;
  let skippedFetchErrors = 0;
  let skippedDbErrors = 0;

  try {
    if (args.resetCheckpoint) {
      await clearCheckpoint();
    }

    const withDbRetry = async (label, fn, maxAttempts = 8) => {
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await fn();
        } catch (error) {
          if (!isRetryableDbError(error) || attempt >= maxAttempts) {
            throw error;
          }

          const waitMs = 500 * attempt;
          console.warn(`DB retry for ${label} (attempt ${attempt}/${maxAttempts}) after ${waitMs}ms: ${error.message}`);
          try {
            await prisma.$disconnect();
          } catch {
            // ignore reconnect cleanup failures
          }
          await sleep(waitMs);
          await prisma.$connect();
        }
      }

      throw new Error(`DB retry exhausted for ${label}`);
    };

    await senateClient.authenticate();

    const senateMembers = await withDbRetry('load senate members', () => prisma.members.findMany({
      where: { chamber: 'senate' },
      select: { bioguide: true, full_name: true },
    }));

    const normalizedMembers = senateMembers.map((m) => ({
      bioguide: m.bioguide,
      normalized: normalizeName(m.full_name),
    }));

    let start = 0;
    let draw = 1;
    let total = null;
    const filerTypes = args.includeFormer ? [1, 5] : [1];
    const signature = checkpointSignature(args);

    if (args.resume) {
      const checkpoint = await readCheckpoint();
      if (
        checkpoint &&
        checkpoint.signature === signature &&
        checkpoint.status === 'in-progress' &&
        Number.isInteger(checkpoint.nextStart) &&
        Number.isInteger(checkpoint.nextDraw)
      ) {
        start = checkpoint.nextStart;
        draw = checkpoint.nextDraw;
        discovered = Number(checkpoint.discovered ?? 0);
        insertedReports = Number(checkpoint.insertedReports ?? 0);
        insertedTrades = Number(checkpoint.insertedTrades ?? 0);
        skippedPaper = Number(checkpoint.skippedPaper ?? 0);
        skippedNoMatch = Number(checkpoint.skippedNoMatch ?? 0);
        skippedNoTrades = Number(checkpoint.skippedNoTrades ?? 0);
        skippedFetchErrors = Number(checkpoint.skippedFetchErrors ?? 0);
        skippedDbErrors = Number(checkpoint.skippedDbErrors ?? 0);

        console.log(`Resuming PTR sync from offset ${start} (draw ${draw}).`);
      }
    }

    while (total == null || start < total) {
      const data = await senateClient.fetchReportPage({
        draw,
        start,
        length: args.pageSize,
        filerTypes,
        reportTypes: [11], // Periodic Transaction Reports
        submittedStart: args.startDate,
        submittedEnd: args.endDate,
      });

      const rows = Array.isArray(data.data) ? data.data : [];
      discovered += rows.length;
      total = Number(data.recordsFiltered ?? data.recordsTotal ?? rows.length);

      const pageDocIds = rows
        .map((row) => parseReportRow(row))
        .filter((report) => Boolean(report.reportId))
        .map((report) => `SENATE-${report.reportId}`);

      const uniqueDocIds = [...new Set(pageDocIds)];
      let existingDocIds = new Set();
      if (uniqueDocIds.length > 0) {
        try {
          const existing = await withDbRetry('load existing disclosure doc ids', () =>
            prisma.disclosures.findMany({
              where: { doc_id: { in: uniqueDocIds } },
              select: { doc_id: true },
            })
          );
          existingDocIds = new Set(existing.map((r) => r.doc_id).filter(Boolean));
        } catch (error) {
          // Continue with per-row safety checks if page-level lookup fails.
          await logSkip('page_existing_lookup_failed', {
            draw,
            start,
            error: String(error?.message ?? error),
          });
        }
      }

      for (const row of rows) {
        const report = parseReportRow(row);
        if (!report.reportId || !report.reportPath) continue;

        const bioguide = resolveBioguide(report.firstName, report.lastName, normalizedMembers);
        if (!bioguide) {
          skippedNoMatch += 1;
          await logSkip('member_not_resolved', report);
          continue;
        }

        if (report.reportKind !== 'ptr') {
          skippedPaper += 1;
          await logSkip('paper_report_not_supported_yet', report);
          continue;
        }

        const docId = `SENATE-${report.reportId}`;
        if (existingDocIds.has(docId)) {
          continue;
        }

        let reportHtml;
        try {
          reportHtml = await senateClient.fetchReportHtml(report.reportPath);
        } catch (error) {
          skippedFetchErrors += 1;
          await logSkip('report_fetch_failed', {
            ...report,
            error: String(error?.message ?? error),
            errorCode: error?.code ?? error?.cause?.code ?? null,
          });
          continue;
        }

        const transactions = parsePtrTransactions(reportHtml);

        if (transactions.length === 0) {
          skippedNoTrades += 1;
          await logSkip('no_parseable_transactions', report);
          continue;
        }

        const firstTx = transactions[0];
        try {
          const disclosure = await withDbRetry('create senate disclosure', () =>
            prisma.disclosures.create({
              data: {
                doc_id: docId,
                bioguide,
                ticker: firstTx.ticker,
                transaction_type: firstTx.tradeType,
                trade_date: firstTx.tradeDate,
                amount_range: null,
                sector: 'senate_ptr',
              },
              select: { id: true },
            })
          );

          if (transactions.length > 0) {
            await withDbRetry('create senate trades', () =>
              prisma.trades.createMany({
                data: transactions.map((tx) => ({
                  disclosure_id: disclosure.id,
                  ticker: tx.ticker,
                  trade_date: tx.tradeDate,
                  trade_type: tx.tradeType,
                  amount: tx.amount,
                })),
              })
            );
          }
        } catch (error) {
          skippedDbErrors += 1;
          await logSkip('db_write_failed', {
            ...report,
            error: String(error?.message ?? error),
            errorCode: error?.code ?? error?.cause?.code ?? null,
          });
          continue;
        }

        insertedReports += 1;
        insertedTrades += transactions.length;
        existingDocIds.add(docId);
      }

      start += rows.length;
      draw += 1;

      await writeCheckpoint({
        status: 'in-progress',
        updatedAt: new Date().toISOString(),
        signature,
        args: {
          startDate: args.startDate,
          endDate: args.endDate,
          includeFormer: args.includeFormer,
        },
        nextStart: start,
        nextDraw: draw,
        total,
        discovered,
        insertedReports,
        insertedTrades,
        skippedPaper,
        skippedNoMatch,
        skippedNoTrades,
        skippedFetchErrors,
        skippedDbErrors,
      });

      if (rows.length === 0) break;

      console.log(`PTR page processed: ${Math.min(start, total)} / ${total}`);
    }

    await clearCheckpoint();

    console.log(
      `Senate PTR sync complete. discovered=${discovered}, reports=${insertedReports}, trades=${insertedTrades}, skipped_paper=${skippedPaper}, skipped_no_match=${skippedNoMatch}, skipped_no_trades=${skippedNoTrades}, skipped_fetch_errors=${skippedFetchErrors}, skipped_db_errors=${skippedDbErrors}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error('Senate PTR sync failed:', error);
  process.exit(1);
});

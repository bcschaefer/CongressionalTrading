#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv/config');

const fs = require('fs/promises');
const path = require('path');

const {
  SENATE_BASE_URL,
  normalizeWhitespace,
  isLikelyPtrTitle,
  parseReportRow,
  createSenateSession,
  fetchAllReportRows,
  buildMemberIndex,
  resolveBioguideForName,
  extractTransactionsFromReportHtml,
  createPrismaClient,
} = require('./senate-efd-common');

const CHECKPOINT_PATH = path.join(process.cwd(), 'logs', 'senate-ptr-checkpoint.json');
const SKIPPED_LOG_PATH = path.join(process.cwd(), 'logs', 'senate-ptr-skipped.jsonl');

function parseArgs(argv) {
  const defaults = {
    startDate: '01/01/2012',
    endDate: new Date().toISOString().slice(0, 10),
    pageSize: 100,
    resume: true,
  };

  const mmddyyyy = (isoDate) => {
    const [yyyy, mm, dd] = isoDate.split('-');
    return `${mm}/${dd}/${yyyy}`;
  };
  defaults.endDate = mmddyyyy(defaults.endDate);

  for (const arg of argv) {
    if (arg.startsWith('--start-date=')) {
      defaults.startDate = arg.split('=')[1];
    } else if (arg.startsWith('--end-date=')) {
      defaults.endDate = arg.split('=')[1];
    } else if (arg.startsWith('--page-size=')) {
      const n = Number(arg.split('=')[1]);
      if (Number.isFinite(n) && n > 0) defaults.pageSize = n;
    } else if (arg === '--no-resume') {
      defaults.resume = false;
    }
  }

  return defaults;
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

async function appendSkipped(reason, report) {
  await fs.mkdir(path.dirname(SKIPPED_LOG_PATH), { recursive: true });
  await fs.appendFile(
    SKIPPED_LOG_PATH,
    `${JSON.stringify({ reason, report, at: new Date().toISOString() })}\n`,
    'utf8'
  );
}

function checkpointSignature(args) {
  return JSON.stringify({
    startDate: args.startDate,
    endDate: args.endDate,
    reportTypes: [11],
    filerTypes: [4],
  });
}

async function readCheckpoint(expectedSignature) {
  try {
    const raw = await fs.readFile(CHECKPOINT_PATH, 'utf8');
    const checkpoint = JSON.parse(raw);
    if (checkpoint.signature !== expectedSignature) return null;
    return checkpoint;
  } catch {
    return null;
  }
}

async function writeCheckpoint(payload) {
  await fs.mkdir(path.dirname(CHECKPOINT_PATH), { recursive: true });
  await fs.writeFile(CHECKPOINT_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const signature = checkpointSignature(args);

  const prisma = await createPrismaClient();

  try {
    console.log(`Starting Senate PTR sync (${args.startDate} -> ${args.endDate})...`);

    const session = await createSenateSession();

    const rows = await fetchAllReportRows(session, {
      startDate: args.startDate,
      endDate: args.endDate,
      pageSize: args.pageSize,
      filerTypes: [4],
      reportTypes: [11],
    });

    const parsedReports = rows
      .map((r) => parseReportRow(r))
      .filter((r) => r.reportId && r.reportPath && r.reportTitle)
      .filter((r) => isLikelyPtrTitle(r.reportTitle))
      .filter((r) => r.officeText && /senator/i.test(r.officeText));

    const dedupedReports = [];
    const seen = new Set();
    for (const report of parsedReports) {
      if (seen.has(report.reportId)) continue;
      seen.add(report.reportId);
      dedupedReports.push(report);
    }

    const checkpoint = args.resume ? await readCheckpoint(signature) : null;
    const startIndex = checkpoint?.nextStart ?? 0;

    const members = await prisma.members.findMany({
      select: { bioguide: true, full_name: true },
    });
    const memberIndex = buildMemberIndex(members);

    let insertedReports = checkpoint?.insertedReports ?? 0;
    let insertedTrades = checkpoint?.insertedTrades ?? 0;
    let skippedPaper = checkpoint?.skippedPaper ?? 0;
    let skippedNoMatch = checkpoint?.skippedNoMatch ?? 0;
    let skippedNoTrades = checkpoint?.skippedNoTrades ?? 0;
    let skippedFetchErrors = checkpoint?.skippedFetchErrors ?? 0;
    let skippedDbErrors = checkpoint?.skippedDbErrors ?? 0;

    for (let i = startIndex; i < dedupedReports.length; i += 1) {
      const report = dedupedReports[i];

      if (report.reportKind === 'paper') {
        skippedPaper += 1;
        await appendSkipped('paper_report_not_supported_yet', report);
        continue;
      }

      const exists = await prisma.disclosures.findFirst({
        where: { doc_id: report.reportId },
        select: { id: true },
      });
      if (exists) continue;

      const bioguide = resolveBioguideForName(report.firstName, report.lastName, memberIndex);
      if (!bioguide) {
        skippedNoMatch += 1;
        await appendSkipped('member_not_resolved', report);
        continue;
      }

      let reportHtml;
      try {
        const reportUrl = `${SENATE_BASE_URL}${report.reportPath}`;
        const res = await fetch(reportUrl, {
          headers: {
            cookie: Object.entries(session.cookieJar).map(([k, v]) => `${k}=${v}`).join('; '),
            referer: `${SENATE_BASE_URL}/search/`,
          },
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        reportHtml = await res.text();
      } catch (error) {
        skippedFetchErrors += 1;
        await appendSkipped(`report_fetch_failed:${error.message}`, report);
        continue;
      }

      const parsedTrades = extractTransactionsFromReportHtml(reportHtml);
      if (!parsedTrades.length) {
        skippedNoTrades += 1;
        await appendSkipped('no_parseable_transactions', report);
        continue;
      }

      const summary = summarizeDisclosure(parsedTrades, report.filedDateIso ?? toIsoDate(report.filedDateText));

      try {
        await prisma.$transaction(async (tx) => {
          const disclosure = await tx.disclosures.create({
            data: {
              doc_id: report.reportId,
              bioguide,
              ticker: summary.ticker,
              transaction_type: summary.transactionType,
              trade_date: summary.tradeDate,
              amount_range: summary.amountRange,
              sector: normalizeWhitespace(`${report.officeText ?? 'Senate'} PTR`) || 'Senate PTR',
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

        insertedReports += 1;
        insertedTrades += parsedTrades.length;
      } catch (error) {
        skippedDbErrors += 1;
        await appendSkipped(`db_write_failed:${error.message}`, report);
      }

      if ((i + 1) % 25 === 0) {
        await writeCheckpoint({
          status: 'in-progress',
          updatedAt: new Date().toISOString(),
          signature,
          args,
          nextStart: i + 1,
          total: dedupedReports.length,
          discovered: i + 1,
          insertedReports,
          insertedTrades,
          skippedPaper,
          skippedNoMatch,
          skippedNoTrades,
          skippedFetchErrors,
          skippedDbErrors,
        });
      }
    }

    await writeCheckpoint({
      status: 'done',
      updatedAt: new Date().toISOString(),
      signature,
      args,
      nextStart: dedupedReports.length,
      total: dedupedReports.length,
      discovered: dedupedReports.length,
      insertedReports,
      insertedTrades,
      skippedPaper,
      skippedNoMatch,
      skippedNoTrades,
      skippedFetchErrors,
      skippedDbErrors,
    });

    console.log(
      `Senate PTR sync finished. discovered=${dedupedReports.length}, insertedReports=${insertedReports}, insertedTrades=${insertedTrades}, skippedPaper=${skippedPaper}, skippedNoMatch=${skippedNoMatch}, skippedNoTrades=${skippedNoTrades}, skippedFetchErrors=${skippedFetchErrors}, skippedDbErrors=${skippedDbErrors}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error('Senate PTR sync failed:', error);
  process.exit(1);
});

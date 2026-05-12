#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Backfill net worth values for existing annual_financial_disclosures rows.
 *
 * Usage:
 *   node scripts/backfill-net-worth.js [--bioguide=B001...] [--year=2023] [--limit=50] [--dry-run]
 *
 * Without flags, processes all rows where net_worth_parsed_at IS NULL,
 * in batches with a short delay between requests to avoid hammering the PDF server.
 */

require('dotenv/config');

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const pdfParseModule = require('pdf-parse/lib/pdf-parse.js');
const parsePdf = pdfParseModule.default ?? pdfParseModule;

// ---------- arg parsing ----------
function parseArgs(argv) {
  const args = {};
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--bioguide=')) args.bioguide = arg.split('=')[1];
    else if (arg.startsWith('--year=')) args.year = Number(arg.split('=')[1]);
    else if (arg.startsWith('--limit=')) args.limit = Number(arg.split('=')[1]);
    else if (arg.startsWith('--concurrency=')) args.concurrency = Number(arg.split('=')[1]);
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--reset-zero') args.resetZero = true;
  }
  return args;
}

// ---------- PDF helpers ----------
async function extractTextFromPdf(pdfUrl) {
  const response = await fetch(pdfUrl, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`PDF unavailable: ${response.status} ${pdfUrl}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const result = await parsePdf(buffer);
  return result?.text ?? '';
}

function parseFullRange(str) {
  const m = str.match(/\$([\d,]+)\s*-\s*\$([\d,]+)/);
  if (!m) return null;
  const low = Number(m[1].replace(/,/g, ''));
  const high = Number(m[2].replace(/,/g, ''));
  return { low, high, mid: (low + high) / 2 };
}

function parseRangeStart(str) {
  const m = str.match(/\$([\d,]+)\s*-\s*$/);
  if (!m) return null;
  return Number(m[1].replace(/,/g, ''));
}

function parseRangeEnd(str, low) {
  const m = str.match(/^\$([\d,]+)/);
  if (!m) return null;
  const high = Number(m[1].replace(/,/g, ''));
  return { low, high, mid: (low + high) / 2 };
}

function parsePdfSummary(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  const assets = [];
  const liabilities = [];

  let sec = 'none';
  let pendingAsset = null;
  let pendingLow = null;
  let pendingLiabLow = null;

  const emitAsset = (v) => {
    assets.push({ valueMid: v.mid });
    pendingAsset = null;
    pendingLow = null;
  };

  for (const line of lines) {
    if (line.includes('Value of Asset') && line.includes('Owner')) { sec = 'a'; pendingAsset = null; pendingLow = null; continue; }
    if (line.includes('Creditor') && line.includes('Date Incurred')) { sec = 'd'; pendingLiabLow = null; continue; }
    if (line.startsWith('https://') || line.startsWith('* Asset')) continue;
    if (/^--\s*\d+\s*of\s*\d+\s*--$/.test(line)) continue;

    if (sec === 'a') {
      const typeMatch = line.match(/\[([A-Z]{2,4})\]/);
      if (typeMatch) {
        pendingAsset = null; pendingLow = null;
        const name = line.split('[')[0].replace(/\t/g, ' ').trim();
        const full = parseFullRange(line);
        if (full) {
          emitAsset(full);
        } else {
          const low = parseRangeStart(line);
          pendingAsset = { name };
          if (low !== null) pendingLow = low;
        }
      } else if (pendingAsset) {
        if (pendingLow !== null) {
          const completed = parseRangeEnd(line, pendingLow);
          if (completed) emitAsset(completed);
        } else {
          const full = parseFullRange(line);
          if (full) {
            emitAsset(full);
          } else {
            const low = parseRangeStart(line);
            if (low !== null) pendingLow = low;
          }
        }
      }
    }

    if (sec === 'd') {
      if (pendingLiabLow !== null) {
        const m = line.match(/^\$([\d,]+)/);
        if (m) {
          const high = Number(m[1].replace(/,/g, ''));
          liabilities.push({ valueMid: (pendingLiabLow + high) / 2 });
          pendingLiabLow = null;
          continue;
        }
      }
      const ownerMatch = line.match(/^(JT|SP|DC|Self)\b/);
      if (ownerMatch) {
        const full = parseFullRange(line);
        if (full) {
          liabilities.push({ valueMid: full.mid });
        } else {
          const low = parseRangeStart(line);
          if (low !== null) pendingLiabLow = low;
        }
      }
    }
  }

  return {
    totalAssets: assets.reduce((s, a) => s + a.valueMid, 0),
    totalLiabilities: liabilities.reduce((s, l) => s + l.valueMid, 0),
  };
}

async function parseNetWorthForRow(row) {
  // Senate EFD rows use a viewer URL, not a PDF — skip them
  if (row.doc_id && row.doc_id.startsWith('SENATE-')) return null;

  const sourceIsPdf =
    !!row.source_url &&
    /^https?:\/\//i.test(row.source_url) &&
    /\.pdf(?:\?|#|$)/i.test(row.source_url);

  const pdfUrl = sourceIsPdf
    ? row.source_url
    : `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${row.filing_year}/${row.doc_id}.pdf`;

  const text = await extractTextFromPdf(pdfUrl);
  const { totalAssets, totalLiabilities } = parsePdfSummary(text);

  if (totalAssets === 0 && totalLiabilities === 0) return null;
  return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
}

// ---------- main ----------
function getPostgresUrl() {
  const direct =
    process.env.TRADING_STORAGE_POSTGRES_URL ||
    process.env.TRADING_STORAGE_PRISMA_DATABASE_URL ||
    process.env.POSTGRES_URL;
  if (direct && direct.startsWith('postgres')) return direct;
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.startsWith('postgres')) return dbUrl;
  throw new Error('Missing Postgres URL. Set TRADING_STORAGE_POSTGRES_URL (or POSTGRES_URL).');
}

async function run() {
  const args = parseArgs(process.argv);
  const connectionString = getPostgresUrl();
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    // With --reset-zero: re-process House rows cached as zero (net_worth=0)
    if (args.resetZero) {
      console.log('[reset-zero] Resetting net_worth_parsed_at for House rows with net_worth=0...');
      const { Pool } = require('pg');
      const pool = new Pool({ connectionString });
      const result = await pool.query(
        `UPDATE annual_financial_disclosures
         SET net_worth_parsed_at = NULL
         WHERE net_worth = 0
           AND net_worth_parsed_at IS NOT NULL
           AND doc_id NOT LIKE 'SENATE-%'`
      );
      console.log(`  Reset ${result.rowCount} rows.`);
      await pool.end();
    }

    const where = {
      net_worth_parsed_at: null,
      NOT: { doc_id: { startsWith: 'SENATE-' } },
      ...(args.bioguide ? { bioguide: args.bioguide } : {}),
      ...(args.year ? { filing_year: args.year } : {}),
    };

    const rows = await prisma.annual_financial_disclosures.findMany({
      where,
      orderBy: [{ filing_year: 'desc' }],
      take: args.limit ?? undefined,
      select: { doc_id: true, filing_year: true, source_url: true, bioguide: true },
    });

    console.log(`Found ${rows.length} unparsed disclosure rows.`);
    if (args.dryRun) {
      console.log('[dry-run] Would process:', rows.map((r) => `${r.doc_id} (${r.filing_year})`).join(', '));
      return;
    }

    let succeeded = 0;
    let failed = 0;
    let skipped = 0;
    const CONCURRENCY = args.concurrency ?? 8;

    // Process in batches of CONCURRENCY
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(async (row) => {
          try {
            const parsed = await parseNetWorthForRow(row);
            if (!parsed) {
              // Still mark as parsed so we don't retry endlessly
              await prisma.annual_financial_disclosures.update({
                where: { doc_id: row.doc_id },
                data: { total_assets: 0, total_liabilities: 0, net_worth: 0, net_worth_parsed_at: new Date() },
              });
              process.stdout.write(`  [skip] ${row.doc_id} (${row.filing_year})\n`);
              skipped++;
              return;
            }

            await prisma.annual_financial_disclosures.update({
              where: { doc_id: row.doc_id },
              data: {
                total_assets: parsed.totalAssets,
                total_liabilities: parsed.totalLiabilities,
                net_worth: parsed.netWorth,
                net_worth_parsed_at: new Date(),
              },
            });
            process.stdout.write(
              `  [ok] ${row.doc_id} (${row.filing_year}) net=$${Math.round(parsed.netWorth / 1000)}k\n`
            );
            succeeded++;
          } catch (err) {
            process.stdout.write(`  [err] ${row.doc_id} (${row.filing_year}): ${err.message}\n`);
            failed++;
          }
        })
      );

      // Brief pause between batches to avoid overloading the PDF server
      if (i + CONCURRENCY < rows.length) {
        await new Promise((r) => setTimeout(r, 200));
      }

      const done = Math.min(i + CONCURRENCY, rows.length);
      process.stdout.write(`  ... ${done}/${rows.length} processed (ok=${succeeded} skip=${skipped} err=${failed})\n`);
    }

    console.log(`\nDone. succeeded=${succeeded} skipped=${skipped} failed=${failed}`);
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});

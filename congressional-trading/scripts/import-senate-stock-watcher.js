#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Imports Senate PTR data from the senate-stock-watcher-data GitHub repository
 * (timothycarambat/senate-stock-watcher-data) which covers 2012-2020.
 *
 * Source: https://github.com/timothycarambat/senate-stock-watcher-data
 * Data: aggregate/all_transactions.csv
 *
 * Usage:
 *   node scripts/import-senate-stock-watcher.js [--dry-run]
 */
require('dotenv/config');

const https = require('https');

const {
  normalizeWhitespace,
  buildMemberIndex,
  resolveBioguideForName,
  createPrismaClient,
  parseAmountRange,
} = require('./senate-efd-common');

const CSV_URL =
  'https://raw.githubusercontent.com/timothycarambat/senate-stock-watcher-data/master/aggregate/all_transactions.csv';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchUrl(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

/**
 * Very small CSV parser that handles quoted fields.
 */
function parseCsv(text) {
  const lines = text.split('\n').filter((l) => l.trim());
  const headers = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const fields = [];
    let inQuote = false;
    let cur = '';
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') {
        inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) {
        fields.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    fields.push(cur.trim());
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = fields[idx] ?? '';
    });
    rows.push(row);
  }
  return rows;
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

const NAME_SUFFIXES = new Set(['jr.', 'jr', 'sr.', 'sr', 'ii', 'iii', 'iv', '2nd', '3rd']);

/**
 * Parse "FirstName [Middle] LastName [Suffix]" → { firstName, lastName }
 * Strips trailing suffixes (Jr., Sr., II, etc.) before splitting.
 * If first token is an initial (e.g. "A."), uses the second token as first name.
 */
function parseSenatorName(fullName) {
  // Remove trailing commas and strip known suffixes
  let name = fullName.trim().replace(/,\s*(jr\.?|sr\.?|ii|iii|iv)\s*$/i, '').trim();
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: parts[0] };
  // If last token is a suffix (shouldn't happen after strip, but be safe)
  if (NAME_SUFFIXES.has(parts[parts.length - 1].toLowerCase())) {
    parts.pop();
  }
  if (parts.length === 0) return { firstName: '', lastName: '' };
  const lastName = parts[parts.length - 1];
  // If first token is an initial (e.g. "A."), use second token as effective first name
  let firstName;
  if (parts.length >= 3 && /^[A-Z]\.?$/i.test(parts[0])) {
    firstName = parts.slice(1, parts.length - 1).join(' ');
  } else {
    firstName = parts.slice(0, parts.length - 1).join(' ');
  }
  return { firstName, lastName };
}

/**
 * Normalize trade type from CSV to a consistent format.
 */
function normalizeTradeType(csvType) {
  const t = String(csvType ?? '').toLowerCase().trim();
  if (t.includes('purchase')) return 'purchase';
  if (t.includes('sale')) return 'sale';
  if (t.includes('exchange')) return 'exchange';
  return csvType || null;
}

function summarizeGroup(trades) {
  const sorted = [...trades].sort((a, b) =>
    String(a.tradeDate).localeCompare(String(b.tradeDate))
  );
  const first = sorted[0];
  const typeSet = new Set(sorted.map((t) => t.tradeType));
  const amounts = sorted.map((t) => t.amount ?? 0);
  const avg = amounts.length > 0 ? amounts.reduce((s, v) => s + v, 0) / amounts.length : 0;
  const rounded = Math.round(avg);

  return {
    ticker: first?.ticker && first.ticker !== '--' ? first.ticker : null,
    transactionType: typeSet.size === 1 ? first.tradeType : 'MIXED',
    tradeDate: first?.tradeDate ?? null,
    amountRange: `$${rounded.toLocaleString()} - $${rounded.toLocaleString()}`,
  };
}

async function run() {
  console.log(`Fetching Senate PTR CSV from GitHub${DRY_RUN ? ' (DRY RUN)' : ''}...`);
  const csvText = await fetchUrl(CSV_URL);
  const rows = parseCsv(csvText);
  console.log(`Parsed ${rows.length} CSV rows`);

  // Group rows by ptr_link (each unique link = one PTR report)
  const reportMap = new Map(); // uuid → { senatorName, ptrLink, trades[] }
  for (const row of rows) {
    const ptrLink = row.ptr_link ?? '';
    const uuidMatch = ptrLink.match(/\/ptr\/([a-f0-9-]{36})\/?$/i);
    if (!uuidMatch) continue;
    const uuid = uuidMatch[1].toLowerCase();

    if (!reportMap.has(uuid)) {
      reportMap.set(uuid, { senatorName: row.senator, ptrLink, trades: [] });
    }

    const ticker = row.ticker && row.ticker !== '--' ? row.ticker : null;
    const tradeDate = toIsoDate(row.transaction_date);
    const tradeType = normalizeTradeType(row.type);
    const parsed = parseAmountRange(row.amount);

    reportMap.get(uuid).trades.push({
      ticker,
      tradeDate,
      tradeType,
      amount: parsed?.amount ?? null,
      owner: row.owner || null,
    });
  }

  console.log(`Found ${reportMap.size} unique PTR reports`);

  const prisma = await createPrismaClient();

  // Load all Senate members for name→bioguide resolution
  const members = await prisma.members.findMany({
    where: { chamber: 'senate' },
    select: { bioguide: true, full_name: true },
  });
  console.log(`Loaded ${members.length} Senate members`);
  const memberIndex = buildMemberIndex(members);

  // Load existing doc_ids to skip duplicates
  const existing = await prisma.disclosures.findMany({
    where: { members: { chamber: 'senate' }, doc_id: { not: null } },
    select: { doc_id: true },
  });
  const existingIds = new Set(existing.map((d) => d.doc_id));
  console.log(`Found ${existingIds.size} existing Senate disclosure doc_ids`);

  let inserted = 0;
  let skippedExists = 0;
  let skippedNoMatch = 0;
  let skippedNoTrades = 0;
  let dbErrors = 0;

  const uuids = [...reportMap.keys()];
  for (let i = 0; i < uuids.length; i++) {
    const uuid = uuids[i];
    const report = reportMap.get(uuid);

    // Skip if already in DB (check both plain UUID and SENATE-{uuid} formats)
    if (existingIds.has(uuid) || existingIds.has(`SENATE-${uuid}`)) {
      skippedExists += 1;
      continue;
    }

    if (!report.trades.length) {
      skippedNoTrades += 1;
      continue;
    }

    // Resolve bioguide from senator name
    const { firstName, lastName } = parseSenatorName(report.senatorName);
    const bioguide = resolveBioguideForName(firstName, lastName, memberIndex);
    if (!bioguide) {
      skippedNoMatch += 1;
      if (skippedNoMatch <= 10) {
        console.warn(`  No bioguide match for: "${report.senatorName}" (first="${firstName}" last="${lastName}")`);
      }
      continue;
    }

    const summary = summarizeGroup(report.trades);

    if (DRY_RUN) {
      inserted += 1;
      continue;
    }

    try {
      await prisma.$transaction(async (tx) => {
        const disclosure = await tx.disclosures.create({
          data: {
            doc_id: uuid,
            bioguide,
            ticker: summary.ticker,
            transaction_type: summary.transactionType,
            trade_date: summary.tradeDate,
            amount_range: summary.amountRange,
            sector: normalizeWhitespace('Senate PTR'),
          },
          select: { id: true },
        });

        await tx.trades.createMany({
          data: report.trades.map((t) => ({
            disclosure_id: disclosure.id,
            ticker: t.ticker,
            trade_date: t.tradeDate,
            trade_type: t.tradeType,
            amount: t.amount,
          })),
          skipDuplicates: true,
        });
      });

      inserted += 1;
      existingIds.add(uuid);
    } catch (err) {
      dbErrors += 1;
      console.error(`  DB error for ${uuid}: ${err.message}`);
    }

    if ((i + 1) % 100 === 0 || i === uuids.length - 1) {
      console.log(
        `  [${i + 1}/${uuids.length}] inserted=${inserted} skippedExists=${skippedExists} skippedNoMatch=${skippedNoMatch} skippedNoTrades=${skippedNoTrades} dbErrors=${dbErrors}`
      );
    }
  }

  await prisma.$disconnect();

  console.log('\nDone.');
  console.log(`  inserted=${inserted}`);
  console.log(`  skippedExists=${skippedExists}`);
  console.log(`  skippedNoMatch=${skippedNoMatch}`);
  console.log(`  skippedNoTrades=${skippedNoTrades}`);
  console.log(`  dbErrors=${dbErrors}`);
}

run().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});

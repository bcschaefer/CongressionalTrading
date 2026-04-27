#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv/config');

const fs = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');
const { PDFParse } = require('pdf-parse');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Client: PgClient } = require('pg');

const FINANCIAL_DISCLOSURE_PAGE = 'https://disclosures-clerk.house.gov/PublicDisclosure/FinancialDisclosure';
const FINANCIAL_ZIP_URL = (year) => `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.zip`;
const PTR_PDF_URL = (year, docId) => `https://disclosures-clerk.house.gov/public_disc/ptr-pdfs/${year}/${docId}.pdf`;
const FAILED_DOC_LOG_PATH = path.join(process.cwd(), 'logs', 'ptr-failed-docs.jsonl');

function parseArgs(argv) {
  const years = new Set();
  let allYears = false;

  for (const arg of argv) {
    if (arg === '--all-years') {
      allYears = true;
      continue;
    }

    if (arg.startsWith('--year=')) {
      const year = Number(arg.split('=')[1]);
      if (Number.isInteger(year)) years.add(year);
      continue;
    }

    const numeric = Number(arg);
    if (Number.isInteger(numeric) && String(numeric).length === 4) {
      years.add(numeric);
    }
  }

  return { allYears, years: [...years].sort((a, b) => a - b) };
}

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeName(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[.,']/g, '')
    .replace(/\b(hon|mr|mrs|ms|dr|jr|sr|ii|iii|iv)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatDistrict(stateDst) {
  const clean = normalizeWhitespace(stateDst).toUpperCase();
  const m = clean.match(/^([A-Z]{2})(\d{1,2})$/);
  if (!m) return clean || null;
  return `${m[1]}-${Number(m[2])}`;
}

function parseMoney(value) {
  return Number(String(value).replace(/[$,]/g, ''));
}

function toIsoDate(mmddyyyy) {
  const parts = String(mmddyyyy).split('/').map((v) => Number(v));
  if (parts.length !== 3) return null;
  const [mm, dd, yyyy] = parts;
  if (!mm || !dd || !yyyy) return null;
  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function discoverYearsFromPage(html) {
  const regex = /\/public_disc\/financial-pdfs\/(\d{4})FD\.zip/gi;
  const years = new Set();
  let match = regex.exec(html);
  while (match) {
    years.add(Number(match[1]));
    match = regex.exec(html);
  }
  return [...years].sort((a, b) => a - b);
}

async function fetchAllAvailableYears() {
  const res = await fetch(FINANCIAL_DISCLOSURE_PAGE);
  if (res.ok) {
    const html = await res.text();
    const years = discoverYearsFromPage(html);
    if (years.length > 0) {
      return years;
    }
  }

  // Fallback when site markup changes: probe known yearly zip URLs.
  const availableYears = [];
  const currentYear = new Date().getUTCFullYear();
  for (let year = 2008; year <= currentYear; year += 1) {
    try {
      const zipRes = await fetch(FINANCIAL_ZIP_URL(year), { method: 'HEAD' });
      if (zipRes.ok) {
        availableYears.push(year);
      }
    } catch {
      // Skip transient year probe failures.
    }
  }

  if (availableYears.length === 0) {
    throw new Error('No disclosure years discovered via index or yearly URL probing.');
  }

  return availableYears;
}

function collectMemberNodes(node, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectMemberNodes(item, out);
    return;
  }

  if (!node || typeof node !== 'object') return;

  if (node.Member) {
    if (Array.isArray(node.Member)) out.push(...node.Member);
    else out.push(node.Member);
  }

  for (const value of Object.values(node)) {
    collectMemberNodes(value, out);
  }
}

function normalizeXmlValue(value) {
  if (value == null) return null;
  return normalizeWhitespace(value) || null;
}

function extractPtrFilings(xmlText) {
  const parser = new XMLParser({
    ignoreAttributes: true,
    trimValues: true,
    parseTagValue: false,
  });

  const parsed = parser.parse(xmlText);
  const memberNodes = [];
  collectMemberNodes(parsed, memberNodes);

  const ptrRows = [];
  for (const member of memberNodes) {
    const filingType = normalizeXmlValue(member.FilingType);
    const docId = normalizeXmlValue(member.DocID);
    if (filingType !== 'P' || !docId) continue;

    const first = normalizeXmlValue(member.First) ?? '';
    const last = normalizeXmlValue(member.Last) ?? '';
    const filingDate = normalizeXmlValue(member.FilingDate);
    const stateDst = normalizeXmlValue(member.StateDst);
    const year = Number(normalizeXmlValue(member.Year));

    ptrRows.push({
      docId,
      first,
      last,
      filingDate,
      stateDst,
      year: Number.isInteger(year) ? year : null,
    });
  }

  return ptrRows;
}

async function fetchPtrFilingsForYear(year) {
  const zipRes = await fetch(FINANCIAL_ZIP_URL(year));
  if (!zipRes.ok) {
    throw new Error(`Failed to fetch ${year} zip: ${zipRes.status}`);
  }

  const zipBuffer = Buffer.from(await zipRes.arrayBuffer());
  const zip = new AdmZip(zipBuffer);
  const xmlEntry = zip.getEntries().find((entry) => /\.xml$/i.test(entry.entryName));

  if (!xmlEntry) {
    throw new Error(`No XML entry found in ${year} zip.`);
  }

  const xmlText = xmlEntry.getData().toString('utf8');
  return extractPtrFilings(xmlText);
}

function extractTradesFromPdfText(docId, text) {
  const rows = [];

  // The PDF text sometimes splits the amount range across two lines:
  //   "S    07/28/2025 08/11/2025 $1,001 -"
  //   "$15,000"
  // Join such continuation lines first so each logical row is one string.
  const rawLines = String(text).split(/\r?\n/).map((l) => l.trim());
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const cur = rawLines[i];
    const next = rawLines[i + 1] ?? '';
    // If line ends with "- " or "-" and next line starts with "$", merge them.
    if (/\$[\d,]+\s*-\s*$/.test(cur) && /^\$[\d,]/.test(next)) {
      lines.push(`${cur} ${next}`);
      i++; // skip next
    } else {
      lines.push(cur);
    }
  }

  let pendingTicker = null;

  for (const cleanLine of lines) {
    // Try to detect ticker from lines like "(GSK)" or "(GSK) [ST]"
    const tickerMatch = cleanLine.match(/\(([A-Z][A-Z0-9.]{0,9})\)/);
    // Don't treat "(partial)" or date-containing lines as tickers
    if (tickerMatch && !/\b[PS]\b/.test(cleanLine) && !/\d{2}\/\d{2}\/\d{4}/.test(cleanLine)) {
      pendingTicker = tickerMatch[1];
      continue;
    }

    // Match transaction line — handles "S", "P", "S (partial)", "P (partial)" etc.
    // Format: "[SP][ (partial)]   MM/DD/YYYY MM/DD/YYYY $lo - $hi"
    const tradeLinePattern =
      /\b([PS])(?:\s*\([^)]+\))?\s+(\d{2}\/\d{2}\/\d{4})\s+\d{2}\/\d{2}\/\d{4}\s+(\$[\d,]+)\s*-\s*(\$[\d,]+)/;
    const tradeMatch = cleanLine.match(tradeLinePattern);

    if (tradeMatch) {
      const tradeType = tradeMatch[1];
      const tradeDate = toIsoDate(tradeMatch[2]);
      const amountLow = parseMoney(tradeMatch[3]);
      const amountHigh = parseMoney(tradeMatch[4]);
      const amount = (amountLow + amountHigh) / 2;

      if (tradeDate && Number.isFinite(amount) && amount > 0) {
        rows.push({
          docId,
          ticker: pendingTicker,
          tradeType,
          tradeDate,
          amount,
        });
      }

      pendingTicker = null;
      continue;
    }

    // Clear pending ticker only on clear section-break lines
    const looksLikeSectionBreak = /^(F I|I P O|C  S|Name:|Status:|State|Clerk|--|\*\s)/i.test(cleanLine);
    if (looksLikeSectionBreak) {
      pendingTicker = null;
    }
  }

  return rows;
}

async function fetchAndParsePtrPdf(year, docId) {
  const pdfRes = await fetch(PTR_PDF_URL(year, docId));
  if (!pdfRes.ok) {
    throw new Error(`PDF request failed: ${pdfRes.status}`);
  }

  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
  const parser = new PDFParse({ data: pdfBuffer });
  const parsed = await parser.getText();
  await parser.destroy();

  const rows = extractTradesFromPdfText(docId, parsed.text);

  if (rows.length === 0) {
    throw new Error('No parseable trade rows found in PDF.');
  }

  return rows;
}

function resolveBioguide(filing, members) {
  const full = normalizeName(`${filing.first} ${filing.last}`);
  const firstNorm = normalizeName(filing.first);
  const lastNorm = normalizeName(filing.last);

  const exact = members.find((m) => m.normalized === full);
  if (exact) return exact.bioguide;

  const filtered = members.filter((m) => m.normalized.includes(lastNorm));

  const firstToken = firstNorm.split(' ')[0] ?? '';
  const tokenMatch = filtered.find((m) => m.normalized.split(' ').includes(firstToken));
  if (tokenMatch) return tokenMatch.bioguide;

  if (filtered.length === 1) return filtered[0].bioguide;
  return null;
}

async function ensureFailedDocRecorded(prisma, docId, year, reason) {
  await prisma.ptr_failed_docs.upsert({
    where: { doc_id: docId },
    update: {
      year,
      reason,
    },
    create: {
      doc_id: docId,
      year,
      reason,
    },
  });

  await fs.mkdir(path.dirname(FAILED_DOC_LOG_PATH), { recursive: true });
  await fs.appendFile(
    FAILED_DOC_LOG_PATH,
    `${JSON.stringify({ docId, year, reason, attemptedAt: new Date().toISOString() })}\n`,
    'utf8'
  );
}

function getPostgresUrl() {
  const direct =
    process.env.TRADING_STORAGE_POSTGRES_URL ||
    process.env.TRADING_STORAGE_PRISMA_DATABASE_URL ||
    process.env.POSTGRES_URL;

  if (direct && direct.startsWith('postgres')) return direct;

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.startsWith('postgres')) return dbUrl;

  throw new Error('Missing direct Postgres URL. Set TRADING_STORAGE_POSTGRES_URL (or POSTGRES_URL).');
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const discoveredYears = await fetchAllAvailableYears();

  let targetYears;
  if (args.years.length > 0) {
    targetYears = args.years;
  } else if (args.allYears) {
    targetYears = discoveredYears;
  } else {
    targetYears = [discoveredYears[discoveredYears.length - 1]];
  }

  const pgClient = new PgClient({ connectionString: getPostgresUrl() });
  const adapter = new PrismaPg(pgClient);
  const prisma = new PrismaClient({ adapter });

  let runRecord = null;
  let docsDiscovered = 0;
  let docsSucceeded = 0;
  let docsFailed = 0;
  let docsSkipped = 0;

  await prisma.$connect();

  try {
    runRecord = await prisma.ptr_sync_runs.create({
      data: {
        status: 'running',
        years_processed: targetYears.join(','),
      },
    });

    const members = await prisma.members.findMany({
      select: { bioguide: true, full_name: true },
    });
    const normalizedMembers = members.map((m) => ({
      bioguide: m.bioguide,
      normalized: normalizeName(m.full_name),
    }));

    for (const year of targetYears) {
      console.log(`Processing year ${year}...`);
      let filings;

      try {
        filings = await fetchPtrFilingsForYear(year);
      } catch (error) {
        docsFailed += 1;
        const reason = `year_fetch_failed:${error.message}`;
        await ensureFailedDocRecorded(prisma, `YEAR-${year}`, year, reason);
        console.warn(`Skipping year ${year}: ${reason}`);
        continue;
      }

      const uniqueByDocId = new Map();
      for (const filing of filings) uniqueByDocId.set(filing.docId, filing);
      const uniqueFilings = [...uniqueByDocId.values()];

      docsDiscovered += uniqueFilings.length;

      for (const filing of uniqueFilings) {
        const docId = filing.docId;

        const existingDisclosure = await prisma.disclosures.findFirst({
          where: { doc_id: docId },
          select: { id: true },
        });

        if (existingDisclosure) {
          docsSkipped += 1;
          continue;
        }

        const bioguide = resolveBioguide(filing, normalizedMembers);
        if (!bioguide) {
          docsFailed += 1;
          await ensureFailedDocRecorded(prisma, docId, year, 'member_not_found_for_doc');
          continue;
        }

        let parsedTrades;
        try {
          parsedTrades = await fetchAndParsePtrPdf(year, docId);
        } catch (error) {
          docsFailed += 1;
          await ensureFailedDocRecorded(prisma, docId, year, `pdf_parse_failed:${error.message}`);
          continue;
        }

        const tradesPayload = parsedTrades.map((trade) => ({
          ticker: trade.ticker,
          trade_date: trade.tradeDate,
          trade_type: trade.tradeType,
          amount: trade.amount,
        }));

        const tradeTypeSet = new Set(parsedTrades.map((t) => t.tradeType));
        const disclosureTradeType = tradeTypeSet.size === 1 ? parsedTrades[0].tradeType : 'MIXED';
        const disclosureDate = toIsoDate(filing.filingDate) || parsedTrades[0].tradeDate;
        const district = formatDistrict(filing.stateDst);

        try {
          await prisma.$transaction(async (tx) => {
            const disclosure = await tx.disclosures.create({
              data: {
                doc_id: docId,
                bioguide,
                ticker: parsedTrades[0].ticker,
                transaction_type: disclosureTradeType,
                trade_date: disclosureDate,
                amount_range: `$${Math.round(parsedTrades[0].amount).toLocaleString()} - $${Math.round(parsedTrades[0].amount).toLocaleString()}`,
                sector: district || 'House PTR',
              },
              select: { id: true },
            });

            if (tradesPayload.length > 0) {
              await tx.trades.createMany({
                data: tradesPayload.map((t) => ({
                  ...t,
                  disclosure_id: disclosure.id,
                })),
                skipDuplicates: true,
              });
            }
          });

          docsSucceeded += 1;
        } catch (error) {
          docsFailed += 1;
          await ensureFailedDocRecorded(prisma, docId, year, `db_write_failed:${error.message}`);
        }
      }
    }

    await prisma.ptr_sync_runs.update({
      where: { id: runRecord.id },
      data: {
        status: docsFailed > 0 ? 'partial' : 'success',
        finished_at: new Date(),
        docs_discovered: docsDiscovered,
        docs_succeeded: docsSucceeded,
        docs_failed: docsFailed,
        notes: `skipped_existing=${docsSkipped}`,
      },
    });

    console.log(
      `PTR sync finished. discovered=${docsDiscovered}, succeeded=${docsSucceeded}, failed=${docsFailed}, skipped=${docsSkipped}`
    );
  } catch (error) {
    if (runRecord) {
      await prisma.ptr_sync_runs.update({
        where: { id: runRecord.id },
        data: {
          status: 'failed',
          finished_at: new Date(),
          docs_discovered: docsDiscovered,
          docs_succeeded: docsSucceeded,
          docs_failed: docsFailed,
          notes: error.message,
        },
      });
    }

    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error('PTR sync failed:', error);
  process.exit(1);
});

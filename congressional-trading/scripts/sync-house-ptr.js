#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv/config');

const fs = require('fs/promises');
const path = require('path');
const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');
const pdfParse = require('pdf-parse');
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

function isSaneYear(year) {
  const currentYear = new Date().getUTCFullYear();
  return Number.isInteger(year) && year >= 2000 && year <= currentYear + 1;
}

function daysBetween(fromIso, toIso) {
  return (new Date(`${toIso}T00:00:00Z`) - new Date(`${fromIso}T00:00:00Z`)) / 86_400_000;
}

// pdf-parse occasionally garbles a digit in the "Transaction Date" column for a specific
// row (a font/glyph extraction artifact — e.g. "04/30/2021" comes out as "04/30/3031"),
// while the adjacent "Notification Date" on the same line extracts correctly. Since a
// transaction can never legally postdate its own notification, cross-check the two: if the
// transaction date has an insane year or claims to be after the notification date, keep its
// month/day (those digits matched) and try the notification's year, then the year before it.
function resolveTransactionDate(rawTransactionDate, rawNotificationDate) {
  const transactionDate = toIsoDate(rawTransactionDate);
  const notificationDate = toIsoDate(rawNotificationDate);

  if (!notificationDate) return transactionDate;

  if (transactionDate) {
    const transactionYear = Number(transactionDate.slice(0, 4));
    if (isSaneYear(transactionYear) && transactionDate <= notificationDate) {
      return transactionDate;
    }

    const monthDay = transactionDate.slice(5);
    const notificationYear = Number(notificationDate.slice(0, 4));
    for (const candidateYear of [notificationYear, notificationYear - 1]) {
      const candidate = `${candidateYear}-${monthDay}`;
      const gap = daysBetween(candidate, notificationDate);
      if (gap >= 0 && gap <= 400) {
        return candidate;
      }
    }
  }

  return notificationDate;
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

// Matches either a value range ("$1,001 - $15,000") or a single absolute value,
// optionally prefixed by "Over" (the highest disclosure bracket, e.g. "Over $1,000,000",
// sometimes itself prefixed by an owner code like "Spouse/DC Over $1,000,000").
const AMOUNT_RE = /(?:Over\s*)?\$([\d,]+)(?:\s*-\s*\$([\d,]+))?/;

function parseAmountFromTail(tail) {
  const m = String(tail).match(AMOUNT_RE);
  if (!m) return null;
  const lo = parseMoney(m[1]);
  if (!Number.isFinite(lo)) return null;
  const hi = m[2] ? parseMoney(m[2]) : lo;
  return (lo + hi) / 2;
}

// Many disclosed assets (private funds, LLCs, municipal bonds, Treasury notes) have no
// ticker at all — this is the raw descriptive text for those, kept for display purposes
// when there's no symbol to show instead.
function cleanAssetName(raw) {
  // Some PDFs render abbreviated form labels ("Filer Status:", "Sub Owner:") with the
  // non-first letters of each word replaced by stray control characters (e.g. null
  // bytes) instead of spaces — strip those before collapsing whitespace.
  let name = String(raw ?? '').replace(/[\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim();
  // Trailing asset-type bracket, e.g. "... [GS]" or "... [OT]".
  name = name.replace(/\s*\[[A-Za-z]{1,5}\]\s*$/, '').trim();
  // Leading owner-code stuck directly to the name with no space (Spouse/Joint/Dependent
  // Child codes from the disclosure form — "SPMulti-Pack Solutions LLC" → "Multi-Pack...").
  name = name.replace(/^(SP|JT|DC)(?=[A-Z])/, '').trim();
  return name || null;
}

function extractTradesFromPdfText(docId, text) {
  const rows = [];

  // The PDF text sometimes splits the amount across two lines:
  //   "S    07/28/2025 08/11/2025 $1,001 -"        or        "...Spouse/DC Over"
  //   "$15,000"                                              "$1,000,000"
  // Join such continuation lines first so each logical row is one string.
  const rawLines = String(text).split(/\r?\n/).map((l) => l.trim());
  const lines = [];
  for (let i = 0; i < rawLines.length; i++) {
    const cur = rawLines[i];
    const next = rawLines[i + 1] ?? '';
    if ((/\$[\d,]+\s*-\s*$/.test(cur) || /\bOver\s*$/i.test(cur)) && /^\$[\d,]/.test(next)) {
      lines.push(`${cur} ${next}`);
      i++; // skip next
    } else {
      lines.push(cur);
    }
  }

  let pendingTicker = null;
  // Asset descriptions for non-ticker holdings (bonds, private funds) sometimes wrap
  // across several lines before the trade-type/dates/amount line — accumulate them here.
  let pendingAssetNameLines = [];

  for (const cleanLine of lines) {
    // Combined format (newer PDFs): ticker and trade columns concatenated on one line
    // e.g. "Amazon.com, Inc. (AMZN) [ST]P01/02/201901/02/2019$1,001 - $15,000"
    // Type is P (purchase), S (sale), or E (exchange, e.g. a spin-off).
    // Ticker/asset-type letters are matched case-insensitively: some PDFs' embedded fonts
    // have a broken glyph-to-Unicode mapping that extracts scattered letters (often the
    // first letter of a word, e.g. S, G, U) as lowercase — "(AMZN)" becomes "(aMZN)" — even
    // though the rest of the run's characters extract correctly.
    const combinedMatch = cleanLine.match(
      /^(.*?)\(([A-Za-z][A-Za-z0-9.]{0,9})\)\s*(?:\[[A-Za-z]{1,5}\]\s*)?([PSE])(?:\s*\([^)]+\))?\s*(\d{2}\/\d{2}\/\d{4})\s*(\d{2}\/\d{2}\/\d{4})\s*(.*)$/
    );
    if (combinedMatch) {
      const tradeDate = resolveTransactionDate(combinedMatch[4], combinedMatch[5]);
      const amount = parseAmountFromTail(combinedMatch[6]);
      // Require at least one genuine uppercase letter so a fully-lowercase parenthetical
      // (an annotation word, not a corrupted ticker) doesn't get mistaken for one — but
      // still record the trade itself (ticker unknown) rather than dropping it entirely.
      const ticker = /[A-Z]/.test(combinedMatch[2]) ? combinedMatch[2].toUpperCase() : null;
      if (tradeDate && amount && amount > 0) {
        rows.push({ docId, ticker, assetName: ticker ? null : cleanAssetName(combinedMatch[1]), tradeType: combinedMatch[3], tradeDate, amount });
      }
      pendingTicker = null;
      pendingAssetNameLines = [];
      continue;
    }

    // Cryptocurrency assets use a bare lowercase symbol + [CT] bracket instead of (TICKER)
    // e.g. "usdc [CT]P12/26/202512/26/2025$1,001 - $15,000"
    const cryptoMatch = cleanLine.match(
      /\b([a-zA-Z]{2,10})\s*\[CT\]\s*([PSE])(?:\s*\([^)]+\))?\s*(\d{2}\/\d{2}\/\d{4})\s*(\d{2}\/\d{2}\/\d{4})\s*(.*)$/
    );
    if (cryptoMatch) {
      const tradeDate = resolveTransactionDate(cryptoMatch[3], cryptoMatch[4]);
      const amount = parseAmountFromTail(cryptoMatch[5]);
      if (tradeDate && amount && amount > 0) {
        rows.push({ docId, ticker: cryptoMatch[1].toUpperCase(), assetName: null, tradeType: cryptoMatch[2], tradeDate, amount });
      }
      pendingTicker = null;
      pendingAssetNameLines = [];
      continue;
    }

    // Named asset with NO ticker, all on one line, e.g.
    // "Mercato Partners IV, LP [HN]P02/15/202303/30/2023$1,001 - $15,000"
    const namedNoTickerMatch = cleanLine.match(
      /^(.+?)\s*\[[A-Za-z]{1,5}\]\s*([PSE])(?:\s*\([^)]+\))?\s*(\d{2}\/\d{2}\/\d{4})\s*(\d{2}\/\d{2}\/\d{4})\s*(.*)$/
    );
    if (namedNoTickerMatch) {
      const tradeDate = resolveTransactionDate(namedNoTickerMatch[3], namedNoTickerMatch[4]);
      const amount = parseAmountFromTail(namedNoTickerMatch[5]);
      if (tradeDate && amount && amount > 0) {
        rows.push({
          docId,
          ticker: null,
          assetName: cleanAssetName(namedNoTickerMatch[1]),
          tradeType: namedNoTickerMatch[2],
          tradeDate,
          amount,
        });
      }
      pendingTicker = null;
      pendingAssetNameLines = [];
      continue;
    }

    // Try to detect ticker from lines like "(GSK)" or "(GSK) [ST]"
    const tickerMatch = cleanLine.match(/\(([A-Za-z][A-Za-z0-9.]{0,9})\)/);
    // Don't treat "(partial)" or date-containing lines as tickers, and require at least
    // one genuine uppercase letter (see combinedMatch comment above) so an annotation
    // word like "(New)" isn't mistaken for a ticker.
    if (tickerMatch && /[A-Z]/.test(tickerMatch[1]) && !/\b[PSE]\b/.test(cleanLine) && !/\d{2}\/\d{2}\/\d{4}/.test(cleanLine)) {
      pendingTicker = tickerMatch[1].toUpperCase();
      pendingAssetNameLines = [];
      continue;
    }

    // Match transaction line — handles "S", "P", "E", "S (partial)" etc., with or without
    // whitespace between the type code and the dates (varies by PDF).
    // Format: "[PSE][ (partial)] MM/DD/YYYY MM/DD/YYYY <$lo - $hi | Over $X>"
    const tradeLinePattern =
      /\b([PSE])(?:\s*\([^)]+\))?\s*(\d{2}\/\d{2}\/\d{4})\s*(\d{2}\/\d{2}\/\d{4})\s*(.*)$/;
    const tradeMatch = cleanLine.match(tradeLinePattern);

    if (tradeMatch) {
      const tradeType = tradeMatch[1];
      const tradeDate = resolveTransactionDate(tradeMatch[2], tradeMatch[3]);
      const amount = parseAmountFromTail(tradeMatch[4]);

      if (tradeDate && amount && amount > 0) {
        rows.push({
          docId,
          ticker: pendingTicker,
          assetName: pendingTicker ? null : cleanAssetName(pendingAssetNameLines.join(' ')),
          tradeType,
          tradeDate,
          amount,
        });
      }

      pendingTicker = null;
      pendingAssetNameLines = [];
      continue;
    }

    // Clear pending ticker/asset-name only on clear section-break or known metadata-trailer
    // lines (filing status, sub-holding chain, spin-off descriptions, etc.) — anything else
    // is treated as part of a multi-line asset description (e.g. wrapped bond names).
    const looksLikeSectionBreak = /^(F I|I P O|C  S|Name:|Status:|State|Clerk|--|\*\s)/i.test(cleanLine);
    // Some PDFs render abbreviated form labels ("Filer Status:", "Sub Owner:") as a lone
    // letter, filler (spaces or stray control characters), another lone letter, filler,
    // then a colon — e.g. "F\x00\x00\x00\x00\x00 S\x00\x00\x00\x00\x00: New". Match that
    // shape generically rather than the exact filler characters of any one PDF variant.
    const looksLikeAbbreviatedLabel = /^[A-Za-z][^A-Za-z0-9]{1,20}[A-Za-z][^A-Za-z0-9]{0,20}:\s*\S/.test(cleanLine);
    // Single-letter labels ("L : US", "D : Dividend reinvestment...") show up the same way
    // for Location/Description fields on some filings.
    const looksLikeSingleLetterLabel = /^[A-Za-z]\s*:\s*\S/.test(cleanLine);
    // A free-text continuation of a Description field, e.g. "– Business Development
    // Company." following a "D : ..." line.
    const looksLikeDashContinuation = /^[-–]\s*\S/.test(cleanLine);
    const looksLikeMetadataTrailer =
      /^(FILING STATUS|SUb?\s*HOLDING|DESCRIPTION|Filing ID|gfedc)/i.test(cleanLine) ||
      looksLikeAbbreviatedLabel ||
      looksLikeSingleLetterLabel ||
      looksLikeDashContinuation;
    // The table header ("ID Owner Asset Transaction Type Date Notification Date Amount
    // Cap. Gains > $200?") gets mangled by extraction into several short fragment lines
    // before the first real asset entry — treat its last fragment as a reset point so
    // none of it leaks into an asset name.
    const looksLikeTableHeaderFragment = /^(tranSaction|.*owner.*asset.*transaction|^type$|Date\s*notification|^Date$|amount\s*cap|gains\s*>|\$?200\?)/i.test(cleanLine);
    if (looksLikeSectionBreak || looksLikeTableHeaderFragment) {
      pendingTicker = null;
      pendingAssetNameLines = [];
    } else if (looksLikeMetadataTrailer) {
      // Skip without resetting — a metadata trailer can appear between an asset's
      // description lines and its trade line in some layouts.
    } else if (cleanLine) {
      pendingAssetNameLines.push(cleanLine);
    }
  }

  return rows;
}

async function fetchAndParsePtrPdf(year, docId) {
  // A plain fetch() has no default timeout and can hang indefinitely on a stalled
  // connection — bound it so one bad request can't stall the whole sync run.
  const pdfRes = await fetch(PTR_PDF_URL(year, docId), { signal: AbortSignal.timeout(20_000) });
  if (!pdfRes.ok) {
    throw new Error(`PDF request failed: ${pdfRes.status}`);
  }

  const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());
  const parsed = await pdfParse(pdfBuffer);

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
          asset_name: trade.assetName ?? null,
          trade_date: trade.tradeDate,
          trade_type: trade.tradeType,
          amount: trade.amount,
        }));

        const tradeTypeSet = new Set(parsedTrades.map((t) => t.tradeType));
        const disclosureTradeType = tradeTypeSet.size === 1 ? parsedTrades[0].tradeType : 'MIXED';
        const filedDate = toIsoDate(filing.filingDate);
        const disclosureDate = filedDate || parsedTrades[0].tradeDate;
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
                filed_date: filedDate,
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

          await prisma.ptr_failed_docs.deleteMany({ where: { doc_id: docId } });
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

module.exports = { extractTradesFromPdfText, cleanAssetName, resolveTransactionDate };

// Guard so this file can be safely require()'d (e.g. from tests or a reparse script)
// without triggering a live sync run against production.
if (require.main === module) {
  run().catch((error) => {
    console.error('PTR sync failed:', error);
    process.exit(1);
  });
}

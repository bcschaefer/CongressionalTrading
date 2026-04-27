#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv/config');

const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Client: PgClient } = require('pg');

const FINANCIAL_DISCLOSURE_PAGE = 'https://disclosures-clerk.house.gov/PublicDisclosure/FinancialDisclosure';
const FINANCIAL_ZIP_URL = (year) => `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${year}FD.zip`;

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

function normalizeXmlValue(value) {
  if (value == null) return null;
  return normalizeWhitespace(value) || null;
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
    if (years.length > 0) return years;
  }

  const availableYears = [];
  const currentYear = new Date().getUTCFullYear();
  for (let year = 2008; year <= currentYear; year += 1) {
    try {
      const zipRes = await fetch(FINANCIAL_ZIP_URL(year), { method: 'HEAD' });
      if (zipRes.ok) availableYears.push(year);
    } catch {
      // skip
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

function extractAnnualFilings(xmlText) {
  const parser = new XMLParser({
    ignoreAttributes: true,
    trimValues: true,
    parseTagValue: false,
  });

  const parsed = parser.parse(xmlText);
  const memberNodes = [];
  collectMemberNodes(parsed, memberNodes);

  const annualRows = [];
  for (const member of memberNodes) {
    const filingType = normalizeXmlValue(member.FilingType);
    const docId = normalizeXmlValue(member.DocID);

    // 'A' = Annual (older filings), 'O' = Original annual (newer), 'C' = Correction/amendment
    if (!['A', 'O', 'C'].includes(filingType ?? '') || !docId) continue;

    const first = normalizeXmlValue(member.First) ?? '';
    const last = normalizeXmlValue(member.Last) ?? '';
    const filingDate = normalizeXmlValue(member.FilingDate);
    const stateDst = normalizeXmlValue(member.StateDst);
    const year = Number(normalizeXmlValue(member.Year));

    annualRows.push({
      docId,
      first,
      last,
      fullName: normalizeWhitespace(`${first} ${last}`),
      filingDate,
      stateDst,
      filingType,
      year: Number.isInteger(year) ? year : 0,
    });
  }

  return annualRows;
}

async function fetchAnnualFilingsForYear(year) {
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
  return extractAnnualFilings(xmlText);
}

// Maps canonical first names to common nicknames/aliases
const NICKNAME_VARIANTS = {
  william:    ['bill', 'will', 'billy'],
  james:      ['jim', 'jimmy'],
  robert:     ['bob', 'rob', 'bobby'],
  thomas:     ['tom', 'tommy'],
  edward:     ['ted', 'ed', 'eddie', 'ned'],
  theodore:   ['ted'],
  joseph:     ['joe', 'joey'],
  donald:     ['don', 'donnie'],
  michael:    ['mike', 'mick', 'mikey'],
  luis:       ['lou'],
  lewis:      ['lou'],
  louis:      ['lou'],
  john:       ['jack', 'jake', 'johnny'],
  jacob:      ['jake'],
  randolph:   ['randy'],
  randall:    ['randy'],
  elijah:     ['eli'],
  elias:      ['eli'],
  rebecca:    ['becca', 'becky'],
  benjamin:   ['ben', 'benny'],
  daniel:     ['dan', 'danny'],
  charles:    ['chuck', 'charlie'],
  richard:    ['dick', 'rick', 'rich', 'ricky'],
  peter:      ['pete'],
  anthony:    ['tony'],
  gregory:    ['greg'],
  steven:     ['steve'],
  stephen:    ['steve'],
  kenneth:    ['ken', 'kenny'],
  francis:    ['frank'],
  franklin:   ['frank'],
  david:      ['dave'],
  christopher:['chris'],
  christian:  ['chris'],
  albert:     ['al'],
  alfred:     ['al'],
  elizabeth:  ['liz', 'lizzie', 'beth', 'betty', 'bette'],
  susan:      ['sue', 'susie'],
  patricia:   ['pat', 'patty'],
  katherine:  ['kate', 'kathy', 'kay'],
  kathryn:    ['kate', 'kathy', 'kay'],
  catherine:  ['kate', 'cathy'],
  valerie:    ['val'],
  andrew:     ['andy'],
  matthew:    ['matt'],
  samuel:     ['sam'],
  timothy:    ['tim', 'timmie'],
  harold:     ['hal'],
  henry:      ['hank'],
  eugene:     ['gene'],
  vincent:    ['vince'],
  gerald:     ['jerry'],
  jerome:     ['jerry'],
  raymond:    ['ray'],
  frederick:  ['fred'],
  fredrick:   ['fred'],
  ernest:     ['ernie'],
  lawrence:   ['larry'],
  nathaniel:  ['nate', 'nat'],
  nicholas:   ['nick'],
  phillip:    ['phil'],
  philip:     ['phil'],
  stanley:    ['stan'],
  walter:     ['walt'],
  yevgeny:    ['eugene', 'gene'],
};

// Build reverse: nickname → canonicals
const NICK_TO_CANONICAL = {};
for (const [canonical, nicks] of Object.entries(NICKNAME_VARIANTS)) {
  for (const nick of nicks) {
    if (!NICK_TO_CANONICAL[nick]) NICK_TO_CANONICAL[nick] = [];
    NICK_TO_CANONICAL[nick].push(canonical);
  }
}

/**
 * Returns all name variants for a given first-name token:
 * if it's a canonical → include its nicknames
 * if it's a nickname → include its canonicals
 */
function firstNameVariants(token) {
  const variants = new Set([token]);
  (NICKNAME_VARIANTS[token] || []).forEach((n) => variants.add(n));
  (NICK_TO_CANONICAL[token] || []).forEach((c) => variants.add(c));
  return variants;
}

function resolveBioguide(filing, members) {
  const full = normalizeName(`${filing.first} ${filing.last}`);
  const firstNorm = normalizeName(filing.first);
  const lastNorm = normalizeName(filing.last);

  // Must have at least 2 chars for a meaningful token
  if (lastNorm.length < 2 || firstNorm.length < 2) return null;

  // Exact full-name match
  const exact = members.find((m) => m.normalized === full);
  if (exact) return exact.bioguide;

  // Last name must appear as a distinct word
  const lastFiltered = members.filter((m) => m.normalized.split(' ').includes(lastNorm));

  // Try first token of first name
  const firstToken = firstNorm.split(' ')[0] ?? '';
  const tokenMatch = lastFiltered.find((m) => m.normalized.split(' ').includes(firstToken));
  if (tokenMatch) return tokenMatch.bioguide;

  // Extended: try ALL tokens from the first-name field (length >= 3 to skip initials),
  // plus nickname/canonical expansions for each token.
  const firstNameTokens = firstNorm.split(' ').filter((t) => t.length >= 3);
  const allVariants = new Set();
  for (const tok of firstNameTokens) {
    for (const v of firstNameVariants(tok)) allVariants.add(v);
  }
  // Remove already-tried firstToken to avoid redundant lookup
  allVariants.delete(firstToken);

  const extendedMatch = lastFiltered.find((m) => {
    const mTokens = m.normalized.split(' ');
    return [...allVariants].some((v) => mTokens.includes(v));
  });
  if (extendedMatch) return extendedMatch.bioguide;

  // Hyphenated / multi-word last name: check if last name is contained and at least 8 chars
  if (lastNorm.length >= 8) {
    const containsLast = members.filter((m) => m.normalized.includes(lastNorm));
    if (containsLast.length === 1) {
      const m = containsLast[0];
      const mTokens = m.normalized.split(' ');
      if ([...firstNameVariants(firstToken)].some((v) => mTokens.includes(v))) {
        return m.bioguide;
      }
    }
  }

  return null;
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

  let docsDiscovered = 0;
  let docsUpserted = 0;

  await prisma.$connect();

  try {
    const members = await prisma.members.findMany({
      select: { bioguide: true, full_name: true },
    });

    const normalizedMembers = members.map((member) => ({
      bioguide: member.bioguide,
      normalized: normalizeName(member.full_name),
    }));

    for (const year of targetYears) {
      console.log(`Processing annual filings for ${year}...`);
      const filings = await fetchAnnualFilingsForYear(year);
      docsDiscovered += filings.length;

      for (const filing of filings) {
        const bioguide = resolveBioguide(filing, normalizedMembers);
        await prisma.annual_financial_disclosures.upsert({
          where: { doc_id: filing.docId },
          update: {
            bioguide,
            first_name: filing.first,
            last_name: filing.last,
            full_name: filing.fullName,
            state_district: filing.stateDst,
            filing_type: filing.filingType,
            filing_year: filing.year,
            filing_date: filing.filingDate,
            source_url: FINANCIAL_ZIP_URL(year),
          },
          create: {
            doc_id: filing.docId,
            bioguide,
            first_name: filing.first,
            last_name: filing.last,
            full_name: filing.fullName,
            state_district: filing.stateDst,
            filing_type: filing.filingType,
            filing_year: filing.year,
            filing_date: filing.filingDate,
            source_url: FINANCIAL_ZIP_URL(year),
          },
        });
        docsUpserted += 1;
      }
    }

    console.log(`Annual sync complete. discovered=${docsDiscovered}, upserted=${docsUpserted}`);
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error('Annual sync failed:', error);
  process.exit(1);
});

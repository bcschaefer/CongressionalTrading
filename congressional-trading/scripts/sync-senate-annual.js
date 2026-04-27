#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv/config');

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Client: PgClient } = require('pg');
const {
  SenateEfdClient,
  normalizeWhitespace,
  parseReportRow,
} = require('./senate-efd-client');

const DEFAULT_START_DATE = '01/01/2012';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableDbError(error) {
  const msg = String(error?.message ?? '').toLowerCase();
  const code = String(error?.code ?? error?.cause?.code ?? '').toUpperCase();

  if (code === 'ECONNRESET' || code === 'ETIMEDOUT') return true;
  if (msg.includes('connection terminated unexpectedly')) return true;
  if (msg.includes('server closed the connection unexpectedly')) return true;
  return false;
}

function parseArgs(argv) {
  const out = {
    startDate: DEFAULT_START_DATE,
    endDate: null,
    pageSize: 100,
  };

  for (const arg of argv) {
    if (arg.startsWith('--start-date=')) out.startDate = arg.split('=')[1];
    if (arg.startsWith('--end-date=')) out.endDate = arg.split('=')[1];
    if (arg.startsWith('--page-size=')) out.pageSize = Number(arg.split('=')[1]) || out.pageSize;
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

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const pgClient = new PgClient({ connectionString: getPostgresUrl() });
  const adapter = new PrismaPg(pgClient);
  const prisma = new PrismaClient({ adapter });
  const senateClient = new SenateEfdClient();

  await prisma.$connect();

  let discovered = 0;
  let upserted = 0;

  try {
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

    while (total == null || start < total) {
      const data = await senateClient.fetchReportPage({
        draw,
        start,
        length: args.pageSize,
        filerTypes: [1, 5], // Senator, Former Senator
        reportTypes: [7], // Annual
        submittedStart: args.startDate,
        submittedEnd: args.endDate,
      });

      const rows = Array.isArray(data.data) ? data.data : [];
      discovered += rows.length;
      total = Number(data.recordsFiltered ?? data.recordsTotal ?? rows.length);

      for (const row of rows) {
        const report = parseReportRow(row);
        if (!report.reportId) continue;

        const bioguide = resolveBioguide(report.firstName, report.lastName, normalizedMembers);
        const filingYear = report.filedDateIso
          ? Number(report.filedDateIso.slice(0, 4))
          : new Date().getUTCFullYear();

        const docId = `SENATE-${report.reportId}`;

        await withDbRetry('upsert senate annual disclosure', () => prisma.annual_financial_disclosures.upsert({
          where: { doc_id: docId },
          update: {
            bioguide,
            first_name: report.firstName || null,
            last_name: report.lastName || null,
            full_name: normalizeWhitespace(`${report.firstName} ${report.lastName}`),
            state_district: 'US-SENATE',
            filing_type: 'SENATE_ANNUAL',
            filing_year: filingYear,
            filing_date: report.filedDateIso,
            source_url: report.reportPath
              ? `https://efdsearch.senate.gov${report.reportPath}`
              : 'https://efdsearch.senate.gov/search/',
          },
          create: {
            doc_id: docId,
            bioguide,
            first_name: report.firstName || null,
            last_name: report.lastName || null,
            full_name: normalizeWhitespace(`${report.firstName} ${report.lastName}`),
            state_district: 'US-SENATE',
            filing_type: 'SENATE_ANNUAL',
            filing_year: filingYear,
            filing_date: report.filedDateIso,
            source_url: report.reportPath
              ? `https://efdsearch.senate.gov${report.reportPath}`
              : 'https://efdsearch.senate.gov/search/',
          },
        }));

        upserted += 1;
      }

      start += rows.length;
      draw += 1;
      if (rows.length === 0) break;

      console.log(`Annual page processed: ${Math.min(start, total)} / ${total}`);
    }

    console.log(`Senate annual sync complete. discovered=${discovered}, upserted=${upserted}`);
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error('Senate annual sync failed:', error);
  process.exit(1);
});

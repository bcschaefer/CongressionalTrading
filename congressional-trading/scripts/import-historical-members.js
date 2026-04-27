#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Imports current and historical Congress members from the
 * unitedstates/congress-legislators dataset (https://theunitedstates.io/).
 *
 * Upserts into the `members` table:
 *   bioguide, full_name, party, chamber, is_active
 *
 * Usage:
 *   node scripts/import-historical-members.js
 */
require('dotenv/config');

const { Client: PgClient } = require('pg');
const yaml = require('js-yaml');

const CURRENT_URL =
  'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-current.yaml';
const HISTORICAL_URL =
  'https://raw.githubusercontent.com/unitedstates/congress-legislators/main/legislators-historical.yaml';

function getPostgresUrl() {
  const url =
    process.env.TRADING_STORAGE_POSTGRES_URL ||
    process.env.TRADING_STORAGE_PRISMA_DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL;
  if (url && url.startsWith('postgres')) return url;
  throw new Error('Missing Postgres URL. Set TRADING_STORAGE_POSTGRES_URL.');
}

function normalizeParty(partyStr) {
  if (!partyStr) return null;
  const p = partyStr.trim().toUpperCase();
  if (p.startsWith('DEM')) return 'D';
  if (p.startsWith('REP')) return 'R';
  if (p.startsWith('IND')) return 'I';
  if (p.startsWith('LIB')) return 'L';
  if (p.startsWith('GRE')) return 'G';
  return partyStr.trim().slice(0, 3).toUpperCase();
}

function normalizeChamber(termType) {
  if (termType === 'rep') return 'house';
  if (termType === 'sen') return 'senate';
  return termType ?? null;
}

/**
 * Converts a legislator JSON object from congress-legislators into a row.
 * @param {object} leg
 * @param {boolean} isActive
 */
function toLegislatorRow(leg, isActive) {
  const bioguide = leg.id?.bioguide;
  if (!bioguide) return null;

  const name = leg.name ?? {};
  const fullName =
    name.official_full ||
    [name.first, name.middle, name.last, name.suffix]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

  if (!fullName) return null;

  // Use the most recent term for party/chamber
  const terms = Array.isArray(leg.terms) ? leg.terms : [];
  const lastTerm = terms[terms.length - 1] ?? {};
  const party = normalizeParty(lastTerm.party);
  const chamber = normalizeChamber(lastTerm.type);

  return { bioguide, fullName, party, chamber, isActive };
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchLegislators(url) {
  console.log(`Fetching ${url} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const text = await res.text();
  return yaml.load(text);
}

async function upsertBatch(pgClient, rows) {
  if (rows.length === 0) return;
  const values = [];
  const tuples = rows.map((r, i) => {
    const base = i * 5;
    values.push(r.bioguide, r.fullName, r.party, r.chamber, r.isActive);
    return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
  });

  const sql = `
    INSERT INTO members (bioguide, full_name, party, chamber, is_active)
    VALUES ${tuples.join(', ')}
    ON CONFLICT (bioguide) DO UPDATE SET
      full_name = EXCLUDED.full_name,
      party     = COALESCE(EXCLUDED.party, members.party),
      chamber   = COALESCE(EXCLUDED.chamber, members.chamber),
      is_active = EXCLUDED.is_active
  `;
  await pgClient.query(sql, values);
}

async function run() {
  const pgClient = new PgClient({ connectionString: getPostgresUrl() });
  await pgClient.connect();

  try {
    const [currentData, historicalData] = await Promise.all([
      fetchLegislators(CURRENT_URL),
      fetchLegislators(HISTORICAL_URL),
    ]);

    const currentRows = currentData
      .map((l) => toLegislatorRow(l, true))
      .filter(Boolean);
    const historicalRows = historicalData
      .map((l) => toLegislatorRow(l, false))
      .filter(Boolean);

    console.log(
      `Parsed ${currentRows.length} current + ${historicalRows.length} historical legislators`
    );

    // Insert historical first, then current (so current wins on conflict)
    let upserted = 0;
    for (const batch of chunk(historicalRows, 250)) {
      await upsertBatch(pgClient, batch);
      upserted += batch.length;
    }
    for (const batch of chunk(currentRows, 250)) {
      await upsertBatch(pgClient, batch);
      upserted += batch.length;
    }

    // Verify
    const result = await pgClient.query(
      'SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE is_active) as active FROM members'
    );
    const { total, active } = result.rows[0];
    console.log(
      `Import complete. upserted=${upserted} | members total=${total} (active=${active}, historical=${Number(total) - Number(active)})`
    );
  } finally {
    await pgClient.end();
  }
}

run().catch((err) => {
  console.error('Import failed:', err);
  process.exit(1);
});

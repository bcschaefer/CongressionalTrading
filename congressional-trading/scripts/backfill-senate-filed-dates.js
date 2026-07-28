#!/usr/bin/env node
/**
 * One-off backfill: populate disclosures.filed_date for existing Senate PTR rows.
 *
 * The true filed date only exists in the Senate search-results listing (not on the
 * report's own page), and wasn't persisted distinctly until now — sync-senate-ptr.js
 * conflated it with trade_date. Re-run the discovery step across the full historical
 * range, match by doc_id (report id), and backfill filed_date directly.
 */
require('dotenv/config');

const { Pool } = require('pg');
const {
  createSenateSession,
  fetchAllReportRows,
  parseReportRow,
  isLikelyPtrTitle,
} = require('./senate-efd-common');

async function run() {
  const connStr =
    process.env.TRADING_STORAGE_POSTGRES_URL ||
    process.env.TRADING_STORAGE_PRISMA_DATABASE_URL ||
    process.env.POSTGRES_URL;
  if (!connStr) throw new Error('Missing TRADING_STORAGE_POSTGRES_URL');

  const pool = new Pool({ connectionString: connStr });

  try {
    console.log('Fetching Senate PTR report listing (01/01/2012 -> today)...');
    const session = await createSenateSession();
    const today = new Date().toISOString().slice(0, 10);
    const [yyyy, mm, dd] = today.split('-');

    const rows = await fetchAllReportRows(session, {
      startDate: '01/01/2012',
      endDate: `${mm}/${dd}/${yyyy}`,
      pageSize: 100,
      filerTypes: [1],
      reportTypes: [11],
    });

    const filedDateByDocId = new Map();
    for (const row of rows) {
      const parsed = parseReportRow(row);
      if (!parsed.reportId || !isLikelyPtrTitle(parsed.reportTitle)) continue;
      if (parsed.filedDateIso) filedDateByDocId.set(parsed.reportId, parsed.filedDateIso);
    }
    console.log(`Discovered ${rows.length} reports, ${filedDateByDocId.size} with a usable filed date.`);

    const { rows: pending } = await pool.query(`
      SELECT d.id, d.doc_id
      FROM disclosures d
      JOIN members m ON m.bioguide = d.bioguide
      WHERE m.chamber = 'senate' AND d.filed_date IS NULL AND d.doc_id IS NOT NULL
    `);
    console.log(`Senate disclosures missing filed_date: ${pending.length}`);

    let updated = 0, notFound = 0;
    for (const row of pending) {
      // The stock-watcher import script prefixed some real eFD UUIDs with "SENATE-".
      const bareDocId = row.doc_id.replace(/^SENATE-/, '');
      const filedDate = filedDateByDocId.get(bareDocId);
      if (!filedDate) { notFound++; continue; }
      await pool.query(`UPDATE disclosures SET filed_date = $1 WHERE id = $2`, [filedDate, row.id]);
      updated++;
    }

    console.log(`Done. updated=${updated} not_found_in_listing=${notFound}`);
  } finally {
    await pool.end();
  }
}

run().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });

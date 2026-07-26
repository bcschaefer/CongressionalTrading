#!/usr/bin/env node
/**
 * Build member_net_worth from electronically-filed ("annual" kind) Senate disclosures.
 *
 * Senate annual disclosures come in two forms:
 *   - Electronic ("/search/view/annual/{id}/") — a structured HTML report where each
 *     asset/liability row already states its value as clean text (e.g. "$100,001 - $250,000").
 *   - Paper ("/search/view/paper/{id}/") — a scanned image with no text layer at all.
 *
 * Paper filings are ignored entirely — there's nothing here to parse them, and doing so
 * would require OCR/ML we've deliberately decided not to build. This script only processes
 * electronic filings.
 *
 * Usage:
 *   node scripts/build-senate-net-worth.js [--bioguide=X] [--year=2024] [--concurrency=4] [--dry-run] [--force]
 *
 * Idempotent: already-loaded (bioguide, year) pairs are skipped unless --force.
 */

require('dotenv/config');

const { Pool } = require('pg');
const { createSenateSession, stripHtml } = require('./senate-efd-common');

const args = {};
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--bioguide=')) args.bioguide = arg.split('=')[1];
  else if (arg.startsWith('--year=')) args.year = Number(arg.split('=')[1]);
  else if (arg.startsWith('--concurrency=')) args.concurrency = Number(arg.split('=')[1]);
  else if (arg === '--dry-run') args.dryRun = true;
  else if (arg === '--force') args.force = true;
}
const CONCURRENCY = args.concurrency ?? 4;

function cookieHeader(cookieJar) {
  return Object.entries(cookieJar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function fetchAnnualFilingHtml(session, viewerUrl) {
  const res = await fetch(viewerUrl, {
    headers: {
      cookie: cookieHeader(session.cookieJar),
      referer: 'https://efdsearch.senate.gov/search/',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Senate filing page request failed: ${res.status}`);
  return res.text();
}

// Isolate the HTML between a "Part N. <Title>" heading and the next "Part" heading.
function extractSection(html, sectionTitle) {
  const startMatch = html.match(new RegExp(`<h3[^>]*>\\s*${sectionTitle}\\s*<\\/h3>`, 'i'));
  if (!startMatch) return null;
  const start = startMatch.index + startMatch[0].length;
  const nextHeading = html.slice(start).match(/<h3[^>]*>\s*Part\s+\d/i);
  const end = nextHeading ? start + nextHeading.index : html.length;
  return html.slice(start, end);
}

// Each row's earliest "$lo - $hi" cell is its value (Assets: the Value column, which precedes
// the also-money-shaped Income column; Liabilities: the Amount column, the only one present).
function sumRowValues(sectionHtml) {
  if (!sectionHtml) return 0;
  const rowRegex = /<tr class="nowrap">([\s\S]*?)<\/tr>/g;
  let total = 0;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(sectionHtml))) {
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const cellText = stripHtml(cellMatch[1]);
      const rangeMatch = cellText.match(/\$([\d,]+)\s*-\s*\$([\d,]+)/);
      if (rangeMatch) {
        const lo = Number(rangeMatch[1].replace(/,/g, ''));
        const hi = Number(rangeMatch[2].replace(/,/g, ''));
        total += (lo + hi) / 2;
        break;
      }
    }
  }
  return total;
}

function parseNetWorthFromAnnualHtml(html) {
  const assetsSection = extractSection(html, 'Part\\s+3\\.\\s+Assets');
  const liabilitiesSection = extractSection(html, 'Part\\s+7\\.\\s+Liabilities');
  const totalAssets = sumRowValues(assetsSection);
  const totalLiabilities = sumRowValues(liabilitiesSection);
  return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
}

async function run() {
  const connStr =
    process.env.TRADING_STORAGE_POSTGRES_URL ||
    process.env.TRADING_STORAGE_PRISMA_DATABASE_URL ||
    process.env.POSTGRES_URL;
  if (!connStr) throw new Error('Missing TRADING_STORAGE_POSTGRES_URL');

  const pool = new Pool({ connectionString: connStr });

  try {
    const existingRes = await pool.query(`SELECT bioguide, year FROM member_net_worth`);
    const existing = new Set(existingRes.rows.map((r) => `${r.bioguide}:${r.year}`));
    console.log(`Already loaded: ${existing.size} (bioguide, year) pairs`);

    let query = `
      SELECT DISTINCT ON (bioguide, filing_year)
        bioguide, filing_year AS year, doc_id, source_url
      FROM annual_financial_disclosures
      WHERE bioguide IS NOT NULL
        AND filing_type = 'SENATE_ANNUAL'
        AND source_url LIKE '%/view/annual/%'
    `;
    const params = [];
    if (args.bioguide) { params.push(args.bioguide); query += ` AND bioguide = $${params.length}`; }
    if (args.year) { params.push(args.year); query += ` AND filing_year = $${params.length}`; }
    query += ` ORDER BY bioguide, filing_year, filing_date DESC NULLS LAST`;

    const rowsRes = await pool.query(query, params);
    let rows = rowsRes.rows;

    if (!args.force) {
      rows = rows.filter((r) => !existing.has(`${r.bioguide}:${r.year}`));
    }

    console.log(`Rows to process: ${rows.length}`);
    if (args.dryRun) {
      console.log('[dry-run] First 10:', rows.slice(0, 10).map((r) => `${r.bioguide}/${r.year}`).join(', '));
      return;
    }

    const session = await createSenateSession();
    let ok = 0, skip = 0, err = 0;
    const total = rows.length;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (row) => {
        try {
          const html = await fetchAnnualFilingHtml(session, row.source_url);
          const { totalAssets, totalLiabilities, netWorth } = parseNetWorthFromAnnualHtml(html);

          if (totalAssets === 0 && totalLiabilities === 0) {
            process.stdout.write(`  [skip] ${row.bioguide} ${row.year} (no assets or liabilities parsed)\n`);
            skip++;
            return;
          }

          await pool.query(
            `INSERT INTO member_net_worth (bioguide, year, net_worth, doc_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (bioguide, year) DO UPDATE
               SET net_worth = EXCLUDED.net_worth, doc_id = EXCLUDED.doc_id, updated_at = NOW()`,
            [row.bioguide, row.year, netWorth, row.doc_id]
          );
          await pool.query(
            `UPDATE annual_financial_disclosures
             SET total_assets = $1, total_liabilities = $2, net_worth = $3, net_worth_parsed_at = NOW()
             WHERE doc_id = $4`,
            [totalAssets, totalLiabilities, netWorth, row.doc_id]
          );

          process.stdout.write(`  [ok] ${row.bioguide} ${row.year} nw=$${Math.round(netWorth / 1000)}k\n`);
          ok++;
        } catch (e) {
          process.stdout.write(`  [err] ${row.bioguide} ${row.year}: ${e.message}\n`);
          err++;
        }
      }));

      const done = Math.min(i + CONCURRENCY, total);
      process.stdout.write(`--- ${done}/${total} processed (ok=${ok} skip=${skip} err=${err})\n`);
    }

    console.log(`\nDone. ok=${ok} skip=${skip} err=${err}`);
  } finally {
    await pool.end();
  }
}

run().catch((e) => { console.error('Fatal:', e.message); process.exit(1); });

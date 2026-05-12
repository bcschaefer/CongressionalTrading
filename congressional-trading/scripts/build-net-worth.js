#!/usr/bin/env node
/**
 * Build member_net_worth table from scratch.
 *
 * For each unique (bioguide, year) pair in annual_financial_disclosures
 * (House rows only, bioguide must be non-null), fetch the PDF, sum all
 * asset ranges and liability ranges, compute net worth, and upsert into
 * member_net_worth.
 *
 * Usage:
 *   node scripts/build-net-worth.js [--bioguide=X] [--year=2024] [--concurrency=6] [--dry-run]
 *
 * Idempotent: already-loaded (bioguide, year) pairs are skipped unless --force.
 */

require('dotenv/config');

const { Pool } = require('pg');
const pdfParseModule = require('pdf-parse/lib/pdf-parse.js');
const parsePdf = pdfParseModule.default ?? pdfParseModule;

// ---------- arg parsing ----------
const args = {};
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith('--bioguide=')) args.bioguide = arg.split('=')[1];
  else if (arg.startsWith('--year=')) args.year = Number(arg.split('=')[1]);
  else if (arg.startsWith('--concurrency=')) args.concurrency = Number(arg.split('=')[1]);
  else if (arg === '--dry-run') args.dryRun = true;
  else if (arg === '--force') args.force = true;
}
const CONCURRENCY = args.concurrency ?? 6;

// ---------- PDF fetch ----------
async function fetchPdfText(docId, filingYear) {
  const url = `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${filingYear}/${docId}.pdf`;
  let res;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  } catch (e) {
    throw new Error(`Fetch error: ${e.message}`);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const result = await parsePdf(buf);
  return result?.text ?? '';
}

// ---------- Parse net worth from PDF text ----------
// Section A: assets — each asset has a type-code bracket [XX] right before its value range.
// Section D: liabilities — all $X-$Y ranges are liability amounts.
//
// IMPORTANT: pdf-parse embeds null bytes (\x00) in some PDFs — strip them first.
//
// In Section A: we anchor on the asset type-code bracket [ST], [RP], [BA], [OL], etc.
// Immediately after the bracket: optional owner code (JT|SP|DC|Self), then $LO - $HI.
// The range may span two lines ($LO -\n$HI) or the type bracket may be on its own line
// with the value on the next line.

function parseNetWorthFromText(rawText) {
  // Strip null bytes embedded by pdf-parse in ligature/glyph sequences
  const text = rawText.replace(/\x00/g, '');
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  let totalAssets = 0;
  let totalLiabilities = 0;

  // Locate section boundaries
  let secAStart = -1, secAEnd = -1;
  let secDStart = -1, secDEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^S A:/i.test(l) && secAStart === -1) { secAStart = i; continue; }
    if (/^S D:/i.test(l) && secDStart === -1) { secDStart = i; continue; }
    if (/^S [A-Z]:/i.test(l)) {
      if (secAStart !== -1 && secAEnd === -1) secAEnd = i;
      if (secDStart !== -1 && secDEnd === -1) secDEnd = i;
    }
  }
  if (secAStart === -1) return { totalAssets: 0, totalLiabilities: 0, netWorth: 0 };
  if (secAEnd === -1) secAEnd = lines.length;
  if (secDStart === -1) { secDStart = lines.length; secDEnd = lines.length; }
  if (secDEnd === -1) secDEnd = lines.length;

  // ---- Section A: Assets ----
  // Anchor on type-code brackets [XX] (2-4 uppercase letters in brackets).
  // After the bracket: optional owner (JT|SP|DC|Self) then $LO - $HI or $LO -\n$HI.
  const TYPE_BRACKET = /\[[A-Z]{2,4}\]/;

  for (let i = secAStart + 1; i < secAEnd; i++) {
    const line = lines[i];
    const typeM = TYPE_BRACKET.exec(line);
    if (!typeM) continue; // skip income, location, description, name-wrap lines

    const after = line.slice(typeM.index + typeM[0].length);

    // Full range on same line: (owner?)$LO - $HI
    const fullM = after.match(/^(?:(?:JT|SP|DC|Self)\s*)?\$([\d,]+)\s*-\s*\$([\d,]+)/);
    if (fullM) {
      totalAssets += (Number(fullM[1].replace(/,/g, '')) + Number(fullM[2].replace(/,/g, ''))) / 2;
      continue;
    }

    // Split range on same line: (owner?)$LO -  (next line has $HI)
    const splitM = after.match(/^(?:(?:JT|SP|DC|Self)\s*)?\$([\d,]+)\s*-\s*$/);
    if (splitM) {
      const lo = Number(splitM[1].replace(/,/g, ''));
      if (i + 1 < secAEnd) {
        const hiM = lines[i + 1].match(/^\$([\d,]+)/);
        if (hiM) { totalAssets += (lo + Number(hiM[1].replace(/,/g, ''))) / 2; i++; continue; }
      }
      totalAssets += lo; // fallback
      continue;
    }

    // Type bracket alone — value is on the next line(s)
    if (i + 1 < secAEnd) {
      i++;
      const nextLine = lines[i];
      const ownerM = nextLine.match(/^(?:(?:JT|SP|DC|Self)\s*)?\$([\d,]+)\s*-\s*(?:\$([\d,]+))?/);
      if (ownerM) {
        const lo = Number(ownerM[1].replace(/,/g, ''));
        if (ownerM[2]) {
          totalAssets += (lo + Number(ownerM[2].replace(/,/g, ''))) / 2;
        } else if (i + 1 < secAEnd) {
          const hiM = lines[i + 1].match(/^\$([\d,]+)/);
          if (hiM) { totalAssets += (lo + Number(hiM[1].replace(/,/g, ''))) / 2; i++; }
          else { totalAssets += lo; }
        } else {
          totalAssets += lo;
        }
      } else {
        i--; // couldn't parse — step back
      }
    }
  }

  // ---- Section D: Liabilities ----
  // All $X - $Y ranges (inline or split) are liability amounts.
  let liabPendingLo = null;
  for (let i = secDStart + 1; i < secDEnd; i++) {
    const line = lines[i];
    if (/^(?:L:|D:|C:|Filing ID)/i.test(line)) { liabPendingLo = null; continue; }

    // Full inline range
    const fullM = line.match(/\$([\d,]+)\s*-\s*\$([\d,]+)/);
    if (fullM) {
      totalLiabilities += (Number(fullM[1].replace(/,/g, '')) + Number(fullM[2].replace(/,/g, ''))) / 2;
      liabPendingLo = null;
      continue;
    }
    // Split start: ends with "$X -"
    const splitM = line.match(/\$([\d,]+)\s*-\s*$/);
    if (splitM) { liabPendingLo = Number(splitM[1].replace(/,/g, '')); continue; }
    // Pending hi: standalone "$Y"
    if (liabPendingLo !== null) {
      const hiM = line.match(/^\$([\d,]+)$/);
      if (hiM) {
        totalLiabilities += (liabPendingLo + Number(hiM[1].replace(/,/g, ''))) / 2;
        liabPendingLo = null;
        continue;
      }
    }
    liabPendingLo = null;
  }

  return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
}

// ---------- main ----------
async function run() {
  const connStr =
    process.env.TRADING_STORAGE_POSTGRES_URL ||
    process.env.TRADING_STORAGE_PRISMA_DATABASE_URL ||
    process.env.POSTGRES_URL;
  if (!connStr) throw new Error('Missing TRADING_STORAGE_POSTGRES_URL');

  const pool = new Pool({ connectionString: connStr });

  try {
    // Already loaded pairs (skip unless --force)
    const existingRes = await pool.query(`SELECT bioguide, year FROM member_net_worth`);
    const existing = new Set(existingRes.rows.map(r => `${r.bioguide}:${r.year}`));
    console.log(`Already loaded: ${existing.size} (bioguide, year) pairs`);

    // Fetch candidate rows: House-only, bioguide non-null, one row per (bioguide, year) — newest doc_id
    let query = `
      SELECT DISTINCT ON (bioguide, filing_year)
        bioguide, filing_year AS year, doc_id
      FROM annual_financial_disclosures
      WHERE bioguide IS NOT NULL
        AND doc_id NOT LIKE 'SENATE-%'
    `;
    const params = [];
    if (args.bioguide) { params.push(args.bioguide); query += ` AND bioguide = $${params.length}`; }
    if (args.year)     { params.push(args.year);      query += ` AND filing_year = $${params.length}`; }
    query += ` ORDER BY bioguide, filing_year, filing_date DESC NULLS LAST`;

    const rowsRes = await pool.query(query, params);
    let rows = rowsRes.rows;

    // Skip already-loaded unless --force
    if (!args.force) {
      rows = rows.filter(r => !existing.has(`${r.bioguide}:${r.year}`));
    }

    console.log(`Rows to process: ${rows.length}`);
    if (args.dryRun) {
      console.log('[dry-run] First 10:', rows.slice(0, 10).map(r => `${r.bioguide}/${r.year}`).join(', '));
      await pool.end();
      return;
    }

    let ok = 0, skip = 0, err = 0;
    const total = rows.length;

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      const batch = rows.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async row => {
        try {
          const text = await fetchPdfText(row.doc_id, row.year);
          if (!text || text.trim().length < 100) {
            // Image-only PDF
            process.stdout.write(`  [skip] ${row.bioguide} ${row.year} (image PDF)\n`);
            skip++;
            return;
          }
          const { totalAssets, totalLiabilities, netWorth } = parseNetWorthFromText(text);
          if (totalAssets === 0 && totalLiabilities === 0) {
            process.stdout.write(`  [skip] ${row.bioguide} ${row.year} (no data parsed)\n`);
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

run().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

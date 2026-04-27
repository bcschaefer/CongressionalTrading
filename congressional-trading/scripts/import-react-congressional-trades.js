#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
require("dotenv/config");

const Database = require("better-sqlite3");
const { Client } = require("pg");

const SOURCE_SQLITE =
  process.argv[2] ||
  "/Users/benjaminschaefer/Downloads/react_congressional_trades-2026-04-01.db";

const POSTGRES_URL =
  process.env.TRADING_STORAGE_POSTGRES_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL;

if (!POSTGRES_URL || !POSTGRES_URL.startsWith("postgres")) {
  console.error(
    "Missing direct Postgres URL. Set TRADING_STORAGE_POSTGRES_URL (or POSTGRES_URL) in .env."
  );
  process.exit(1);
}

const TABLE_ORDER = [
  "bills",
  "committees",
  "members",
  "disclosures",
  "trades",
  "committee_meetings",
  "committee_memberships",
  "bill_trade_links",
  "meeting_trades",
  "trade_performance",
];

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function importTable(pgClient, sqlite, tableName) {
  const columns = sqlite
    .prepare(`PRAGMA table_info(${quoteIdent(tableName)})`)
    .all()
    .map((c) => c.name);

  if (columns.length === 0) {
    console.log(`Skipping ${tableName}: no columns found`);
    return;
  }

  const rows = sqlite.prepare(`SELECT * FROM ${quoteIdent(tableName)}`).all();
  if (rows.length === 0) {
    console.log(`Imported 0 rows into ${tableName}`);
    return;
  }

  const colList = columns.map(quoteIdent).join(", ");
  const conflictTarget = (() => {
    if (columns.includes("id")) return "id";
    if (columns.includes("trade_id")) return "trade_id";
    if (columns.includes("event_id")) return "event_id";
    if (columns.includes("committee_id")) return "committee_id";
    if (columns.includes("bioguide")) return "bioguide";
    return null;
  })();

  const batches = chunk(rows, 250);
  for (const batch of batches) {
    const values = [];
    const tuples = [];

    for (const row of batch) {
      const placeholders = [];
      for (const col of columns) {
        values.push(row[col]);
        placeholders.push(`$${values.length}`);
      }
      tuples.push(`(${placeholders.join(", ")})`);
    }

    const conflictSql = conflictTarget
      ? ` ON CONFLICT (${quoteIdent(conflictTarget)}) DO NOTHING`
      : "";

    const sql = `INSERT INTO ${quoteIdent(tableName)} (${colList}) VALUES ${tuples.join(", ")}${conflictSql}`;
    await pgClient.query(sql, values);
  }

  console.log(`Imported ${rows.length} rows into ${tableName}`);
}

async function run() {
  const sqlite = new Database(SOURCE_SQLITE, { readonly: true });
  const pgClient = new Client({ connectionString: POSTGRES_URL });

  await pgClient.connect();

  try {
    for (const table of TABLE_ORDER) {
      await importTable(pgClient, sqlite, table);
    }
    console.log("Import complete.");
  } finally {
    sqlite.close();
    await pgClient.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
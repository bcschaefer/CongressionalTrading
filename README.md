# Congressional Trading

Congressional Trading is a Next.js app for exploring congressional financial disclosures, trades, stock activity, and member-level net worth estimates.

## Stack

- Next.js (App Router)
- React + TypeScript
- Prisma + Postgres
- D3 charts

## Local Development

1. Install dependencies:

```bash
pnpm install
```

2. Configure environment variables (at minimum one direct Postgres URL):

- TRADING_STORAGE_POSTGRES_URL
- TRADING_STORAGE_PRISMA_DATABASE_URL
- POSTGRES_URL
- DATABASE_URL (must be a postgres URL)

Optional:

- CONGRESS_API_KEY

3. Run development server:

```bash
pnpm dev
```

4. Open http://localhost:3000

## Build

```bash
pnpm build
pnpm start
```

## Data Sync Scripts

### House Sync

- Annual disclosures: `node scripts/sync-house-annual.js`
- PTR disclosures + parsed trades: `node scripts/sync-house-ptr.js`

### Senate Sync (Rewritten)

- Shared Senate client/parsers: `scripts/senate-efd-common.js`
- Annual sync: `node scripts/sync-senate-annual.js`
- PTR sync: `node scripts/sync-senate-ptr.js`

Common options:

```bash
node scripts/sync-senate-annual.js --start-date=01/01/2012 --end-date=04/30/2026
node scripts/sync-senate-ptr.js --start-date=01/01/2012 --end-date=04/30/2026
```

Notes:

- Senate eFD requires agreement + CSRF flow before querying report data.
- Electronic PTR pages can be parsed directly from `/search/view/ptr/{uuid}/`.
- Paper reports are currently skipped.

## Operational Caveat (Current)

As of 2026-04-30, the Senate endpoint `/search/report/data/` is intermittently returning HTTP 503 maintenance HTML.

Impact:

- Senate annual and PTR sync runs fail before report ingestion when this endpoint is unavailable.

When the endpoint recovers, rerun:

```bash
pnpm sync:senate:annual --start-date=01/01/2012 --end-date=04/30/2026
pnpm sync:senate:ptr --start-date=01/01/2012 --end-date=04/30/2026
```

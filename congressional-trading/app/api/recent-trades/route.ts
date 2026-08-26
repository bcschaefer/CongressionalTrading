import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';

type TradeResponse = {
  id: number;
  bioguide: string;
  congressman: string;
  chamber: string | null;
  party: string | null;
  state: string | null;
  type: string;
  amount: number;
  ticker: string;
  assetName: string | null;
  date: string;
  datePublished: string | null;
  description: string;
};

// `revalidate` alone doesn't reliably re-run this route in production — Next.js can
// treat it as fully static and freeze it at whatever the last build produced. Force
// per-request execution and let the Cache-Control header below handle CDN caching.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limitParam = searchParams.get('limit');
    const offsetParam = searchParams.get('offset');
    const limit = limitParam ? Number.parseInt(limitParam, 10) : null;
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0;

    // A handful of disclosures have corrupted trade_date values from PDF parsing
    // (e.g. "3031-04-30", "2220-04-07") — exclude anything outside a sane range.
    const todayIso = new Date().toISOString().slice(0, 10);
    const isSaneDate = (date: string) => date >= '2000-01-01' && date <= todayIso;

    // Filtering/sorting/pagination pushed into the query itself instead of fetching
    // every trade in the database on every request and doing this in JS — this
    // previously pulled the entire disclosures+trades+members join (tens of
    // thousands of rows) for every homepage load and every "Load more" click.
    //
    // Trade-off: this drops the previous fallback that synthesized a pseudo-trade
    // for disclosures with zero parsed trade rows (using the disclosure's own
    // ticker/amount_range/trade_date) — those are disclosures where line-item
    // parsing failed entirely, and folding them into the same paginated, sorted
    // query as real trades isn't expressible without a much costlier query. That
    // fallback also covered a trade with a null `amount` by parsing the
    // disclosure's amount_range string; trades.amount is reliably populated by the
    // sync pipeline in practice, so this is a minor, acceptable narrowing.
    const where: Prisma.tradesWhereInput = {
      amount: { gt: 0 },
      trade_date: { gte: '2000-01-01', lte: todayIso },
      OR: [{ ticker: { not: null } }, { asset_name: { not: null } }, { disclosures: { ticker: { not: null } } }],
    };

    const [total, tradeRows] = await Promise.all([
      prisma.trades.count({ where }),
      prisma.trades.findMany({
        where,
        orderBy: [{ trade_date: 'desc' }, { id: 'desc' }],
        ...(limit != null ? { skip: offset, take: limit } : {}),
        include: { disclosures: { include: { members: true } } },
      }),
    ]);

    const trades: TradeResponse[] = tradeRows.flatMap((trade) => {
      const row = trade.disclosures;
      // Schema allows a trade with no parent disclosure, but the sync pipeline never
      // actually creates one that way — skip defensively rather than crash.
      if (!row) return [];
      return [{
        id: trade.id,
        bioguide: row.bioguide,
        congressman: row.members.full_name,
        chamber: row.members.chamber ?? null,
        party: row.members.party ?? null,
        state: row.members.state ?? null,
        type: (trade.trade_type ?? row.transaction_type ?? 'UNKNOWN').toUpperCase(),
        amount: trade.amount ?? 0,
        // Only fall back to the disclosure-level ticker guess when this trade has no
        // per-trade data at all — an asset_name with no ticker is itself a real,
        // trustworthy "no ticker" signal (a bond, structured note, etc.) and must not
        // be overridden by the disclosure's (often stale/first-trade-only) ticker.
        ticker: trade.ticker ?? (trade.asset_name ? null : row.ticker) ?? 'N/A',
        assetName: trade.asset_name ?? null,
        date: trade.trade_date ?? row.trade_date ?? '',
        datePublished: row.filed_date && isSaneDate(row.filed_date) ? row.filed_date : null,
        description: row.sector ? `${row.sector} disclosure` : 'Disclosure filing',
      }];
    });

    return NextResponse.json({ trades, total }, {
      // Trades only change once a day via the sync cron — cache generously so
      // repeat visits within the window are served from the edge, not the DB.
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error('Failed to fetch recent trades', error);
    return NextResponse.json(
      { error: 'Failed to fetch recent trades' },
      { status: 500 }
    );
  }
}

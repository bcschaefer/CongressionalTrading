import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type TradeResponse = {
  id: number;
  bioguide: string;
  congressman: string;
  chamber: string | null;
  party: string | null;
  type: string;
  amount: number;
  ticker: string;
  assetName: string | null;
  date: string;
  datePublished: string | null;
  description: string;
};

function parseAmountRange(amountRange: string | null): number {
  if (!amountRange) {
    return 0;
  }

  const values = amountRange
    .replace(/[$,]/g, '')
    .split(' - ')
    .map((value) => Number.parseFloat(value.trim()))
    .filter((value) => Number.isFinite(value));

  if (values.length === 0) {
    return 0;
  }

  if (values.length === 1) {
    return values[0];
  }

  return (values[0] + values[1]) / 2;
}

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

    const rows = await prisma.disclosures.findMany({
      orderBy: {
        id: 'desc',
      },
      include: {
        members: true,
        trades: {
          orderBy: {
            id: 'desc',
          },
        },
      },
    });

    const allTrades: TradeResponse[] = rows.flatMap((row: (typeof rows)[number]) => {
      if (row.trades.length === 0) {
        return [
          {
            id: row.id,
            bioguide: row.bioguide,
            congressman: row.members.full_name,
            chamber: row.members.chamber ?? null,
            party: row.members.party ?? null,
            type: (row.transaction_type ?? 'UNKNOWN').toUpperCase(),
            amount: parseAmountRange(row.amount_range),
            ticker: row.ticker ?? 'N/A',
            assetName: null,
            date: row.trade_date ?? '',
            datePublished: row.filed_date ?? null,
            description: row.sector ? `${row.sector} disclosure` : 'Disclosure filing',
          } satisfies TradeResponse,
        ];
      }

      return row.trades.map((trade: (typeof row.trades)[number]): TradeResponse => ({
        id: trade.id,
        bioguide: row.bioguide,
        congressman: row.members.full_name,
        chamber: row.members.chamber ?? null,
        party: row.members.party ?? null,
        type: (trade.trade_type ?? row.transaction_type ?? 'UNKNOWN').toUpperCase(),
        amount: trade.amount ?? parseAmountRange(row.amount_range),
        ticker: trade.ticker ?? row.ticker ?? 'N/A',
        assetName: trade.asset_name ?? null,
        date: trade.trade_date ?? row.trade_date ?? '',
        datePublished: row.filed_date ?? null,
        description: row.sector ? `${row.sector} disclosure` : 'Disclosure filing',
      }));
    });
    // A handful of disclosures have corrupted trade_date values from PDF parsing
    // (e.g. "3031-04-30", "2220-04-07") — exclude anything outside a sane range.
    const todayIso = new Date().toISOString().slice(0, 10);
    const isSaneDate = (date: string) => date >= '2000-01-01' && date <= todayIso;

    const trades = allTrades
      .filter(
        (trade: TradeResponse) =>
          (trade.ticker !== 'N/A' || trade.assetName) && trade.amount > 0 && isSaneDate(trade.date)
      )
      .map((trade: TradeResponse) => ({
        ...trade,
        datePublished: trade.datePublished && isSaneDate(trade.datePublished) ? trade.datePublished : null,
      }))
      // Most recently traded first — `id desc` (insertion order) is only a rough
      // proxy for that, so sort on the real trade date explicitly.
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id));

    const total = trades.length;
    const page = limit != null ? trades.slice(offset, offset + limit) : trades;

    return NextResponse.json({ trades: page, total }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
    });
  } catch (error) {
    console.error('Failed to fetch recent trades', error);
    return NextResponse.json(
      { error: 'Failed to fetch recent trades' },
      { status: 500 }
    );
  }
}

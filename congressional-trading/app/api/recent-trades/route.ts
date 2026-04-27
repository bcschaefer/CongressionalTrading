import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

type TradeResponse = {
  id: number;
  bioguide: string;
  congressman: string;
  type: string;
  amount: number;
  ticker: string;
  date: string;
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

export const revalidate = 300; // cache for 5 minutes

export async function GET() {
  try {
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

    const trades: TradeResponse[] = rows
      .flatMap((row) => {
        if (row.trades.length === 0) {
          return [
            {
              id: row.id,
              bioguide: row.bioguide,
              congressman: row.members.full_name,
              type: (row.transaction_type ?? 'UNKNOWN').toUpperCase(),
              amount: parseAmountRange(row.amount_range),
              ticker: row.ticker ?? 'N/A',
              date: row.trade_date ?? '',
              description: row.sector ? `${row.sector} disclosure` : 'Disclosure filing',
            },
          ];
        }

        return row.trades.map((trade) => ({
          id: trade.id,
          bioguide: row.bioguide,
          congressman: row.members.full_name,
          type: (trade.trade_type ?? row.transaction_type ?? 'UNKNOWN').toUpperCase(),
          amount: trade.amount ?? parseAmountRange(row.amount_range),
          ticker: trade.ticker ?? row.ticker ?? 'N/A',
          date: trade.trade_date ?? row.trade_date ?? '',
          description: row.sector ? `${row.sector} disclosure` : 'Disclosure filing',
        }));
      })
      .filter((trade) => trade.ticker !== 'N/A' && trade.amount > 0);

    return NextResponse.json({ trades }, {
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

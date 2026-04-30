import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
import { prisma } from '@/lib/prisma';

export const revalidate = 300;

export async function GET() {
  try {
    const rows = await prisma.trades.groupBy({
      by: ['ticker'],
      where: {
        ticker: { not: null },
      },
      _sum: { amount: true },
      _count: { id: true },
      orderBy: {
        _sum: { amount: 'desc' },
      },
    });

    // Also get buy/sell breakdown per ticker
    const buySell = await prisma.trades.groupBy({
      by: ['ticker', 'trade_type'],
      where: {
        ticker: { not: null },
        trade_type: { not: null },
      },
      _sum: { amount: true },
      _count: { id: true },
    });

    const buySellMap = new Map<string, { buyAmount: number; sellAmount: number; buyCount: number; sellCount: number }>();
    for (const row of buySell) {
      if (!row.ticker) continue;
      const existing = buySellMap.get(row.ticker) ?? { buyAmount: 0, sellAmount: 0, buyCount: 0, sellCount: 0 };
      const t = (row.trade_type ?? '').trim().toUpperCase();
      const isBuy = t === 'P' || t.startsWith('PURCHASE') || t.startsWith('BUY');
      const isSell = t === 'S' || t.startsWith('SALE') || t.startsWith('SELL');
      if (isBuy) {
        existing.buyAmount += row._sum.amount ?? 0;
        existing.buyCount += row._count.id;
      } else if (isSell) {
        existing.sellAmount += row._sum.amount ?? 0;
        existing.sellCount += row._count.id;
      }
      buySellMap.set(row.ticker, existing);
    }

    const filteredRows = rows.filter((r: (typeof rows)[number]) => r.ticker && r.ticker.trim() !== '');
    const stocks = filteredRows.map((r: (typeof filteredRows)[number]) => {
        const ticker = r.ticker!;
        const bs = buySellMap.get(ticker) ?? { buyAmount: 0, sellAmount: 0, buyCount: 0, sellCount: 0 };
        return {
          ticker,
          totalAmount: r._sum.amount ?? 0,
          tradeCount: r._count.id,
          buyAmount: bs.buyAmount,
          sellAmount: bs.sellAmount,
          buyCount: bs.buyCount,
          sellCount: bs.sellCount,
        };
      });

    return NextResponse.json({ stocks }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error('Failed to fetch stocks', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

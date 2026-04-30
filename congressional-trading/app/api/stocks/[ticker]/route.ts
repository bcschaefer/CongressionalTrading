import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
import { prisma } from '@/lib/prisma';
import { readLocalCache, writeLocalCache } from '@/lib/local-api-cache';
// @ts-ignore
import * as yahooFinance from 'yahoo-finance2';

export const revalidate = 300;

async function getHistoricalPrice(ticker: string, date: string): Promise<number | null> {
  try {
    const queryDate = new Date(`${date}T00:00:00`);
    const startDate = new Date(queryDate);
    startDate.setDate(startDate.getDate() - 5); // Get 5 days before to account for weekends
    const endDate = new Date(queryDate);
    endDate.setDate(endDate.getDate() + 5); // Get 5 days after

    const yf = (yahooFinance as any).default ?? (yahooFinance as any);
    const result = (await yf.historical(ticker, {
      period1: startDate,
      period2: endDate,
    })) as any[];
    if (!Array.isArray(result) || result.length === 0) return null;

    // Find the closest date to the trade date
    let closest = result[0] as any;
    let minDiff = Math.abs(new Date(closest.date as string).getTime() - queryDate.getTime());

    for (const candle of result as any[]) {
      const diff = Math.abs(new Date(candle.date as string).getTime() - queryDate.getTime());
      if (diff < minDiff) {
        minDiff = diff;
        closest = candle;
      }
    }

    return (closest.open as number | null) ?? (closest.close as number | null) ?? null;
  } catch (error) {
    console.error(`Failed to fetch price for ${ticker} on ${date}:`, error);
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const upperTicker = ticker.toUpperCase();

  try {
    const tradeRows = await prisma.trades.findMany({
      where: { ticker: upperTicker },
      orderBy: { trade_date: 'desc' },
      include: {
        disclosures: {
          include: { members: true },
        },
      },
    });

    if (tradeRows.length === 0) {
      return NextResponse.json({ error: 'Ticker not found' }, { status: 404 });
    }

    const priceRequestMap = new Map<string, Promise<number | null>>();

    const getPriceWithLocalCache = async (date: string): Promise<number | null> => {
      const priceCacheKey = `${upperTicker}:${date}`;
      const inFlight = priceRequestMap.get(priceCacheKey);
      if (inFlight) return inFlight;

      const request = (async () => {
        const cached = await readLocalCache<number>('yahoo-price-open-v1', priceCacheKey);
        if (cached != null) return cached;

        const fetched = await getHistoricalPrice(upperTicker, date);
        if (fetched != null) {
          await writeLocalCache('yahoo-price-open-v1', priceCacheKey, fetched, 86400 * 30);
        }
        return fetched;
      })();

      priceRequestMap.set(priceCacheKey, request);
      return request;
    };

    // Aggregate by member
    const memberMap = new Map<
      string,
      {
        bioguide: string;
        full_name: string;
        party: string | null;
        chamber: string | null;
        is_active: boolean;
        totalAmount: number;
        buyAmount: number;
        sellAmount: number;
        tradeCount: number;
      }
    >();

    // Process trades with price fetching
    const trades = await Promise.all(
      tradeRows.map(async (t: any) => {
        const member = t.disclosures?.members;
        const bioguide = t.disclosures?.bioguide ?? 'unknown';
        const tradeType = (t.trade_type ?? '').trim().toUpperCase();
        const isBuy = tradeType === 'P' || tradeType.startsWith('PURCHASE') || tradeType.startsWith('BUY');
        const isSell = tradeType === 'S' || tradeType.startsWith('SALE') || tradeType.startsWith('SELL');
        const amount = t.amount ?? 0;

        if (member) {
          const existing = memberMap.get(bioguide) ?? {
            bioguide,
            full_name: member.full_name,
            party: member.party,
            chamber: member.chamber,
            is_active: member.is_active,
            totalAmount: 0,
            buyAmount: 0,
            sellAmount: 0,
            tradeCount: 0,
          };
          existing.totalAmount += amount;
          existing.tradeCount += 1;
          if (isBuy) existing.buyAmount += amount;
          if (isSell) existing.sellAmount += amount;
          memberMap.set(bioguide, existing);
        }

        // Fetch missing price from yfinance, then persist so future requests avoid external calls.
        let priceStart = t.price_start;
        if (!priceStart && t.trade_date) {
          priceStart = await getPriceWithLocalCache(t.trade_date);
          if (priceStart != null) {
            await prisma.trades
              .update({
                where: { id: t.id },
                data: { price_start: priceStart },
              })
              .catch((error) => {
                console.warn(`Failed to persist price_start for trade ${t.id}:`, error);
              });
          }
        }

        return {
          id: t.id,
          trade_date: t.trade_date,
          trade_type: t.trade_type,
          amount,
          bioguide: t.disclosures?.bioguide ?? null,
          full_name: member?.full_name ?? null,
          party: member?.party ?? null,
          chamber: member?.chamber ?? null,
          price_start: priceStart,
          price_end: t.price_end,
        };
      })
    );

    const members = Array.from(memberMap.values()).sort((a, b) => b.totalAmount - a.totalAmount);

    const totalAmount = tradeRows.reduce((s: number, t: any) => s + (t.amount ?? 0), 0);
    let buyAmount = 0;
    let sellAmount = 0;
    for (const t of tradeRows) {
      const ty = (t.trade_type ?? '').trim().toUpperCase();
      if (ty === 'P' || ty.startsWith('PURCHASE') || ty.startsWith('BUY')) buyAmount += t.amount ?? 0;
      else if (ty === 'S' || ty.startsWith('SALE') || ty.startsWith('SELL')) sellAmount += t.amount ?? 0;
    }

    return NextResponse.json(
      { ticker: upperTicker, totalAmount, buyAmount, sellAmount, tradeCount: tradeRows.length, trades, members },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' } }
    );
  } catch (error) {
    console.error('Failed to fetch stock detail', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

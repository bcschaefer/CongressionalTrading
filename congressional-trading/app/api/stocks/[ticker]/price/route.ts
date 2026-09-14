import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
import { readLocalCache, writeLocalCache } from '@/lib/local-api-cache';
// @ts-ignore
import * as yahooFinance from 'yahoo-finance2';

// This endpoint intentionally never imports/queries Prisma. Switching the chart's
// date range re-fetches from here, not from the DB-backed /api/stocks/[ticker] route —
// keeping range switches from adding to Postgres operations usage.
export const dynamic = 'force-dynamic';

// yahoo-finance2 v3's default export is a class — historical()/chart() must be called
// on an instance, not the module namespace.
const YahooFinanceCtor: any = (yahooFinance as any).default ?? (yahooFinance as any);
const yf: any = new YahooFinanceCtor({ suppressNotices: ['ripHistorical'] });

const RANGE_KEYS = ['1M', '3M', '6M', 'YTD', '1Y', '5Y', 'MAX'] as const;
type RangeKey = (typeof RANGE_KEYS)[number];

function isRangeKey(value: string | null): value is RangeKey {
  return !!value && (RANGE_KEYS as readonly string[]).includes(value);
}

function rangeStart(range: RangeKey, now: Date): Date | null {
  const d = new Date(now);
  switch (range) {
    case '1M':
      d.setMonth(d.getMonth() - 1);
      return d;
    case '3M':
      d.setMonth(d.getMonth() - 3);
      return d;
    case '6M':
      d.setMonth(d.getMonth() - 6);
      return d;
    case 'YTD':
      d.setMonth(0, 1);
      return d;
    case '1Y':
      d.setFullYear(d.getFullYear() - 1);
      return d;
    case '5Y':
      d.setFullYear(d.getFullYear() - 5);
      return d;
    case 'MAX':
      return null;
  }
}

type PriceInterval = '1d' | '1wk' | '1mo';

function pickInterval(spanDays: number): PriceInterval {
  if (spanDays <= 400) return '1d';
  if (spanDays <= 365 * 10) return '1wk';
  return '1mo';
}

async function getHistoricalPriceSeries(
  ticker: string,
  startDate: Date,
  endDate: Date,
  interval: PriceInterval
): Promise<{ date: string; close: number }[]> {
  try {
    const result = (await yf.historical(ticker, {
      period1: startDate,
      period2: endDate,
      interval,
    })) as any[];

    if (!Array.isArray(result)) return [];

    return result
      .filter((candle) => candle.close != null)
      .map((candle) => ({
        date: new Date(candle.date as string).toISOString().slice(0, 10),
        close: candle.close as number,
      }));
  } catch (error) {
    console.error(`Failed to fetch price series for ${ticker}:`, error);
    return [];
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const upperTicker = ticker.toUpperCase();

  const rangeParam = req.nextUrl.searchParams.get('range');
  const range: RangeKey = isRangeKey(rangeParam) ? rangeParam : 'MAX';

  try {
    const now = new Date();
    // MAX has no fixed lower bound, but Yahoo still needs a period1 — go back far
    // enough to cover any congressional trading history (earliest disclosures ~2012).
    const start = rangeStart(range, now) ?? new Date('2010-01-01T00:00:00');
    start.setDate(start.getDate() - 7);
    const end = new Date(now);
    end.setDate(end.getDate() + 1);

    const spanDays = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
    const interval = pickInterval(spanDays);

    const cacheKey = `${upperTicker}:${range}:${start.toISOString().slice(0, 10)}:${interval}`;
    const cached = await readLocalCache<{ date: string; close: number }[]>(
      'yahoo-price-series-v2',
      cacheKey
    );

    let priceHistory: { date: string; close: number }[];
    if (cached) {
      priceHistory = cached;
    } else {
      priceHistory = await getHistoricalPriceSeries(upperTicker, start, end, interval);
      if (priceHistory.length > 0) {
        await writeLocalCache('yahoo-price-series-v2', cacheKey, priceHistory, 86400);
      }
    }

    return NextResponse.json(
      { ticker: upperTicker, range, interval, priceHistory },
      { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' } }
    );
  } catch (error) {
    console.error('Failed to fetch stock price series', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

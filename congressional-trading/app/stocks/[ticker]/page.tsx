'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import StockPriceChart from '@/app/components/StockPriceChart';
import StatCard from '@/app/components/ui/StatCard';
import Avatar from '@/app/components/ui/Avatar';
import GradientRule from '@/app/components/ui/GradientRule';
import { partyInitial } from '@/lib/party';

type Trade = {
  id: number;
  trade_date: string | null;
  trade_type: string | null;
  amount: number;
  bioguide: string | null;
  full_name: string | null;
  party: string | null;
  chamber: string | null;
  price_start: number | null;
  price_end: number | null;
};

type MemberSummary = {
  bioguide: string;
  full_name: string;
  party: string | null;
  chamber: string | null;
  is_active: boolean;
  totalAmount: number;
  buyAmount: number;
  sellAmount: number;
  tradeCount: number;
};

type PricePoint = { date: string; close: number };

type StockDetail = {
  ticker: string;
  totalAmount: number;
  buyAmount: number;
  sellAmount: number;
  tradeCount: number;
  trades: Trade[];
  members: MemberSummary[];
  priceHistory: PricePoint[];
  priceInterval: '1d' | '1wk' | '1mo' | null;
};

function formatMoney(amount: number) {
  if (amount >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function formatDate(date: string | null) {
  if (!date) return '—';
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

function tradeDirection(type: string | null): 'buy' | 'sell' | 'other' {
  const t = (type ?? '').trim().toUpperCase();
  if (t === 'P' || t.startsWith('PURCHASE') || t.startsWith('BUY')) return 'buy';
  if (t === 'S' || t.startsWith('SALE') || t.startsWith('SELL')) return 'sell';
  return 'other';
}

export default function StockDetailPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const router = useRouter();
  const [data, setData] = useState<StockDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [tradeFilter, setTradeFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [yearRange, setYearRange] = useState<{ start: number | null; end: number | null }>({ start: null, end: null });

  useEffect(() => {
    if (!ticker) return;
    fetch(`/api/stocks/${ticker.toUpperCase()}`)
      .then(async (r) => {
        if (!r.ok) { setNotFound(true); setLoading(false); return; }
        const json = await r.json();
        if (!json || !Array.isArray(json.trades)) { setNotFound(true); setLoading(false); return; }
        setData(json);
        // Derive the initial full year range from the same response instead of a
        // second effect reacting to `data` — one fewer render, and avoids setState
        // synchronously inside an effect body.
        const years = Array.from(
          new Set(
            (json.trades as Trade[])
              .filter((t) => t.trade_date)
              .map((t) => new Date(`${t.trade_date}T00:00:00`).getFullYear())
          )
        ).sort((a, b) => a - b);
        setYearRange(years.length > 0 ? { start: years[0], end: years[years.length - 1] } : { start: null, end: null });
        setLoading(false);
      })
      .catch(() => { setNotFound(true); setLoading(false); });
  }, [ticker]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-(--color-text-muted)">Loading…</p>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white">
        <p className="text-lg font-semibold text-(--color-text-secondary)">Ticker not found</p>
        <Link href="/stocks" className="text-sm text-(--color-accent) underline">← Back to Stocks</Link>
      </div>
    );
  }

  const buyPct = data.totalAmount > 0 ? (data.buyAmount / data.totalAmount) * 100 : 0;
  const sellPct = data.totalAmount > 0 ? (data.sellAmount / data.totalAmount) * 100 : 0;

  // Get available years from trades
  const availableYears = Array.from(
    new Set(
      data.trades
        .filter((t) => t.trade_date)
        .map((t) => new Date(`${t.trade_date}T00:00:00`).getFullYear())
    )
  ).sort((a, b) => a - b);

  const minYear = availableYears[0] ?? null;
  const maxYear = availableYears[availableYears.length - 1] ?? null;
  const rangeStart = yearRange.start ?? minYear;
  const rangeEnd = yearRange.end ?? maxYear;

  const filteredTrades = data.trades.filter((t) => {
    if (tradeFilter !== 'all' && tradeDirection(t.trade_type) !== tradeFilter) return false;
    if (yearRange.start !== null && yearRange.end !== null && t.trade_date) {
      const year = new Date(`${t.trade_date}T00:00:00`).getFullYear();
      if (year < yearRange.start || year > yearRange.end) return false;
    }
    return true;
  });

  // The price line only respects the year-range filter — never the buy/sell filter,
  // since price movement isn't a function of which trades the user chose to view.
  const filteredPriceHistory = data.priceHistory.filter((p) => {
    if (yearRange.start === null || yearRange.end === null) return true;
    const year = new Date(`${p.date}T00:00:00`).getFullYear();
    return year >= yearRange.start && year <= yearRange.end;
  });

  function filterBtnClass(active: boolean): string {
    return `cursor-pointer rounded-sm border px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 ${
      active
        ? 'border-(--color-accent) bg-(--color-accent) text-white'
        : 'border-(--color-border) text-(--color-text-secondary) hover:border-(--color-accent) hover:text-(--color-accent)'
    }`;
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="px-6 pb-6 pt-6">
        <div className="mx-auto max-w-5xl">
          <Link href="/stocks" className="mb-4 inline-block text-sm text-(--color-text-secondary) transition hover:text-foreground">
            ← Back to Stocks
          </Link>
          <h1 className="font-mono text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            {data.ticker}
          </h1>
          <p className="mt-1 text-sm text-(--color-text-secondary)">{data.tradeCount} congressional trades recorded</p>

          {/* Buy/sell bar */}
          <div className="mt-4 h-2 max-w-sm overflow-hidden rounded-sm bg-(--color-bg-subtle)">
            <div className="flex h-full">
              <div className="bg-(--color-positive)" style={{ width: `${buyPct}%` }} />
              <div className="bg-(--color-negative)" style={{ width: `${sellPct}%` }} />
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            <span className="text-(--color-positive)">↑ {buyPct.toFixed(0)}% buys</span>
            <span className="text-(--color-negative)">↓ {sellPct.toFixed(0)}% sells</span>
          </div>
        </div>
      </div>
      <GradientRule />

      <div className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-6 sm:px-6">
        {/* Stat cards */}
        <div className="flex flex-wrap gap-3">
          <StatCard label="Total Traded" value={formatMoney(data.totalAmount)} sub={`${data.tradeCount} trades`} />
          <StatCard
            label="Purchased"
            value={formatMoney(data.buyAmount)}
            sub={`${data.members.filter((m) => m.buyAmount > 0).length} members`}
            valueColor="var(--color-positive)"
          />
          <StatCard
            label="Sold"
            value={formatMoney(data.sellAmount)}
            sub={`${data.members.filter((m) => m.sellAmount > 0).length} members`}
            valueColor="var(--color-negative)"
          />
          <StatCard label="Members" value={String(data.members.length)} sub="traded this stock" />
        </div>

        {/* Year range filter */}
        {availableYears.length > 0 && minYear !== null && maxYear !== null && (
          <div className="flex max-w-xs flex-col gap-2 rounded-md border border-(--color-border) bg-white p-3">
            <div className="grid grid-cols-2 gap-2.5">
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-(--color-text-secondary)">Start</span>
                <select
                  value={rangeStart ?? minYear}
                  onChange={(e) => {
                    const nextStart = parseInt(e.target.value, 10);
                    setYearRange((prev) => {
                      const safeEnd = prev.end ?? maxYear;
                      return { start: Math.min(nextStart, safeEnd), end: safeEnd };
                    });
                  }}
                  className="rounded-sm border border-(--color-border) bg-(--color-bg-subtle) px-2.5 py-1.5 text-[13px] font-semibold text-foreground"
                >
                  {availableYears
                    .filter((year) => rangeEnd === null || year <= rangeEnd)
                    .map((year) => (
                      <option key={`start-${year}`} value={year}>
                        {year}
                      </option>
                    ))}
                </select>
              </label>

              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-(--color-text-secondary)">End</span>
                <select
                  value={rangeEnd ?? maxYear}
                  onChange={(e) => {
                    const nextEnd = parseInt(e.target.value, 10);
                    setYearRange((prev) => {
                      const safeStart = prev.start ?? minYear;
                      return { start: safeStart, end: Math.max(nextEnd, safeStart) };
                    });
                  }}
                  className="rounded-sm border border-(--color-border) bg-(--color-bg-subtle) px-2.5 py-1.5 text-[13px] font-semibold text-foreground"
                >
                  {availableYears
                    .filter((year) => rangeStart === null || year >= rangeStart)
                    .map((year) => (
                      <option key={`end-${year}`} value={year}>
                        {year}
                      </option>
                    ))}
                </select>
              </label>
            </div>
          </div>
        )}

        {/* Trade type filter */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-semibold text-(--color-text-secondary)">Filter by type:</span>
          <button onClick={() => setTradeFilter('all')} className={filterBtnClass(tradeFilter === 'all')}>
            All
          </button>
          <button onClick={() => setTradeFilter('buy')} className={filterBtnClass(tradeFilter === 'buy')}>
            Buys Only
          </button>
          <button onClick={() => setTradeFilter('sell')} className={filterBtnClass(tradeFilter === 'sell')}>
            Sells Only
          </button>
        </div>

        {/* Price chart */}
        <StockPriceChart
          ticker={data.ticker}
          priceHistory={filteredPriceHistory}
          priceInterval={data.priceInterval}
          trades={filteredTrades}
        />

        {/* Members who traded */}
        <div>
          {/* Get members who traded in filtered period */}
          {(() => {
            const filteredMemberBioguides = new Set(filteredTrades.map((t) => t.bioguide));
            const filteredMembers = data.members.filter((m) => filteredMemberBioguides.has(m.bioguide));
            return (
              <div className="overflow-hidden rounded-md border border-(--color-border) bg-white">
                {filteredMembers.length === 0 ? (
                  <p className="py-8 text-center text-sm text-(--color-text-muted)">No member data.</p>
                ) : (
                  <div className="max-h-100 divide-y divide-(--color-border) overflow-y-auto">
                    {filteredMembers.map((m) => (
                      <button
                        key={m.bioguide}
                        onClick={() => router.push(`/congressman/${m.bioguide}`)}
                        className="flex w-full cursor-pointer flex-wrap items-center gap-2.5 px-3.5 py-2.5 text-left transition-colors duration-150 hover:bg-(--color-bg-subtle)"
                      >
                        <Avatar name={m.full_name} party={m.party} size="sm" />
                        <span className="min-w-0 flex-[1_1_100%] text-sm font-medium text-foreground sm:flex-1">{m.full_name}</span>
                        <div className="flex w-full flex-shrink-0 flex-wrap items-center gap-2.5 sm:ml-auto sm:w-auto">
                          {m.buyAmount > 0 && (
                            <span className="text-xs font-semibold text-(--color-positive)">↑ {formatMoney(m.buyAmount)}</span>
                          )}
                          {m.sellAmount > 0 && (
                            <span className="text-xs font-semibold text-(--color-negative)">↓ {formatMoney(m.sellAmount)}</span>
                          )}
                          <span className="text-xs text-(--color-text-secondary)">{partyInitial(m.party)}</span>
                          <span className="text-[11px] text-(--color-text-muted)">{m.tradeCount} trade{m.tradeCount !== 1 ? 's' : ''}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        {/* Trade history */}
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-base font-bold text-foreground">Trade History</h2>
            <button className={filterBtnClass(tradeFilter === 'all')} onClick={() => setTradeFilter('all')}>All</button>
            <button className={filterBtnClass(tradeFilter === 'buy')} onClick={() => setTradeFilter('buy')}>Buys</button>
            <button className={filterBtnClass(tradeFilter === 'sell')} onClick={() => setTradeFilter('sell')}>Sells</button>
            <span className="ml-auto text-xs text-(--color-text-muted)">{filteredTrades.length} trades</span>
          </div>
          <div className="overflow-hidden rounded-md border border-(--color-border) bg-white">
            {filteredTrades.length === 0 ? (
              <p className="py-8 text-center text-sm text-(--color-text-muted)">No trades.</p>
            ) : (
              <div className="max-h-120 overflow-auto">
                <table className="w-full min-w-140 border-collapse">
                  <thead className="sticky top-0 bg-(--color-bg-subtle)">
                    <tr className="border-b border-(--color-border)">
                      <th className="px-3.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Date</th>
                      <th className="px-3.5 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Member</th>
                      <th className="px-3.5 py-2 text-center text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Type</th>
                      <th className="px-3.5 py-2 text-right text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-border)">
                    {filteredTrades.map((t) => {
                      const dir = tradeDirection(t.trade_type);
                      const dirColor = dir === 'buy' ? 'var(--color-positive)' : dir === 'sell' ? 'var(--color-negative)' : 'var(--color-text-muted)';
                      return (
                        <tr key={t.id} className="transition-colors duration-150 hover:bg-(--color-bg-subtle)">
                          <td className="px-3.5 py-2.5 font-mono text-xs text-(--color-text-secondary)">{formatDate(t.trade_date)}</td>
                          <td className="px-3.5 py-2.5">
                            <button
                              onClick={() => t.bioguide && router.push(`/congressman/${t.bioguide}`)}
                              className="text-left text-[13px] font-medium transition-colors hover:underline"
                              style={{ color: dirColor, cursor: t.bioguide ? 'pointer' : 'default' }}
                            >
                              {t.full_name ?? '—'}
                            </button>
                          </td>
                          <td className="px-3.5 py-2.5 text-center text-[11px] font-bold" style={{ color: dirColor }}>
                            {dir === 'buy' ? '↑ BUY' : dir === 'sell' ? '↓ SELL' : t.trade_type ?? '—'}
                          </td>
                          <td className="px-3.5 py-2.5 text-right text-[13px] font-semibold text-foreground">
                            {formatMoney(t.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

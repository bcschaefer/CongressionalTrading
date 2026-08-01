'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import GradientRule from '@/app/components/ui/GradientRule';

type Stock = {
  ticker: string;
  totalAmount: number;
  tradeCount: number;
  buyAmount: number;
  sellAmount: number;
  buyCount: number;
  sellCount: number;
};

type SortKey = 'totalAmount' | 'tradeCount' | 'buyAmount' | 'sellAmount';

function formatMoney(amount: number) {
  if (amount >= 1_000_000_000)
    return `$${(amount / 1_000_000_000).toFixed(1)}B`;
  if (amount >= 1_000_000)
    return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000)
    return `$${(amount / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

export default function StocksPage() {
  const router = useRouter();
  const [stocks, setStocks] = useState<Stock[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('totalAmount');

  useEffect(() => {
    fetch('/api/stocks')
      .then((r) => r.json())
      .then((data) => {
        setStocks(data.stocks ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    return stocks
      .filter((s) => {
        if (q && !s.ticker.includes(q)) return false;
        return true;
      })
      .sort((a, b) => b[sortKey] - a[sortKey]);
  }, [stocks, query, sortKey]);

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
          <Link href="/" className="mb-4 inline-block text-sm text-(--color-text-secondary) transition hover:text-foreground">
            ← Back to home
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Stocks Congress Trades</h1>
          <p className="mt-2 max-w-xl text-sm text-(--color-text-secondary)">
            Every ticker bought or sold by a member of Congress, based on their disclosures.
          </p>
          <p className="mt-1 text-xs text-(--color-text-muted)">
            {loading ? '…' : `${stocks.length} tickers traded by Congress`}
          </p>

          {/* Search */}
          <div className="mt-5">
            <input
              type="text"
              placeholder="Search ticker symbol…"
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              className="w-full max-w-xs rounded-sm border border-(--color-border) px-3.5 py-2 font-mono text-sm text-foreground outline-none placeholder:text-(--color-text-muted) focus:border-(--color-accent)"
            />
          </div>
        </div>
      </div>
      <GradientRule />

      {/* Filters + list */}
      <div className="mx-auto max-w-5xl px-6 py-6">
        {/* Filter row */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <button className={filterBtnClass(sortKey === 'totalAmount')} onClick={() => setSortKey('totalAmount')}>Total Traded</button>
          <button className={filterBtnClass(sortKey === 'tradeCount')} onClick={() => setSortKey('tradeCount')}>Trade Count</button>
          <button className={filterBtnClass(sortKey === 'buyAmount')} onClick={() => setSortKey('buyAmount')}>Buy Amount</button>
          <button className={filterBtnClass(sortKey === 'sellAmount')} onClick={() => setSortKey('sellAmount')}>Sell Amount</button>
          <span className="ml-0 text-xs text-(--color-text-muted) sm:ml-auto">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-(--color-text-muted)">Loading…</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-(--color-border) bg-white">
            {filtered.length === 0 ? (
              <p className="py-12 text-center text-sm text-(--color-text-muted)">No results found.</p>
            ) : (
              <div className="divide-y divide-(--color-border)">
                {filtered.map((s, i) => {
                  const buyPct = s.totalAmount > 0 ? (s.buyAmount / s.totalAmount) * 100 : 0;
                  const sellPct = s.totalAmount > 0 ? (s.sellAmount / s.totalAmount) * 100 : 0;
                  return (
                    <button
                      key={s.ticker}
                      onMouseEnter={() => router.prefetch(`/stocks/${s.ticker}`)}
                      onFocus={() => router.prefetch(`/stocks/${s.ticker}`)}
                      onClick={() => router.push(`/stocks/${s.ticker}`)}
                      className="block w-full cursor-pointer px-5 py-3 text-left transition-colors duration-150 hover:bg-(--color-bg-subtle)"
                    >
                      <div className="flex w-full flex-wrap items-center gap-2 sm:gap-3">
                        {/* Rank */}
                        <span className="w-[22px] shrink-0 text-right text-xs text-(--color-text-muted)">
                          {i + 1}
                        </span>

                        {/* Ticker */}
                        <span className="w-16 shrink-0 font-mono text-[15px] font-bold text-foreground">
                          {s.ticker}
                        </span>

                        {/* Bar */}
                        <div className="relative h-2 min-w-25 flex-1 overflow-hidden rounded-sm bg-(--color-bg-subtle)">
                          <div className="absolute left-0 top-0 h-full rounded-l-sm bg-(--color-positive)" style={{ width: `${buyPct}%` }} />
                          <div className="absolute top-0 h-full bg-(--color-negative)" style={{ left: `${buyPct}%`, width: `${sellPct}%` }} />
                        </div>

                        {/* Amounts */}
                        <div className="ml-0 flex w-full flex-wrap items-center gap-2 shrink-0 sm:ml-auto sm:w-auto sm:gap-3">
                          <span className="min-w-0 text-left text-[13px] font-bold text-foreground sm:min-w-17.5 sm:text-right">
                            {formatMoney(s.totalAmount)}
                          </span>
                          <span className="min-w-0 text-left text-[11px] text-(--color-positive) sm:min-w-12 sm:text-right">
                            {s.buyCount > 0 ? `↑ ${formatMoney(s.buyAmount)}` : ''}
                          </span>
                          <span className="min-w-0 text-left text-[11px] text-(--color-negative) sm:min-w-12 sm:text-right">
                            {s.sellCount > 0 ? `↓ ${formatMoney(s.sellAmount)}` : ''}
                          </span>
                          <span className="min-w-0 text-left text-[11px] text-(--color-text-muted) sm:min-w-14 sm:text-right">
                            {s.tradeCount} trade{s.tradeCount !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

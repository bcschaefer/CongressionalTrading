'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import GradientRule from '@/app/components/ui/GradientRule';
import Avatar from '@/app/components/ui/Avatar';
import { partyInitial, partyTokens } from '@/lib/party';

type Trade = {
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
};

type TradeDirection = 'buy' | 'sell' | 'other';

function tradeDirection(type: string): TradeDirection {
  const t = type.trim().toUpperCase();
  if (t === 'P' || t.startsWith('PURCHASE') || t.startsWith('BUY')) return 'buy';
  if (t === 'S' || t.startsWith('SALE') || t.startsWith('SELL')) return 'sell';
  return 'other';
}

function formatMoney(amount: number) {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount);
}

function formatDate(date: string) {
  const d = new Date(`${date}T00:00:00`);
  if (Number.isNaN(d.getTime())) return date;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d);
}

function lagDays(traded: string, published: string | null): string {
  if (!published) return '—';
  const t = new Date(`${traded}T00:00:00Z`);
  const p = new Date(`${published}T00:00:00Z`);
  if (Number.isNaN(t.getTime()) || Number.isNaN(p.getTime())) return '—';
  const days = Math.round((p.getTime() - t.getTime()) / 86_400_000);
  return `${days}d`;
}

const PAGE_SIZE = 100;

export default function TradesPage() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [total, setTotal] = useState(0);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filter, setFilter] = useState<'all' | 'buy' | 'sell'>('all');
  const [query, setQuery] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoadingMore(limit > PAGE_SIZE);
    fetch(`/api/recent-trades?limit=${limit}&offset=0`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        setTrades(Array.isArray(data.trades) ? data.trades : []);
        setTotal(typeof data.total === 'number' ? data.total : 0);
        setLoading(false);
        setLoadingMore(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoading(false);
        setLoadingMore(false);
      });
    return () => {
      cancelled = true;
    };
  }, [limit]);

  const q = query.trim().toLowerCase();
  const filtered = trades.filter((t) => {
    if (filter !== 'all' && tradeDirection(t.type) !== filter) return false;
    if (!q) return true;
    return (
      t.congressman.toLowerCase().includes(q) ||
      (t.ticker !== 'N/A' && t.ticker.toLowerCase().includes(q)) ||
      (t.assetName ?? '').toLowerCase().includes(q)
    );
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
        <div className="mx-auto max-w-6xl">
          <Link href="/" className="mb-4 inline-block text-sm text-(--color-text-secondary) transition hover:text-foreground">
            ← Back to home
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Recent Trades</h1>
          <p className="mt-2 max-w-xl text-sm text-(--color-text-secondary)">
            Every disclosed congressional trade, most recent first.
          </p>
          <p className="mt-1 text-xs text-(--color-text-muted)">
            {loading ? '…' : `Showing ${filtered.length.toLocaleString()} of ${total.toLocaleString()} trades`}
          </p>

          <div className="mt-5">
            <input
              type="text"
              placeholder="Search ticker, member, asset…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full max-w-xs rounded-sm border border-(--color-border) px-3.5 py-2 text-sm text-foreground outline-none placeholder:text-(--color-text-muted) focus:border-(--color-accent)"
            />
          </div>
        </div>
      </div>
      <GradientRule />

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {/* Filter row */}
        <div className="mb-5 flex flex-wrap items-center gap-2">
          <button className={filterBtnClass(filter === 'all')} onClick={() => setFilter('all')}>All</button>
          <button className={filterBtnClass(filter === 'buy')} onClick={() => setFilter('buy')}>Buys Only</button>
          <button className={filterBtnClass(filter === 'sell')} onClick={() => setFilter('sell')}>Sells Only</button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-(--color-text-muted)">Loading…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-(--color-border) bg-white p-12 text-center text-sm text-(--color-text-muted)">
            No trades found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-(--color-border) bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-225 border-collapse">
                <thead className="bg-(--color-bg-subtle)">
                  <tr className="border-b border-(--color-border)">
                    <th className="px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Filer</th>
                    <th className="px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Ticker</th>
                    <th className="px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Asset</th>
                    <th className="px-3.5 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Type</th>
                    <th className="px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Amount</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Traded</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Filed</th>
                    <th className="whitespace-nowrap px-3.5 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Lag</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-(--color-border)">
                  {filtered.map((t) => {
                    const dir = tradeDirection(t.type);
                    const dirColor = dir === 'buy' ? 'var(--color-positive)' : dir === 'sell' ? 'var(--color-negative)' : 'var(--color-text-muted)';
                    return (
                      <tr key={t.id} className="transition-colors duration-150 hover:bg-(--color-bg-subtle)">
                        <td className="px-3.5 py-2.5">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={t.congressman} party={t.party} photoUrl={`/api/member-photo/${t.bioguide}`} size="sm" />
                            <div className="min-w-0">
                              <Link
                                href={`/congressman/${t.bioguide}`}
                                className="block whitespace-nowrap text-[13px] font-semibold transition-colors hover:underline"
                                style={{ color: `var(${partyTokens(t.party).text})` }}
                              >
                                {t.congressman}
                              </Link>
                              <span className="block whitespace-nowrap text-[11px] text-(--color-text-muted)">
                                {(t.chamber ?? '').toLowerCase() === 'senate' ? 'Senate' : 'House'} · {partyInitial(t.party)} · {t.state ?? '—'}
                              </span>
                            </div>
                          </div>
                        </td>
                        <td className="px-3.5 py-2.5 text-[13px]">
                          {t.ticker !== 'N/A' ? (
                            <Link
                              href={`/stocks/${t.ticker}`}
                              className="rounded-sm bg-(--color-chip-bg) px-1.5 py-0.5 font-mono text-xs font-bold text-(--color-chip-text) transition-colors hover:opacity-80"
                            >
                              {t.ticker}
                            </Link>
                          ) : (
                            <span className="text-(--color-text-muted)">—</span>
                          )}
                        </td>
                        <td className="max-w-70 truncate px-3.5 py-2.5 text-[13px] text-(--color-text-secondary)" title={t.assetName ?? undefined}>
                          {t.assetName ?? (t.ticker !== 'N/A' ? '—' : 'Other')}
                        </td>
                        <td className="px-3.5 py-2.5 text-center text-[11px] font-bold" style={{ color: dirColor }}>
                          {dir === 'buy' ? '↑ BUY' : dir === 'sell' ? '↓ SELL' : t.type}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-right text-[13px] font-semibold text-foreground">
                          {formatMoney(t.amount)}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-xs text-(--color-text-secondary)">
                          {formatDate(t.date)}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 font-mono text-xs text-(--color-text-secondary)">
                          {t.datePublished ? formatDate(t.datePublished) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-right text-xs text-(--color-text-secondary)">
                          {lagDays(t.date, t.datePublished)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && limit < total && (
          <div className="mt-5 flex justify-center">
            <button
              onClick={() => setLimit((l) => l + PAGE_SIZE)}
              disabled={loadingMore}
              className="cursor-pointer rounded-sm border border-(--color-border) px-5 py-2 text-sm font-semibold text-(--color-text-secondary) transition-colors duration-150 hover:border-(--color-accent) hover:text-(--color-accent) disabled:cursor-default disabled:opacity-50"
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

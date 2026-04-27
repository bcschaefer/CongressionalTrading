'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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

  const filterBtnBase: React.CSSProperties = {
    padding: '5px 14px',
    borderRadius: '9999px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    border: '1.5px solid transparent',
    transition: 'all 0.15s',
    lineHeight: '1.4',
  };

  function filterBtn(active: boolean, activeColor: string): React.CSSProperties {
    return active
      ? { ...filterBtnBase, background: activeColor, color: '#fff', borderColor: activeColor }
      : { ...filterBtnBase, background: '#f1f5f9', color: '#475569', borderColor: '#e2e8f0' };
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      {/* Header */}
      <div
        className="text-white"
        style={{ background: 'linear-gradient(135deg, #0f766e 0%, #0d9488 50%, #2563eb 100%)', paddingBottom: '32px' }}
      >
        <div className="mx-auto max-w-5xl px-6" style={{ paddingTop: '24px' }}>
          <Link href="/" className="inline-block text-sm text-white/70 hover:text-white mb-5 transition">
            ← Back to home
          </Link>
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-4xl font-bold tracking-tight">Stocks</h1>
              <p className="mt-1 text-white/60 text-sm">
                {loading ? '…' : `${stocks.length} tickers traded by Congress`}
              </p>
            </div>
          </div>

          {/* Search */}
          <div className="mt-6">
            <input
              type="text"
              placeholder="Search ticker symbol…"
              value={query}
              onChange={(e) => setQuery(e.target.value.toUpperCase())}
              style={{
                width: '100%',
                maxWidth: '320px',
                borderRadius: '10px',
                border: 'none',
                background: 'rgba(255,255,255,0.15)',
                color: '#fff',
                padding: '10px 16px',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
                fontFamily: 'monospace',
              }}
              className="placeholder:text-white/50 focus:bg-white/25"
            />
          </div>
        </div>
      </div>

      {/* Filters + list */}
      <div className="mx-auto max-w-5xl px-6 py-6">
        {/* Filter row */}
        <div className="flex flex-wrap gap-2 mb-5 items-center">
          {/* Sort */}
          <button style={filterBtn(sortKey === 'totalAmount', '#0f766e')} onClick={() => setSortKey('totalAmount')}>Total Traded</button>
          <button style={filterBtn(sortKey === 'tradeCount', '#0f766e')} onClick={() => setSortKey('tradeCount')}>Trade Count</button>
          <button style={filterBtn(sortKey === 'buyAmount', '#15803d')} onClick={() => setSortKey('buyAmount')}>Buy Amount</button>
          <button style={filterBtn(sortKey === 'sellAmount', '#b91c1c')} onClick={() => setSortKey('sellAmount')}>Sell Amount</button>
          <span className="ml-auto text-xs text-gray-400">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-gray-400">Loading…</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {filtered.length === 0 ? (
              <p className="text-center text-gray-400 py-12 text-sm">No results found.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {filtered.map((s, i) => {
                  const buyPct = s.totalAmount > 0 ? (s.buyAmount / s.totalAmount) * 100 : 0;
                  const sellPct = s.totalAmount > 0 ? (s.sellAmount / s.totalAmount) * 100 : 0;
                  return (
                    <button
                      key={s.ticker}
                      onClick={() => router.push(`/stocks/${s.ticker}`)}
                      className="w-full text-left hover:bg-teal-50 transition-colors cursor-pointer"
                      style={{ display: 'block', padding: '12px 20px' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        {/* Rank */}
                        <span style={{ width: '28px', textAlign: 'right', fontSize: '12px', color: '#9ca3af', flexShrink: 0 }}>
                          {i + 1}
                        </span>

                        {/* Ticker */}
                        <span style={{ width: '80px', fontWeight: 700, fontSize: '15px', fontFamily: 'monospace', color: '#111827', flexShrink: 0 }}>
                          {s.ticker}
                        </span>

                        {/* Bar */}
                        <div style={{ flex: 1, position: 'relative', height: '8px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden' }}>
                          <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${buyPct}%`, background: '#10b981', borderRadius: '4px 0 0 4px' }} />
                          <div style={{ position: 'absolute', left: `${buyPct}%`, top: 0, height: '100%', width: `${sellPct}%`, background: '#ef4444' }} />
                          {/* grey remainder */}
                          <div style={{ position: 'absolute', left: `${Math.min(buyPct + sellPct, 100)}%`, top: 0, height: '100%', width: `${Math.max(0, 100 - buyPct - sellPct)}%`, background: '#e2e8f0' }} />
                        </div>

                        {/* Amounts */}
                        <div style={{ display: 'flex', gap: '16px', alignItems: 'center', flexShrink: 0 }}>
                          <span style={{ fontSize: '13px', fontWeight: 700, color: '#111827', minWidth: '70px', textAlign: 'right' }}>
                            {formatMoney(s.totalAmount)}
                          </span>
                          <span style={{ fontSize: '11px', color: '#10b981', minWidth: '48px', textAlign: 'right' }}>
                            {s.buyCount > 0 ? `↑ ${formatMoney(s.buyAmount)}` : ''}
                          </span>
                          <span style={{ fontSize: '11px', color: '#ef4444', minWidth: '48px', textAlign: 'right' }}>
                            {s.sellCount > 0 ? `↓ ${formatMoney(s.sellAmount)}` : ''}
                          </span>
                          <span style={{ fontSize: '11px', color: '#9ca3af', minWidth: '56px', textAlign: 'right' }}>
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

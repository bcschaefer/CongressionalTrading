'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import StockPriceChart from '@/app/components/StockPriceChart';

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

type StockDetail = {
  ticker: string;
  totalAmount: number;
  buyAmount: number;
  sellAmount: number;
  tradeCount: number;
  trades: Trade[];
  members: MemberSummary[];
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

function partyColor(party: string | null): string {
  const p = (party ?? '').trim().toUpperCase();
  if (p === 'D' || p.startsWith('DEM')) return '#1d4ed8';
  if (p === 'R' || p.startsWith('REP')) return '#b91c1c';
  return '#6b7280';
}

function partyLabel(party: string | null): string {
  const p = (party ?? '').trim().toUpperCase();
  if (p === 'D' || p.startsWith('DEM')) return 'D';
  if (p === 'R' || p.startsWith('REP')) return 'R';
  if (p === 'I' || p.startsWith('IND')) return 'I';
  return party ?? '?';
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
        if (r.status === 404) { setNotFound(true); setLoading(false); return; }
        const json = await r.json();
        setData(json);
        setYearRange({ start: null, end: null });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [ticker]);

  // Initialize full year range when data loads
  useEffect(() => {
    if (!data) return;
    if (yearRange.start === null || yearRange.end === null) {
      const years = Array.from(
        new Set(
          data.trades
            .filter((t) => t.trade_date)
            .map((t) => new Date(`${t.trade_date}T00:00:00`).getFullYear())
        )
      ).sort((a, b) => a - b);
      if (years.length > 0) {
        setYearRange({ start: years[0], end: years[years.length - 1] });
      }
    }
  }, [data, yearRange.end, yearRange.start]);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ color: '#9ca3af' }}>Loading…</p>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '16px' }}>
        <p style={{ color: '#374151', fontSize: '18px', fontWeight: 600 }}>Ticker not found</p>
        <Link href="/stocks" style={{ color: '#0d9488', textDecoration: 'underline', fontSize: '14px' }}>← Back to Stocks</Link>
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

  const statCard = (label: string, value: string, sub?: string, color?: string) => (
    <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px 20px', minWidth: '120px', flex: 1 }}>
      <div style={{ fontSize: '11px', color: '#9ca3af', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: '22px', fontWeight: 700, color: color ?? '#111827', marginTop: '4px' }}>{value}</div>
      {sub && <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '2px' }}>{sub}</div>}
    </div>
  );

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
          <Link href="/stocks" className="inline-block text-sm text-white/70 hover:text-white mb-5 transition">
            ← Back to Stocks
          </Link>
          <h1 style={{ fontSize: '3rem', fontWeight: 800, fontFamily: 'monospace', letterSpacing: '-0.02em' }}>
            {data.ticker}
          </h1>
          <p className="mt-1 text-white/60 text-sm">{data.tradeCount} congressional trades recorded</p>

          {/* Buy/sell bar */}
          <div style={{ marginTop: '16px', height: '10px', background: 'rgba(255,255,255,0.2)', borderRadius: '5px', overflow: 'hidden', maxWidth: '400px' }}>
            <div style={{ display: 'flex', height: '100%' }}>
              <div style={{ width: `${buyPct}%`, background: '#10b981' }} />
              <div style={{ width: `${sellPct}%`, background: '#ef4444' }} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '16px', marginTop: '6px', fontSize: '12px', color: 'rgba(255,255,255,0.7)' }}>
            <span style={{ color: '#6ee7b7' }}>↑ {buyPct.toFixed(0)}% buys</span>
            <span style={{ color: '#fca5a5' }}>↓ {sellPct.toFixed(0)}% sells</span>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-5xl px-6 py-6" style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {/* Stat cards */}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {statCard('Total Traded', formatMoney(data.totalAmount), `${data.tradeCount} trades`)}
          {statCard('Purchased', formatMoney(data.buyAmount), `${data.members.filter(m => m.buyAmount > 0).length} members`, '#10b981')}
          {statCard('Sold', formatMoney(data.sellAmount), `${data.members.filter(m => m.sellAmount > 0).length} members`, '#ef4444')}
          {statCard('Members', String(data.members.length), 'traded this stock')}
        </div>

        {/* Year range filter */}
        {availableYears.length > 0 && minYear !== null && maxYear !== null && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '12px',
              padding: '12px',
              maxWidth: '320px',
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Start</span>
                <select
                  value={rangeStart ?? minYear}
                  onChange={(e) => {
                    const nextStart = parseInt(e.target.value, 10);
                    setYearRange((prev) => {
                      const safeEnd = prev.end ?? maxYear;
                      return { start: Math.min(nextStart, safeEnd), end: safeEnd };
                    });
                  }}
                  style={{
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '7px 10px',
                    fontSize: '13px',
                    color: '#0f172a',
                    background: '#f8fafc',
                    fontWeight: 600,
                  }}
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

              <label style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>End</span>
                <select
                  value={rangeEnd ?? maxYear}
                  onChange={(e) => {
                    const nextEnd = parseInt(e.target.value, 10);
                    setYearRange((prev) => {
                      const safeStart = prev.start ?? minYear;
                      return { start: safeStart, end: Math.max(nextEnd, safeStart) };
                    });
                  }}
                  style={{
                    border: '1px solid #cbd5e1',
                    borderRadius: '8px',
                    padding: '7px 10px',
                    fontSize: '13px',
                    color: '#0f172a',
                    background: '#f8fafc',
                    fontWeight: 600,
                  }}
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
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#6b7280' }}>Filter by type:</span>
          <button onClick={() => setTradeFilter('all')} style={filterBtn(tradeFilter === 'all', '#0d9488')}>
            All
          </button>
          <button onClick={() => setTradeFilter('buy')} style={filterBtn(tradeFilter === 'buy', '#10b981')}>
            Buys Only
          </button>
          <button onClick={() => setTradeFilter('sell')} style={filterBtn(tradeFilter === 'sell', '#ef4444')}>
            Sells Only
          </button>
        </div>

        {/* Price chart */}
        <StockPriceChart trades={filteredTrades} />

        {/* Members who traded */}
        <div>
          {/* Get members who traded in filtered period */}
          {(() => {
            const filteredMemberBioguides = new Set(filteredTrades.map((t) => t.bioguide));
            const filteredMembers = data.members.filter((m) => filteredMemberBioguides.has(m.bioguide));
            return (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                {filteredMembers.length === 0 ? (
                  <p className="text-center text-gray-400 py-8 text-sm">No member data.</p>
                ) : (
                  <div className="divide-y divide-gray-100" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                    {filteredMembers.map((m) => (
                      <button
                        key={m.bioguide}
                        onClick={() => router.push(`/congressman/${m.bioguide}`)}
                        className="w-full text-left hover:bg-teal-50 transition-colors cursor-pointer"
                        style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 20px', position: 'relative' }}
                      >
                        <span style={{ width: '8px', height: '8px', borderRadius: '9999px', background: partyColor(m.party), flexShrink: 0 }} />
                        <span style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', fontWeight: 500, fontSize: '14px', color: '#111827', whiteSpace: 'nowrap', pointerEvents: 'none' }}>{m.full_name}</span>
                        <div style={{ flex: 1 }} />
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexShrink: 0 }}>
                          {m.buyAmount > 0 && (
                            <span style={{ fontSize: '12px', color: '#10b981', fontWeight: 600 }}>↑ {formatMoney(m.buyAmount)}</span>
                          )}
                          {m.sellAmount > 0 && (
                            <span style={{ fontSize: '12px', color: '#ef4444', fontWeight: 600 }}>↓ {formatMoney(m.sellAmount)}</span>
                          )}
                          <span style={{ fontSize: '12px', color: '#6b7280' }}>{partyLabel(m.party)}</span>
                          <span style={{ fontSize: '11px', color: '#9ca3af' }}>{m.tradeCount} trade{m.tradeCount !== 1 ? 's' : ''}</span>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px', flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>Trade History</h2>
            <button style={filterBtn(tradeFilter === 'all', '#6b7280')} onClick={() => setTradeFilter('all')}>All</button>
            <button style={filterBtn(tradeFilter === 'buy', '#15803d')} onClick={() => setTradeFilter('buy')}>Buys</button>
            <button style={filterBtn(tradeFilter === 'sell', '#b91c1c')} onClick={() => setTradeFilter('sell')}>Sells</button>
            <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#9ca3af' }}>{filteredTrades.length} trades</span>
          </div>
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {filteredTrades.length === 0 ? (
              <p className="text-center text-gray-400 py-8 text-sm">No trades.</p>
            ) : (
              <>
                {/* Table header */}
                <div style={{ display: 'grid', gridTemplateColumns: '100px 1fr 90px 90px', gap: '0', padding: '8px 20px', borderBottom: '1px solid #e2e8f0', background: '#f8fafc' }}>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>Date</span>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>Member</span>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', textAlign: 'center' }}>Type</span>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', textAlign: 'right' }}>Amount</span>
                </div>
                <div className="divide-y divide-gray-100" style={{ maxHeight: '480px', overflowY: 'auto' }}>
                  {filteredTrades.map((t) => {
                    const dir = tradeDirection(t.trade_type);
                    return (
                      <div
                        key={t.id}
                        style={{ display: 'grid', gridTemplateColumns: '100px 1fr 90px 90px', gap: '0', padding: '9px 20px', alignItems: 'center' }}
                      >
                        <span style={{ fontSize: '12px', color: '#6b7280', fontFamily: 'monospace' }}>{formatDate(t.trade_date)}</span>
                        <button
                          onClick={() => t.bioguide && router.push(`/congressman/${t.bioguide}`)}
                          style={{ fontSize: '13px', color: dir === 'buy' ? '#10b981' : dir === 'sell' ? '#ef4444' : '#9ca3af', fontWeight: 500, textAlign: 'left', cursor: t.bioguide ? 'pointer' : 'default', background: 'none', border: 'none', padding: 0 }}
                        >
                          {t.full_name ?? '—'}
                        </button>
                        <span style={{
                          fontSize: '11px',
                          fontWeight: 700,
                          textAlign: 'center',
                          color: dir === 'buy' ? '#10b981' : dir === 'sell' ? '#ef4444' : '#9ca3af',
                        }}>
                          {dir === 'buy' ? '↑ BUY' : dir === 'sell' ? '↓ SELL' : t.trade_type ?? '—'}
                        </span>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#111827', textAlign: 'right' }}>
                          {formatMoney(t.amount)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import HomeTradeChartCard from './components/HomeTradeChartCard';
import ProlificTradersTable from './components/ProlificTradersTable';
import NetWorthLineChart, { type NetWorthHistoryPoint } from './components/NetWorthLineChart';
import {
  getTradeDirection,
  groupTradesByCongressman,
  type HomeTrade,
} from '@/lib/home-trades';

export default function Hero() {
  const router = useRouter();
  const [recentTrades, setRecentTrades] = useState<HomeTrade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBioguide, setSelectedBioguide] = useState<string | null>(null);
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthHistoryPoint[]>([]);
  const [netWorthLoading, setNetWorthLoading] = useState(false);
  const [netWorthBioguide, setNetWorthBioguide] = useState<string | null>(null);
  const [detailYear, setDetailYear] = useState<number | null>(null);
  const [detailData, setDetailData] = useState<{ totalAssets: number; totalLiabilities: number; netWorth: number } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const loadTrades = async () => {
      let attempt = 0;
      const maxAttempts = 3;

      setIsLoading(true);

      while (attempt < maxAttempts && !cancelled) {
        try {
          const response = await fetch('/api/recent-trades', { cache: 'no-store' });
          if (!response.ok) {
            throw new Error(`recent-trades request failed: ${response.status}`);
          }

          const data = await response.json();
          const trades: HomeTrade[] = Array.isArray(data.trades) ? data.trades : [];
          if (cancelled) {
            return;
          }

          setRecentTrades(trades);
          setSelectedBioguide(trades.length > 0 ? trades[0].bioguide : null);
          setIsLoading(false);
          return;
        } catch {
          attempt += 1;
          if (attempt >= maxAttempts || cancelled) {
            if (!cancelled) {
              setIsLoading(false);
            }
            return;
          }

          // Brief backoff to survive transient dev-server/API restarts.
          await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
        }
      }
    };

    loadTrades();

    return () => {
      cancelled = true;
    };
  }, []);

  const groupedCongressmen = useMemo(() => groupTradesByCongressman(recentTrades), [recentTrades]);

  // Reset detail panel when member changes
  useEffect(() => {
    setDetailYear(null);
    setDetailData(null);
  }, [selectedBioguide]);

  function handleYearClick(year: number) {
    if (!selectedBioguide) return;
    setDetailYear(year);
    setDetailData(null);
    setDetailLoading(true);
    fetch(`/api/congressman/${selectedBioguide}/net-worth-detail/${year}`)
      .then((r) => r.json())
      .then((data) => {
        setDetailData(data.error ? null : { totalAssets: data.totalAssets, totalLiabilities: data.totalLiabilities, netWorth: data.netWorth });
        setDetailLoading(false);
      })
      .catch(() => setDetailLoading(false));
  }

  // Fetch net worth history whenever selected member changes, with debounce
  useEffect(() => {
    if (!selectedBioguide) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setNetWorthLoading(true);
      fetch(`/api/congressman/${selectedBioguide}/net-worth-history`)
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) {
            setNetWorthHistory(data.history ?? []);
            setNetWorthBioguide(selectedBioguide);
            setNetWorthLoading(false);
          }
        })
        .catch(() => { if (!cancelled) { setNetWorthHistory([]); setNetWorthLoading(false); } });
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [selectedBioguide]);

  const selectedGroup = useMemo(
    () => groupedCongressmen.find((group) => group.bioguide === selectedBioguide) ?? null,
    [groupedCongressmen, selectedBioguide]
  );

  const purchaseTrades = selectedGroup
    ? selectedGroup.trades.filter((trade) => getTradeDirection(trade.type) === 'purchase')
    : [];
  const saleTrades = selectedGroup
    ? selectedGroup.trades.filter((trade) => getTradeDirection(trade.type) === 'sale')
    : [];

  return (
    <div>
      {/* Hero */}
      <div
        className="text-white"
        style={{
          background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 50%, #ef4444 100%)',
          padding: '48px 24px 40px',
        }}
      >
        <div className="mx-auto max-w-3xl text-center">
          <p className="mb-3 inline-block rounded-full border border-white/30 bg-white/10 px-4 py-1 text-xs font-bold uppercase tracking-widest text-white/80 backdrop-blur-sm">
            Transparency in Public Office
          </p>
          <h1 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl">
            Your lawmakers are<br />
            <span style={{ background: 'linear-gradient(90deg, #fde68a, #fb923c)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
              trading stocks.
            </span>
          </h1>
          <p className="mt-4 text-lg text-white/75 font-medium max-w-xl mx-auto">
            We track every disclosed congressional trade, so you can see exactly what influences their laws.
          </p>
          <div className="mt-6 flex justify-center gap-3 flex-wrap">
            <a
              href="/representatives"
              className="rounded-full px-6 py-2.5 text-sm font-bold text-white border border-white/40 bg-white/10 hover:bg-white/20 transition"
            >
              Browse Representatives
            </a>
            <a
              href="/stocks"
              className="rounded-full px-6 py-2.5 text-sm font-bold bg-white text-purple-700 hover:bg-white/90 transition"
            >
              Explore Stocks
            </a>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{ background: 'rgba(15,23,42,0.94)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <div className="mx-auto max-w-4xl px-6 py-3 flex flex-wrap justify-center gap-6 sm:gap-10">
          {[
            { label: 'Trades Tracked', value: '47,000+' },
            { label: 'Lawmakers', value: '350+' },
            { label: 'Tickers Traded', value: '3,000+' },
            { label: 'Data Since', value: '2012' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-center gap-2 text-center">
              <span className="text-lg font-black text-white sm:text-xl">{value}</span>
              <span className="text-xs font-semibold uppercase tracking-wider text-white/40">{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="px-4 py-8 md:px-8" style={{ background: 'linear-gradient(135deg, #f9fafb 0%, #eff6ff 100%)' }}>
        <div className="mx-auto flex max-w-400 flex-col items-stretch gap-8 lg:flex-row">
        <div className="hidden w-full min-w-0 md:block lg:w-1/2">
          <div className="mb-6">
            <h2 className="mb-3 text-center text-2xl font-black tracking-wide text-gray-800 sm:text-3xl">
              Estimated Net Worth
            </h2>
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-4">
              <NetWorthLineChart data={netWorthHistory} isLoading={netWorthLoading || isLoading} onYearClick={handleYearClick} />
              {detailYear !== null && (
                <div style={{ marginTop: '12px', padding: '12px 16px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '10px', fontSize: '13px' }}>
                  <div style={{ fontWeight: 700, color: '#0369a1', marginBottom: '6px' }}>{detailYear} Breakdown</div>
                  {detailLoading ? (
                    <div style={{ color: '#6b7280' }}>Parsing PDF…</div>
                  ) : detailData ? (
                    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                      <span>Assets: <b style={{ color: '#15803d' }}>${(detailData.totalAssets / 1_000_000).toFixed(2)}M</b></span>
                      <span>Liabilities: <b style={{ color: '#dc2626' }}>${(detailData.totalLiabilities / 1_000_000).toFixed(2)}M</b></span>
                      <span>Net Worth: <b style={{ color: '#1d4ed8' }}>${(detailData.netWorth / 1_000_000).toFixed(2)}M</b></span>
                    </div>
                  ) : (
                    <div style={{ color: '#9ca3af' }}>No breakdown available for this year.</div>
                  )}
                </div>
              )}
            </div>
          </div>
          <h2 className="mb-3 text-center text-2xl font-black tracking-wide text-gray-800 sm:text-3xl">Trades by Ticker</h2>
          <HomeTradeChartCard
            isLoading={isLoading}
            emptyMessage="No trades in current data"
            purchaseTrades={purchaseTrades}
            saleTrades={saleTrades}
          />
        </div>

        <div className="w-full min-w-0 lg:w-1/2">
          <h2 className="mb-2 text-center text-2xl font-black tracking-wide text-purple-800 sm:text-3xl">Most Prolific Traders</h2>
          <p className="mb-6 text-center text-sm text-gray-500 font-medium">Based on recent disclosures — hover to preview trades</p>
          <ProlificTradersTable
            groups={groupedCongressmen}
            isLoading={isLoading}
            selectedBioguide={selectedBioguide}
            onHoverRow={setSelectedBioguide}
            onPrefetchMember={(bioguide) => router.prefetch(`/congressman/${bioguide}`)}
            onOpenMember={(bioguide) => router.push(`/congressman/${bioguide}`)}
          />
        </div>
        </div> 
      </div>
    </div>
  );
}
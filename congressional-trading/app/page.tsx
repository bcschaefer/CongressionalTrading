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

// ─── Sub-components ──────────────────────────────────────────────────────────

const SITE_STATS = [
  { label: 'Trades Tracked', value: '47,000+' },
  { label: 'Lawmakers', value: '350+' },
  { label: 'Tickers Traded', value: '3,000+' },
  { label: 'Data Since', value: '2012' },
];

function HeroBanner() {
  return (
    <div
      className="text-white"
      style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #2563eb 50%, #ef4444 100%)', padding: '48px 24px 40px' }}
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
        <p className="mx-auto mt-4 max-w-xl text-lg font-medium text-white/75">
          We track every disclosed congressional trade, so you can see exactly what influences their laws.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <a href="/representatives" className="rounded-full border border-white/40 bg-white/10 px-6 py-2.5 text-sm font-bold text-white transition hover:bg-white/20">
            Browse Representatives
          </a>
          <a href="/stocks" className="rounded-full bg-white px-6 py-2.5 text-sm font-bold text-purple-700 transition hover:bg-white/90">
            Explore Stocks
          </a>
        </div>
      </div>
    </div>
  );
}

function StatsBar() {
  return (
    <div style={{ background: 'rgba(15,23,42,0.94)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="mx-auto flex max-w-4xl flex-wrap justify-center gap-6 px-6 py-3 sm:gap-10">
        {SITE_STATS.map(({ label, value }) => (
          <div key={label} className="flex items-center gap-2 text-center">
            <span className="text-lg font-black text-white sm:text-xl">{value}</span>
            <span className="text-xs font-semibold uppercase tracking-wider text-white/40">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

type DetailData = { totalAssets: number; totalLiabilities: number; netWorth: number };

function NetWorthDetailPanel({ year, data, loading }: { year: number; data: DetailData | null; loading: boolean }) {
  return (
    <div className="mt-3 rounded-[10px] border border-sky-200 bg-sky-50 p-3 text-[13px]">
      <div className="mb-1.5 font-bold text-sky-700">{year} Breakdown</div>
      {loading ? (
        <div className="text-gray-500">Parsing PDF…</div>
      ) : data ? (
        <div className="flex flex-wrap gap-5">
          <span>Assets: <b className="text-green-700">${(data.totalAssets / 1_000_000).toFixed(2)}M</b></span>
          <span>Liabilities: <b className="text-red-600">${(data.totalLiabilities / 1_000_000).toFixed(2)}M</b></span>
          <span>Net Worth: <b className="text-blue-700">${(data.netWorth / 1_000_000).toFixed(2)}M</b></span>
        </div>
      ) : (
        <div className="text-gray-400">No breakdown available for this year.</div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function Hero() {
  const router = useRouter();
  const [recentTrades, setRecentTrades] = useState<HomeTrade[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBioguide, setSelectedBioguide] = useState<string | null>(null);
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthHistoryPoint[]>([]);
  const [netWorthLoading, setNetWorthLoading] = useState(false);
  const [detailYear, setDetailYear] = useState<number | null>(null);
  const [detailData, setDetailData] = useState<DetailData | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadTrades() {
      setIsLoading(true);
      for (let attempt = 1; attempt <= 3 && !cancelled; attempt++) {
        try {
          const res = await fetch('/api/recent-trades', { cache: 'no-store' });
          if (!res.ok) throw new Error(`recent-trades: ${res.status}`);
          const data = await res.json();
          if (cancelled) return;
          const trades: HomeTrade[] = Array.isArray(data.trades) ? data.trades : [];
          setRecentTrades(trades);
          setSelectedBioguide(trades[0]?.bioguide ?? null);
          setIsLoading(false);
          return;
        } catch {
          if (attempt === 3) {
            if (!cancelled) setIsLoading(false);
            return;
          }
          await new Promise((r) => setTimeout(r, 350 * attempt));
        }
      }
    }

    loadTrades();
    return () => { cancelled = true; };
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

  const purchaseTrades = selectedGroup?.trades.filter((t) => getTradeDirection(t.type) === 'purchase') ?? [];
  const saleTrades = selectedGroup?.trades.filter((t) => getTradeDirection(t.type) === 'sale') ?? [];

  return (
    <div>
      <HeroBanner />
      <StatsBar />

      <div className="px-4 py-8 md:px-8" style={{ background: 'linear-gradient(135deg, #f9fafb 0%, #eff6ff 100%)' }}>
        <div className="mx-auto flex max-w-400 flex-col items-stretch gap-8 lg:flex-row">
          <div className="hidden w-full min-w-0 md:block lg:w-1/2">
            <div className="mb-6">
              <h2 className="mb-3 text-center text-2xl font-black tracking-wide text-gray-800 sm:text-3xl">
                Estimated Net Worth
              </h2>
              <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-xl">
                <NetWorthLineChart data={netWorthHistory} isLoading={netWorthLoading || isLoading} onYearClick={handleYearClick} />
                {detailYear !== null && (
                  <NetWorthDetailPanel year={detailYear} data={detailData} loading={detailLoading} />
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
            <p className="mb-6 text-center text-sm font-medium text-gray-500">Based on recent disclosures — hover to preview trades</p>
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
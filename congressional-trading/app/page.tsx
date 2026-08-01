'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import HomeTradeChartCard from './components/HomeTradeChartCard';
import ProlificTradersTable from './components/ProlificTradersTable';
import NetWorthLineChart, { type NetWorthHistoryPoint } from './components/NetWorthLineChart';
import StatCard from './components/ui/StatCard';
import {
  getTradeDirection,
  groupTradesByCongressman,
  sortCongressmanGroups,
  type HomeTrade,
  type TraderSortMode,
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
    <div className="border-b border-(--color-border) px-4 pb-8 pt-10 md:px-8">
      <div className="mx-auto max-w-5xl">
        <h1 className="text-3xl font-bold leading-tight tracking-tight text-(--color-text-primary) sm:text-4xl">
          Your lawmakers are <span className="text-(--color-accent)">trading</span> <span className="text-(--color-negative)">stocks</span>.
        </h1>
        <p className="mt-3 max-w-xl text-base text-(--color-text-secondary)">
          We track every disclosed congressional trade, so you can see exactly what influences their laws.
        </p>
        <div className="mt-5 flex flex-wrap gap-2.5">
          <Link
            href="/representatives"
            className="cursor-pointer rounded-(--radius-sm) bg-(--color-accent) px-4 py-2 text-sm font-semibold text-white transition-all duration-150 hover:-translate-y-0.5 hover:bg-(--color-accent-hover) hover:shadow-md"
          >
            Browse Representatives
          </Link>
          <Link
            href="/stocks"
            className="cursor-pointer rounded-(--radius-sm) border border-(--color-border) px-4 py-2 text-sm font-semibold text-(--color-text-primary) transition-all duration-150 hover:-translate-y-0.5 hover:border-(--color-accent) hover:text-(--color-accent) hover:shadow-sm"
          >
            Explore Stocks
          </Link>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          {SITE_STATS.map(({ label, value }) => (
            <StatCard key={label} label={label} value={value} />
          ))}
        </div>
      </div>
    </div>
  );
}

type DetailData = { totalAssets: number; totalLiabilities: number; netWorth: number };

function NetWorthDetailPanel({ year, data, loading }: { year: number; data: DetailData | null; loading: boolean }) {
  return (
    <div className="mt-3 rounded-(--radius-sm) border border-(--color-border) bg-(--color-bg-subtle) p-3 text-[13px]">
      <div className="mb-1.5 font-bold text-(--color-text-primary)">{year} Breakdown</div>
      {loading ? (
        <div className="text-(--color-text-secondary)">Parsing PDF…</div>
      ) : data ? (
        <div className="flex flex-wrap gap-5">
          <span>Assets: <b className="text-(--color-positive)">${(data.totalAssets / 1_000_000).toFixed(2)}M</b></span>
          <span>Liabilities: <b className="text-(--color-negative)">${(data.totalLiabilities / 1_000_000).toFixed(2)}M</b></span>
          <span>Net Worth: <b className="text-(--color-accent)">${(data.netWorth / 1_000_000).toFixed(2)}M</b></span>
        </div>
      ) : (
        <div className="text-(--color-text-muted)">No breakdown available for this year.</div>
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
  const [sortMode, setSortMode] = useState<TraderSortMode>('prolific');
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthHistoryPoint[]>([]);
  const [noElectronicDisclosures, setNoElectronicDisclosures] = useState(false);
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
  const displayedGroups = useMemo(
    () => sortCongressmanGroups(groupedCongressmen, sortMode),
    [groupedCongressmen, sortMode]
  );

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
    if (!selectedBioguide) {
      setNetWorthHistory([]);
      setNoElectronicDisclosures(false);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setNetWorthLoading(true);
      fetch(`/api/congressman/${selectedBioguide}/net-worth-history`)
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) {
            setNetWorthHistory(data.history ?? []);
            setNoElectronicDisclosures(!!data.noElectronicDisclosures);
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

      <div className="px-4 py-8 md:px-8">
        <div className="mx-auto flex max-w-400 flex-col items-stretch gap-8 lg:flex-row">
          <div className="hidden w-full min-w-0 md:block lg:w-1/2">
            <div className="mb-6">
              <h2 className="mb-3 text-xl font-bold text-foreground">Estimated Net Worth</h2>
              <div className="rounded-md border border-(--color-border) bg-white p-4">
                <NetWorthLineChart
                  data={netWorthHistory}
                  isLoading={netWorthLoading || isLoading}
                  onYearClick={handleYearClick}
                  emptyMessage={
                    selectedBioguide && noElectronicDisclosures
                      ? 'No electronic disclosures available for this member.'
                      : 'Hover a trader to see their net worth'
                  }
                  height={200}
                />
                {detailYear !== null && (
                  <NetWorthDetailPanel year={detailYear} data={detailData} loading={detailLoading} />
                )}
              </div>
            </div>
            <h2 className="mb-3 text-xl font-bold text-foreground">Trades by Year</h2>
            <HomeTradeChartCard
              isLoading={isLoading}
              emptyMessage="No trades in current data"
              purchaseTrades={purchaseTrades}
              saleTrades={saleTrades}
              height={360}
            />
          </div>

          <div className="w-full min-w-0 lg:w-1/2">
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <h2 className="text-xl font-bold text-foreground">
                {sortMode === 'prolific' ? 'Most Prolific Traders' : 'Most Recent Traders'}
              </h2>
              <Link
                href="/representatives"
                className="group shrink-0 cursor-pointer text-sm font-medium text-(--color-accent) transition-colors hover:text-(--color-accent-hover)"
              >
                See all <span className="inline-block transition-transform duration-150 group-hover:translate-x-0.5">→</span>
              </Link>
            </div>
            <p className="mb-3 text-sm text-(--color-text-secondary)">
              {sortMode === 'prolific'
                ? 'Ranked by trade count — hover to preview trades'
                : 'Ranked by most recent disclosure — hover to preview trades'}
            </p>
            <div className="mb-6 inline-flex rounded-(--radius-sm) border border-(--color-border)">
              <button
                type="button"
                onClick={() => setSortMode('prolific')}
                className={`cursor-pointer rounded-l-[5px] px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors duration-150 ${
                  sortMode === 'prolific' ? 'bg-(--color-accent) text-white' : 'text-(--color-text-secondary) hover:bg-(--color-bg-subtle) hover:text-(--color-text-primary)'
                }`}
              >
                Prolific
              </button>
              <button
                type="button"
                onClick={() => setSortMode('recent')}
                className={`cursor-pointer rounded-r-[5px] border-l border-(--color-border) px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors duration-150 ${
                  sortMode === 'recent' ? 'bg-(--color-accent) text-white' : 'text-(--color-text-secondary) hover:bg-(--color-bg-subtle) hover:text-(--color-text-primary)'
                }`}
              >
                Recent
              </button>
            </div>
            <ProlificTradersTable
              groups={displayedGroups}
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
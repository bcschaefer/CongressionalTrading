'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import TradeBarChart from '@/app/components/TradeBarChart';
import NetWorthSection, { type NetWorthData } from '@/app/components/NetWorthSection';
import type { AnnualDisclosureItem } from '../../components/StockDisclosuresMenu';

type MemberTrade = {
  id: number;
  bioguide: string;
  type: string;
  amount: number;
  ticker: string;
  date: string;
  sector: string;
};

type Member = {
  bioguide: string;
  full_name: string;
  party: string | null;
  chamber: string | null;
  is_active: boolean;
  state: string | null;
  district: string | null;
  termStart: number | null;
  termEnd: number | null;
};

function partyInfo(party: string | null): { label: string; color: string } {
  const p = (party ?? '').trim().toUpperCase();
  if (p === 'D' || p.startsWith('DEM')) return { label: 'Democrat', color: 'bg-blue-500' };
  if (p === 'R' || p.startsWith('REP')) return { label: 'Republican', color: 'bg-red-500' };
  if (p === 'I' || p.startsWith('IND')) return { label: 'Independent', color: 'bg-yellow-400' };
  return { label: party ?? 'Unknown', color: 'bg-gray-400' };
}

function bannerStyleForParty(party: string | null): { background: string } {
  const p = (party ?? '').trim().toUpperCase();
  if (p === 'D' || p.startsWith('DEM')) {
    return {
      background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 45%, #60a5fa 100%)',
    };
  }
  if (p === 'R' || p.startsWith('REP')) {
    return {
      background: 'linear-gradient(135deg, #b91c1c 0%, #dc2626 45%, #fb7185 100%)',
    };
  }
  return {
    background: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 45%, #a78bfa 100%)',
  };
}

type TradeDirection = 'purchase' | 'sale' | 'other';

function getTradeDirection(type: string): TradeDirection {
  const n = type.trim().toUpperCase();
  if (n === 'P' || n.startsWith('PURCHASE') || n.startsWith('BUY')) return 'purchase';
  if (n === 'S' || n.startsWith('SALE') || n.startsWith('SELL')) return 'sale';
  return 'other';
}

function formatMoney(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function CongressmanPage() {
  const { bioguide } = useParams<{ bioguide: string }>();
  const router = useRouter();
  const [member, setMember] = useState<Member | null>(null);
  const [trades, setTrades] = useState<MemberTrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [netWorth, setNetWorth] = useState<NetWorthData | null>(null);
  const [annualDisclosures, setAnnualDisclosures] = useState<AnnualDisclosureItem[]>([]);
  const [failedImageBioguide, setFailedImageBioguide] = useState<string | null>(null);

  useEffect(() => {
    if (!bioguide) return;
    const controller = new AbortController();
    fetch(`/api/congressman/${bioguide}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        setMember(data.member ?? null);
        setTrades(data.trades ?? []);
        setAnnualDisclosures(data.annualDisclosures ?? []);
        setLoading(false);
      })
      .catch(() => {/* aborted or error */});
    return () => controller.abort();
  }, [bioguide]);

  const imgError = failedImageBioguide === bioguide;

  const purchaseTrades = useMemo(
    () => trades.filter((t) => getTradeDirection(t.type) === 'purchase'),
    [trades]
  );
  const saleTrades = useMemo(
    () => trades.filter((t) => getTradeDirection(t.type) === 'sale'),
    [trades]
  );

  useEffect(() => {
    if (!bioguide || loading) return;
    fetch(`/api/congressman/${bioguide}/net-worth`)
      .then((r) => r.json())
      .then((data: NetWorthData) => setNetWorth(data))
      .catch(() => {
        setNetWorth({
          filing: null,
          assets: [],
          liabilities: [],
          stocks: [],
          byCategory: {},
          summary: null,
          error: 'Failed to load net worth data.',
        });
      });
  }, [bioguide, loading]);

  const photoUrl = `/api/member-photo/${bioguide}`;

  const totalPurchases = purchaseTrades.reduce((s, t) => s + t.amount, 0);
  const totalSales = saleTrades.reduce((s, t) => s + t.amount, 0);

  const topTicker = (() => {
    const counts = new Map<string, number>();
    for (const t of trades) counts.set(t.ticker, (counts.get(t.ticker) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—';
  })();

  const disclosuresSorted = [...annualDisclosures].sort((a, b) => {
    if (a.filing_year !== b.filing_year) return b.filing_year - a.filing_year;
    return b.id - a.id;
  });

  const tradeCharts = useMemo(
    () => (
      <>
        <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-6 overflow-hidden">
          <h2 style={{ marginTop: '12px', marginBottom: '14px', textAlign: 'center', fontSize: 'clamp(1.9rem, 8vw, 3rem)', fontWeight: 800, lineHeight: 1.05, color: '#065f46' }}>
            Purchases
          </h2>
          <div className="w-full overflow-x-auto overflow-y-hidden">
            <TradeBarChart
              trades={purchaseTrades}
              color="#10b981"
              emptyMessage="No purchase trades on record"
              groupByTicker={true}
            />
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-6 overflow-hidden">
          <h2 style={{ marginTop: '12px', marginBottom: '14px', textAlign: 'center', fontSize: 'clamp(1.9rem, 8vw, 3rem)', fontWeight: 800, lineHeight: 1.05, color: '#9f1239' }}>
            Sales
          </h2>
          <div className="w-full overflow-x-auto overflow-y-hidden">
            <TradeBarChart
              trades={saleTrades}
              color="#ef4444"
              emptyMessage="No sale trades on record"
              groupByTicker={true}
            />
          </div>
        </div>
      </>
    ),
    [purchaseTrades, saleTrades]
  );

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-lg">Loading…</p>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 gap-4">
        <p className="text-gray-700 text-lg">Member not found.</p>
        <button onClick={() => router.back()} className="text-blue-600 hover:underline">← Back</button>
      </div>
    );
  }

  const bannerStyle = bannerStyleForParty(member.party);

  return (
    <div
      className="min-h-screen overflow-x-hidden"
      style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #eff6ff 100%)' }}
    >
      {/* Header */}
      <div className="border-b border-white/10 text-white shadow-xl" style={bannerStyle}>
        <div
          className="mx-auto max-w-7xl px-4 md:px-10"
          style={{ paddingTop: '30px', paddingBottom: '38px' }}
        >
          <button onClick={() => router.back()} className="inline-block text-sm text-white/80 transition hover:text-white mb-6 cursor-pointer">
            ← Back
          </button>

          <div className="flex flex-col gap-6 md:flex-row md:items-center md:gap-8">
            {/* Photo */}
            <div className="shrink-0" style={{ marginTop: '8px', marginBottom: '16px', marginRight: '14px' }}>
              {imgError ? (
                <div
                  className="flex items-center justify-center rounded-2xl border border-white/60 bg-white/90 font-bold text-slate-600 shadow-lg"
                  style={{ width: '156px', height: '206px', fontSize: '44px' }}
                >
                  {member.full_name[0]}
                </div>
              ) : (
                <Image
                  src={photoUrl}
                  alt={member.full_name}
                  width={156}
                  height={206}
                  className="rounded-2xl border border-white/60 bg-white/90 object-cover object-center shadow-lg"
                  onError={() => setFailedImageBioguide(bioguide)}
                />
              )}
            </div>

            {/* Info */}
            <div className="min-w-0 py-2">
              <h1 className="text-3xl font-bold tracking-tight md:text-5xl">{member.full_name}</h1>
              {(() => {
                const p = (member.party ?? '').trim().toUpperCase();
                const pillBg = p === 'D' || p.startsWith('DEM')
                  ? 'rgba(30,58,138,0.7)'   // dark blue
                  : p === 'R' || p.startsWith('REP')
                  ? 'rgba(127,29,29,0.7)'   // dark red
                  : 'rgba(0,0,0,0.35)';
                const pillStyle = {
                  background: pillBg,
                  color: '#fff',
                  padding: '6px 16px',
                  borderRadius: '9999px',
                  fontSize: '13px',
                  fontWeight: 600 as const,
                };
                return (
                  <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-6">
                    {member.party && (
                      <span style={pillStyle}>{partyInfo(member.party).label}</span>
                    )}
                    {member.chamber && (
                      <span style={{ ...pillStyle, textTransform: 'capitalize' }}>{member.chamber}</span>
                    )}
                    {member.district && (
                      <span style={pillStyle}>{member.district}</span>
                    )}
                    <span style={{ ...pillStyle, fontSize: '12px', fontFamily: 'monospace', color: 'rgba(255,255,255,0.8)' }}>{bioguide}</span>
                    {member.termStart != null && (
                      <span style={pillStyle}>
                        {member.termStart}–{member.is_active ? 'Present' : (member.termEnd ?? '?')}
                      </span>
                    )}
                  </div>
                );
              })()}

              {/* Stats pills */}
              <div className="mt-10 flex flex-wrap gap-x-3 gap-y-6">
                {[
                  { label: 'Total Trades', value: trades.length },
                  { label: 'Purchases', value: purchaseTrades.length },
                  { label: 'Sales', value: saleTrades.length },
                  { label: 'Total Purchased', value: formatMoney(totalPurchases) },
                  { label: 'Total Sold', value: formatMoney(totalSales) },
                  { label: 'Most Traded', value: topTicker },
                ].map(({ label, value }) => (
                  <div
                    key={label}
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      padding: '6px 14px',
                      borderRadius: '9999px',
                      background: 'rgba(255,255,255,0.15)',
                      backdropFilter: 'blur(4px)',
                      border: '1px solid rgba(255,255,255,0.25)',
                    }}
                  >
                    <span style={{ fontSize: '9px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.7)', lineHeight: 1.2 }}>
                      {label}
                    </span>
                    <span style={{ fontSize: '15px', fontWeight: 700, color: '#ffffff', lineHeight: 1.3, marginTop: '2px' }}>
                      {value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Graphs */}
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-6 space-y-8 md:px-10 md:pb-14 md:pt-8" style={{ marginTop: '24px' }}>
        {tradeCharts}

        <NetWorthSection netWorth={netWorth} disclosures={disclosuresSorted} />
      </div>
    </div>
  );
}

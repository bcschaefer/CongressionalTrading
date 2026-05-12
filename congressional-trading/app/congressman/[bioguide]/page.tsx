'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import TradeBarChart from '@/app/components/TradeBarChart';
import NetWorthSection, { type NetWorthData } from '@/app/components/NetWorthSection';
import NetWorthLineChart, { type NetWorthHistoryPoint } from '@/app/components/NetWorthLineChart';
import VotingHistoryTable, { type VoteRecord } from '@/app/components/VotingHistoryTable';
import PotentialConflictsTable from '@/app/components/PotentialConflictsTable';
import type { MemberTrade as ConflictMemberTrade } from '@/app/components/PotentialConflictsTable';
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
  if (p === 'D' || p.startsWith('DEM'))
    return { background: 'linear-gradient(135deg, #1d4ed8 0%, #2563eb 45%, #60a5fa 100%)' };
  if (p === 'R' || p.startsWith('REP'))
    return { background: 'linear-gradient(135deg, #b91c1c 0%, #dc2626 45%, #fb7185 100%)' };
  return { background: 'linear-gradient(135deg, #6d28d9 0%, #7c3aed 45%, #a78bfa 100%)' };
}

function pillBgForParty(party: string | null): string {
  const p = (party ?? '').trim().toUpperCase();
  if (p === 'D' || p.startsWith('DEM')) return 'rgba(30,58,138,0.7)';
  if (p === 'R' || p.startsWith('REP')) return 'rgba(127,29,29,0.7)';
  return 'rgba(0,0,0,0.35)';
}

type TabId = 'trades' | 'networth' | 'voting' | 'conflicts';
const TAB_LABELS: Record<TabId, string> = { trades: 'Trades', networth: 'Net Worth', voting: 'Voting History', conflicts: 'Potential Conflicts' };

function TabBar({ activeTab, onSelect }: { activeTab: TabId; onSelect: (tab: TabId) => void }) {
  return (
    <div className="mb-7 flex gap-2 border-b-2 border-gray-200">
      {(Object.keys(TAB_LABELS) as TabId[]).map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onSelect(tab)}
          style={{ borderBottom: activeTab === tab ? '3px solid #1d4ed8' : '3px solid transparent', marginBottom: '-2px' }}
          className={`cursor-pointer border-0 bg-transparent px-5.5 py-2.5 text-sm transition-all ${activeTab === tab ? 'font-bold text-blue-700' : 'font-medium text-gray-500'}`}
        >
          {TAB_LABELS[tab]}
        </button>
      ))}
    </div>
  );
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
  const [activeTab, setActiveTab] = useState<TabId>('trades');
  const [tradeView, setTradeView] = useState<'ticker' | 'year'>('year');
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [votes, setVotes] = useState<VoteRecord[]>([]);
  const [votesLoading, setVotesLoading] = useState(false);
  const [votesLoaded, setVotesLoaded] = useState(false);
  const [votesError, setVotesError] = useState<string | null>(null);

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

  useEffect(() => {
    if (!bioguide) return;
    fetch(`/api/congressman/${bioguide}/net-worth-history`)
      .then((r) => r.json())
      .then((data) => {
        setNetWorthHistory(data.history ?? []);
        setHistoryLoading(false);
      })
      .catch(() => setHistoryLoading(false));
  }, [bioguide]);

  useEffect(() => {
    if ((activeTab !== 'voting' && activeTab !== 'conflicts') || votesLoaded || !bioguide || !member) return;
    setVotesLoading(true);

    const lastName = member.full_name.trim().split(/\s+/).pop() ?? '';

    async function fetchVotes() {
      try {
        // Fetch GovTrack client-side (CORS: access-control-allow-origin: *)
        // Server-side fetches from Vercel are blocked by GovTrack's IP filtering
        const personRes = await fetch(
          `https://www.govtrack.us/api/v2/person?q=${encodeURIComponent(lastName)}&limit=50`
        );
        if (!personRes.ok) throw new Error('person lookup failed');

        const personData = await personRes.json();
        const match = (personData.objects ?? []).find(
          (p: { bioguideid: string; link: string }) => p.bioguideid === bioguide
        );

        if (!match) {
          setVotes([]);
          setVotesLoading(false);
          setVotesLoaded(true);
          return;
        }

        const personId = Number(match.link.replace(/\/$/, '').split('/').pop());
        if (!personId) throw new Error('invalid personId');

        const votesRes = await fetch(
          `https://www.govtrack.us/api/v2/vote_voter?person=${personId}&limit=150&sort=-id`
        );
        if (!votesRes.ok) throw new Error('votes fetch failed');

        const votesData = await votesRes.json();
        const rawVotes: Array<{
          created: string;
          option: { value: string };
          vote: { question: string; question_details: string; chamber: string; result: string };
        }> = votesData.objects ?? [];

        // Deduplicate by bill description
        const seen = new Set<string>();
        const deduped: VoteRecord[] = rawVotes
          .map((v) => ({
            date: v.created,
            question: v.vote.question,
            description: v.vote.question_details,
            memberVoted: v.option.value,
            result: v.vote.result,
            chamber: v.vote.chamber,
          }))
          .filter((v) => {
            const key = (v.description?.trim() || v.question?.trim()) ?? '';
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
          });

        setVotes(deduped);
        setVotesLoading(false);
        setVotesLoaded(true);
      } catch {
        setVotesError('Failed to load voting history.');
        setVotesLoading(false);
        setVotesLoaded(true);
      }
    }

    fetchVotes();
  }, [activeTab, bioguide, votesLoaded, member]);

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
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-6 overflow-hidden">
        {/* Toggle */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginBottom: '16px', marginTop: '8px' }}>
          {(['year', 'ticker'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setTradeView(v)}
              style={{
                padding: '5px 18px',
                borderRadius: '9999px',
                border: '1px solid',
                fontSize: '12px',
                fontWeight: 600,
                cursor: 'pointer',
                transition: 'all 0.15s',
                borderColor: tradeView === v ? '#1d4ed8' : '#e5e7eb',
                background: tradeView === v ? '#1d4ed8' : '#f9fafb',
                color: tradeView === v ? '#fff' : '#6b7280',
              }}
            >
              {v === 'ticker' ? 'By Ticker' : 'By Year'}
            </button>
          ))}
        </div>
        <h2 style={{ marginTop: '4px', marginBottom: '14px', textAlign: 'center', fontSize: 'clamp(1.9rem, 8vw, 3rem)', fontWeight: 800, lineHeight: 1.05, color: '#1f2937' }}>
          Trades by {tradeView === 'ticker' ? 'Ticker' : 'Year'}
        </h2>
        <div className="w-full overflow-x-auto overflow-y-hidden">
          <TradeBarChart
            trades={purchaseTrades}
            saleTrades={saleTrades}
            color="#10b981"
            emptyMessage="No trades on record"
            groupByTicker={tradeView === 'ticker'}
            groupByYear={tradeView === 'year'}
          />
        </div>
      </div>
    ),
    [purchaseTrades, saleTrades, tradeView]
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
            {/* Party / chamber / term pills */}
              {(() => {
                const pillBg = pillBgForParty(member.party);
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
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-6 md:px-10 md:pb-14 md:pt-8" style={{ marginTop: '24px' }}>

        <TabBar activeTab={activeTab} onSelect={setActiveTab} />

        {/* Tab Content */}
        {activeTab === 'trades' ? (
          tradeCharts
        ) : activeTab === 'networth' ? (
          <div className="space-y-8">
            <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-6 overflow-hidden">
              <h2
                style={{
                  marginTop: '8px',
                  marginBottom: '6px',
                  textAlign: 'center',
                  fontSize: 'clamp(1.4rem, 5vw, 2rem)',
                  fontWeight: 800,
                  color: '#1e3a8a',
                }}
              >
                Net Worth Over Time
              </h2>
              <p style={{ textAlign: 'center', fontSize: '13px', color: '#9ca3af', marginBottom: '16px' }}>
                Estimated from annual financial disclosures
              </p>
              <NetWorthLineChart data={netWorthHistory} isLoading={historyLoading} />
            </div>
            <NetWorthSection netWorth={netWorth} disclosures={disclosuresSorted} />
          </div>
        ) : activeTab === 'voting' ? (
          <VotingHistoryTable votes={votes} isLoading={votesLoading} error={votesError} />
        ) : (
          <PotentialConflictsTable
            trades={trades as ConflictMemberTrade[]}
            votes={votes}
            isLoading={votesLoading}
            error={votesError}
          />
        )}
      </div>
    </div>
  );
}

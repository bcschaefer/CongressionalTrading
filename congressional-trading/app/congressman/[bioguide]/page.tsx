'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import TradeBarChart from '@/app/components/TradeBarChart';
import NetWorthSection, { type NetWorthData } from '@/app/components/NetWorthSection';
import NetWorthLineChart, { type NetWorthHistoryPoint } from '@/app/components/NetWorthLineChart';
import VotingHistoryTable, { type VoteRecord } from '@/app/components/VotingHistoryTable';
import PotentialConflictsTable from '@/app/components/PotentialConflictsTable';
import type { MemberTrade as ConflictMemberTrade } from '@/app/components/PotentialConflictsTable';
import type { AnnualDisclosureItem } from '../../components/StockDisclosuresMenu';
import Avatar from '@/app/components/ui/Avatar';
import StatCard from '@/app/components/ui/StatCard';
import GradientRule from '@/app/components/ui/GradientRule';
import { partyLabel, partyTokens } from '@/lib/party';

type MemberTrade = {
  id: number;
  bioguide: string;
  type: string;
  amount: number;
  ticker: string;
  assetName?: string | null;
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

type TabId = 'trades' | 'networth' | 'voting' | 'conflicts';
const TAB_LABELS: Record<TabId, string> = { trades: 'Trades', networth: 'Net Worth', voting: 'Voting History', conflicts: 'Potential Conflicts' };

function TabBar({ activeTab, onSelect }: { activeTab: TabId; onSelect: (tab: TabId) => void }) {
  return (
    <div className="mb-7 flex gap-2 border-b border-(--color-border)">
      {(Object.keys(TAB_LABELS) as TabId[]).map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onSelect(tab)}
          className={`-mb-px cursor-pointer border-0 border-b-2 bg-transparent px-5.5 py-2.5 text-sm transition-all duration-150 ${
            activeTab === tab
              ? 'border-(--color-accent) font-bold text-(--color-accent)'
              : 'border-transparent font-medium text-(--color-text-secondary) hover:border-(--color-border-strong) hover:text-foreground'
          }`}
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
  const [activeTab, setActiveTab] = useState<TabId>('trades');
  const [tradeView, setTradeView] = useState<'ticker' | 'year'>('year');
  const [netWorthHistory, setNetWorthHistory] = useState<NetWorthHistoryPoint[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [noElectronicDisclosures, setNoElectronicDisclosures] = useState(false);
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
        setNoElectronicDisclosures(!!data.noElectronicDisclosures);
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
      <div className="overflow-hidden rounded-md border border-(--color-border) bg-white p-6">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h2 className="text-lg font-bold text-foreground">
            Trades {tradeView === 'ticker' ? 'by Ticker' : '& Net Worth by Year'}
          </h2>
          {/* Toggle */}
          <div className="inline-flex rounded-sm border border-(--color-border)">
            {(['year', 'ticker'] as const).map((v, i) => (
              <button
                key={v}
                type="button"
                onClick={() => setTradeView(v)}
                className={`cursor-pointer px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 ${i === 0 ? 'rounded-l-[5px]' : 'rounded-r-[5px] border-l border-(--color-border)'} ${
                  tradeView === v ? 'bg-(--color-accent) text-white' : 'text-(--color-text-secondary) hover:bg-(--color-bg-subtle) hover:text-foreground'
                }`}
              >
                {v === 'ticker' ? 'By Ticker' : 'By Year'}
              </button>
            ))}
          </div>
        </div>
        {tradeView === 'year' ? (
          <TradeBarChart
            trades={purchaseTrades}
            saleTrades={saleTrades}
            color="var(--color-positive)"
            emptyMessage="No trades on record"
            groupByYear={true}
          />
        ) : (
          <div className="w-full overflow-x-auto overflow-y-hidden">
            <TradeBarChart
              trades={purchaseTrades}
              saleTrades={saleTrades}
              color="var(--color-positive)"
              emptyMessage="No trades on record"
              groupByTicker={true}
            />
          </div>
        )}
      </div>
    ),
    [purchaseTrades, saleTrades, tradeView]
  );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white">
        <p className="text-lg text-(--color-text-muted)">Loading…</p>
      </div>
    );
  }

  if (!member) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-white">
        <p className="text-lg text-(--color-text-secondary)">Member not found.</p>
        <button onClick={() => router.back()} className="cursor-pointer text-(--color-accent) transition-colors hover:text-(--color-accent-hover) hover:underline">← Back</button>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-white">
      {/* Header — solid party-colored banner (blue/red/violet for Dem/Rep/Independent) */}
      <div
        className="px-4 pb-7 pt-6 text-white md:px-10"
        style={{ backgroundColor: `var(${partyTokens(member.party).text})` }}
      >
        <div className="mx-auto max-w-7xl">
          <button onClick={() => router.back()} className="mb-5 inline-block cursor-pointer text-sm text-white/75 transition hover:text-white">
            ← Back
          </button>

          <div className="flex flex-col gap-5 md:flex-row md:items-center md:gap-6">
            <div className="-ml-4 shrink-0 md:-ml-10">
              <Avatar name={member.full_name} party={member.party} photoUrl={photoUrl} size="portrait" ringVar="--color-bg" />
            </div>

            {/* Info */}
            <div className="min-w-0">
              <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{member.full_name}</h1>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/85">
                {member.party && <span className="font-semibold">{partyLabel(member.party)}</span>}
                {member.chamber && <span className="capitalize font-semibold">{member.chamber}</span>}
                {member.district && <span>{member.district}</span>}
                <span className="font-mono text-xs text-white/60">{bioguide}</span>
                {member.termStart != null && (
                  <span>{member.termStart}–{member.is_active ? 'Present' : (member.termEnd ?? '?')}</span>
                )}
              </div>

              {/* Stats */}
              <div className="mt-4 flex flex-wrap gap-2.5">
                <StatCard label="Total Trades" value={trades.length} />
                <StatCard label="Purchases" value={purchaseTrades.length} valueColor="var(--color-positive)" />
                <StatCard label="Sales" value={saleTrades.length} valueColor="var(--color-negative)" />
                <StatCard label="Total Purchased" value={formatMoney(totalPurchases)} valueColor="var(--color-positive)" />
                <StatCard label="Total Sold" value={formatMoney(totalSales)} valueColor="var(--color-negative)" />
                <StatCard label="Most Traded" value={topTicker} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <GradientRule />

      {/* Graphs */}
      <div className="mx-auto max-w-7xl px-4 pb-12 pt-6 md:px-10 md:pb-14 md:pt-8">

        <TabBar activeTab={activeTab} onSelect={setActiveTab} />

        {/* Tab Content */}
        {activeTab === 'trades' ? (
          tradeCharts
        ) : activeTab === 'networth' ? (
          <div className="space-y-8">
            <div className="overflow-hidden rounded-md border border-(--color-border) bg-white p-6">
              <h2 className="mb-3.5 text-lg font-bold text-foreground">
                Estimated Net Worth
              </h2>
              <NetWorthLineChart
                data={netWorthHistory}
                isLoading={historyLoading}
                emptyMessage={
                  noElectronicDisclosures
                    ? 'No electronic disclosures available for this member.'
                    : 'No historical net worth data available.'
                }
              />
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

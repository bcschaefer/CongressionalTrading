'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import type { VoteRecord } from './VotingHistoryTable';

// Sectors that appear in the DB
type DbSector =
  | 'Basic Materials'
  | 'Communication Services'
  | 'Consumer Cyclical'
  | 'Consumer Defensive'
  | 'Consumer Goods'
  | 'Consumer Services'
  | 'Energy'
  | 'Financial Services'
  | 'Financials'
  | 'Healthcare'
  | 'Industrials'
  | 'Materials'
  | 'Real Estate'
  | 'Technology'
  | 'Utilities';

type SectorRule = {
  keywords: string[];
  sectors: DbSector[];
};

const SECTOR_RULES: SectorRule[] = [
  {
    keywords: [
      'technology', 'semiconductor', 'chip', 'cyber', 'software', 'artificial intelligence',
      ' ai ', 'cloud', 'broadband', 'internet', 'digital', 'data privacy', 'surveillance',
      'algorithm', 'social media', 'big tech', 'section 230', 'net neutrality', 'fcc',
    ],
    sectors: ['Technology', 'Communication Services'],
  },
  {
    keywords: [
      'health', 'medical', 'drug', 'pharma', 'medicare', 'medicaid', 'hospital',
      'opioid', 'fda', 'biotech', 'vaccine', 'prescription', 'aca', 'affordable care',
      'insurance', 'mental health', 'biomedical',
    ],
    sectors: ['Healthcare'],
  },
  {
    keywords: [
      'energy', 'oil', 'gas', 'pipeline', 'coal', 'renewable', 'solar', 'wind',
      'nuclear', 'electricity', 'fossil', 'lng', 'petroleum', 'climate', 'carbon',
      'emission', 'clean energy', 'green energy', 'drilling', 'fracking',
    ],
    sectors: ['Energy', 'Utilities'],
  },
  {
    keywords: [
      'bank', 'banking', 'financial', 'lending', 'credit', 'mortgage', 'wall street',
      'interest rate', 'federal reserve', 'crypto', 'bitcoin', 'securities', 'invest',
      'hedge fund', 'private equity', 'fintech', 'dodd-frank', 'cfpb',
    ],
    sectors: ['Financial Services', 'Financials'],
  },
  {
    keywords: [
      'defense', 'military', 'army', 'navy', 'air force', 'weapon', 'missile',
      'pentagon', 'nato', 'sanctions', 'aerospace', 'national security', 'warfare',
    ],
    sectors: ['Industrials'],
  },
  {
    keywords: [
      'retail', 'tariff', 'import', 'export', 'manufacturing', 'supply chain',
      'consumer goods', 'amazon', 'ecommerce', 'trade war',
    ],
    sectors: ['Consumer Cyclical', 'Consumer Defensive', 'Consumer Goods', 'Consumer Services'],
  },
  {
    keywords: [
      'housing', 'real estate', 'construction', 'zoning', 'hud',
      'eviction', 'rent', 'landlord', 'affordable housing',
    ],
    sectors: ['Real Estate'],
  },
  {
    keywords: [
      'telecom', 'broadcast', 'media', 'cable', 'wireless', 'spectrum',
    ],
    sectors: ['Communication Services'],
  },
  {
    keywords: [
      'mining', 'steel', 'aluminum', 'copper', 'chemical', 'materials',
      'rare earth', 'lithium',
    ],
    sectors: ['Basic Materials', 'Materials'],
  },
  {
    keywords: [
      'airline', 'railroad', 'aviation', 'infrastructure', 'highway',
      'transit', 'shipping', 'freight', 'logistics',
    ],
    sectors: ['Industrials'],
  },
  {
    keywords: [
      'utility', 'utilities', 'power grid', 'water', 'electric',
    ],
    sectors: ['Utilities'],
  },
];

// Returns the matched sectors and the keyword that triggered the match
function detectSectors(text: string): { sectors: DbSector[]; keyword: string } | null {
  const lower = text.toLowerCase();
  for (const rule of SECTOR_RULES) {
    for (const kw of rule.keywords) {
      if (lower.includes(kw)) {
        return { sectors: rule.sectors, keyword: kw.trim() };
      }
    }
  }
  return null;
}

function daysBetween(a: string, b: string): number {
  const msPerDay = 86400000;
  return Math.round((new Date(a).getTime() - new Date(b).getTime()) / msPerDay);
}

function normalizeVoteLabel(raw: string): string {
  const v = raw?.toLowerCase().trim();
  if (v === 'yea' || v === 'aye' || v === 'yes') return 'Yes';
  if (v === 'nay' || v === 'no') return 'No';
  return 'Abstained';
}

function formatMoney(n: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n);
}

export type MemberTrade = {
  id: number;
  bioguide: string;
  type: string;
  amount: number;
  ticker: string;
  date: string;
  sector: string;
};

type ConflictRecord = {
  voteDate: string;
  voteQuestion: string;
  voteDescription: string;
  memberVoted: string;
  matchedSectors: DbSector[];
  matchedKeyword: string;
  ticker: string;
  tradeType: string;
  tradeAmount: number;
  tradeDate: string;
  tradeSector: string;
  deltaDays: number; // negative = trade before vote, positive = trade after
  conflictType: 'active-trade' | 'holding';
};

function tradeLabel(type: string): string {
  const n = type.trim().toUpperCase();
  if (n === 'P' || n.startsWith('PURCHASE') || n.startsWith('BUY')) return 'Purchase';
  if (n === 'S' || n.startsWith('SALE') || n.startsWith('SELL')) return 'Sale';
  return type;
}

type Props = {
  trades: MemberTrade[];
  votes: VoteRecord[];
  isLoading: boolean;
  error: string | null;
};

const WINDOW_DAYS = 60;

function isTradeDirection(type: string, dir: 'purchase' | 'sale'): boolean {
  const n = type.trim().toUpperCase();
  if (dir === 'purchase') return n === 'P' || n.startsWith('PURCHASE') || n.startsWith('BUY');
  return n === 'S' || n.startsWith('SALE') || n.startsWith('SELL');
}

type GroupedConflict = {
  voteDate: string;
  voteQuestion: string;
  voteDescription: string;
  memberVoted: string;
  matchedKeyword: string;
  trades: ConflictRecord[];
};

export default function PotentialConflictsTable({ trades, votes, isLoading, error }: Props) {
  const conflicts = useMemo<ConflictRecord[]>(() => {
    if (!votes.length || !trades.length) return [];

    const results: ConflictRecord[] = [];
    // Track (voteDate, ticker) pairs already added as active-trade so we don't double-count
    const activePairs = new Set<string>();

    // --- Pass 1: active trades within ±WINDOW_DAYS ---
    for (const vote of votes) {
      if (!vote.date) continue;
      const combined = `${vote.question} ${vote.description}`;
      const match = detectSectors(combined);
      if (!match) continue;

      for (const trade of trades) {
        if (!trade.date || !trade.sector) continue;
        const tradeSectorLower = trade.sector.toLowerCase();
        const sectorMatches = match.sectors.some(
          (s) => tradeSectorLower.includes(s.toLowerCase()) || s.toLowerCase().includes(tradeSectorLower)
        );
        if (!sectorMatches) continue;

        const delta = daysBetween(trade.date, vote.date);
        if (Math.abs(delta) > WINDOW_DAYS) continue;

        const pairKey = `${vote.date}|${trade.ticker}`;
        activePairs.add(pairKey);

        results.push({
          voteDate: vote.date,
          voteQuestion: vote.question,
          voteDescription: vote.description,
          memberVoted: vote.memberVoted,
          matchedSectors: match.sectors,
          matchedKeyword: match.keyword,
          ticker: trade.ticker,
          tradeType: trade.type,
          tradeAmount: trade.amount,
          tradeDate: trade.date,
          tradeSector: trade.sector,
          deltaDays: delta,
          conflictType: 'active-trade',
        });
      }
    }

    // --- Pass 2: holdings at vote time ---
    // For each ticker, build a timeline of trades sorted by date
    const byTicker = new Map<string, MemberTrade[]>();
    for (const trade of trades) {
      if (!trade.date || !trade.ticker) continue;
      const list = byTicker.get(trade.ticker) ?? [];
      list.push(trade);
      byTicker.set(trade.ticker, list);
    }
    for (const [, list] of byTicker) {
      list.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    }

    for (const vote of votes) {
      if (!vote.date) continue;
      const combined = `${vote.question} ${vote.description}`;
      const match = detectSectors(combined);
      if (!match) continue;

      const voteTs = new Date(vote.date).getTime();

      for (const [ticker, tradeList] of byTicker) {
        const pairKey = `${vote.date}|${ticker}`;
        // skip if already covered by an active-trade conflict
        if (activePairs.has(pairKey)) continue;

        // check sector match using the sector of the most recent trade before vote
        const tradesBeforeVote = tradeList.filter((t) => new Date(t.date).getTime() <= voteTs);
        if (!tradesBeforeVote.length) continue;

        const lastTrade = tradesBeforeVote[tradesBeforeVote.length - 1];
        if (!isTradeDirection(lastTrade.type, 'purchase')) continue; // last action was a sale — not holding

        // check sector
        const tradeSectorLower = lastTrade.sector?.toLowerCase() ?? '';
        const sectorMatches = match.sectors.some(
          (s) => tradeSectorLower.includes(s.toLowerCase()) || s.toLowerCase().includes(tradeSectorLower)
        );
        if (!sectorMatches) continue;

        // Use the most recent purchase before the vote as the representative trade
        const lastPurchase = [...tradesBeforeVote].reverse().find((t) => isTradeDirection(t.type, 'purchase'))!;
        const delta = daysBetween(lastPurchase.date, vote.date); // negative: purchased before vote

        results.push({
          voteDate: vote.date,
          voteQuestion: vote.question,
          voteDescription: vote.description,
          memberVoted: vote.memberVoted,
          matchedSectors: match.sectors,
          matchedKeyword: match.keyword,
          ticker,
          tradeType: lastPurchase.type,
          tradeAmount: lastPurchase.amount,
          tradeDate: lastPurchase.date,
          tradeSector: lastTrade.sector ?? '',
          deltaDays: delta,
          conflictType: 'holding',
        });
      }
    }

    // Deduplicate and sort: active-trade first (by |delta|), then holdings (by |delta|)
    const seen = new Set<string>();
    return results
      .filter((c) => {
        const key = `${c.voteDate}|${c.ticker}|${c.tradeDate}|${c.conflictType}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        if (a.conflictType !== b.conflictType) return a.conflictType === 'active-trade' ? -1 : 1;
        return Math.abs(a.deltaDays) - Math.abs(b.deltaDays);
      });
  }, [trades, votes]);

  const notReady = isLoading;

  // Group conflicts by vote (voteDate + voteQuestion)
  const grouped = useMemo<GroupedConflict[]>(() => {
    const map = new Map<string, GroupedConflict>();
    for (const c of conflicts) {
      const key = `${c.voteDate}|${c.voteQuestion}`;
      if (!map.has(key)) {
        map.set(key, {
          voteDate: c.voteDate,
          voteQuestion: c.voteQuestion,
          voteDescription: c.voteDescription,
          memberVoted: c.memberVoted,
          matchedKeyword: c.matchedKeyword,
          trades: [],
        });
      }
      map.get(key)!.trades.push(c);
    }
    return [...map.values()];
  }, [conflicts]);

  return (
    <div className="overflow-hidden rounded-md border border-(--color-border) bg-white">
      <div className="px-6 pb-2 pt-6">
        <h2 className="mb-1 text-lg font-bold text-(--color-text-primary)">Potential Conflicts of Interest</h2>
        <p className="mb-1 text-[13px] text-(--color-text-muted)">
          Trades within {WINDOW_DAYS} days of a related vote, plus holdings at vote time
        </p>
        {!notReady && grouped.length > 0 && (
          <p className="mb-3 text-xs text-(--color-text-secondary)">
            {conflicts.length} potential conflict{conflicts.length !== 1 ? 's' : ''} across {grouped.length} vote{grouped.length !== 1 ? 's' : ''}
          </p>
        )}
      </div>

      {notReady ? (
        <div className="p-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-[3px] border-(--color-border) border-t-(--color-accent)" />
          <p className="mt-3 text-[13px] text-(--color-text-muted)">Loading data…</p>
        </div>
      ) : error && !votes.length ? (
        <div className="p-12 text-center">
          <p className="text-sm text-(--color-text-muted)">{error}</p>
        </div>
      ) : grouped.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-sm font-semibold text-(--color-text-secondary)">No conflicts detected</p>
          <p className="mt-1 text-xs text-(--color-text-muted)">
            No trades or holdings matched the sectors of recent votes.
          </p>
        </div>
      ) : (
        <div className="max-h-[600px] overflow-y-auto px-4 pb-4">
          {grouped.map((group, gi) => {
            const voteLabel = normalizeVoteLabel(group.memberVoted);
            const voteDateStr = new Date(group.voteDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const voteTextVar = voteLabel === 'Yes' ? '--color-positive' : voteLabel === 'No' ? '--color-negative' : '--color-text-muted';
            const voteBgVar = voteLabel === 'Yes' ? '--color-positive-bg' : voteLabel === 'No' ? '--color-negative-bg' : '--color-bg-subtle';

            return (
              <div key={gi} className="mt-3 overflow-hidden rounded-md border border-(--color-border)">
                {/* Vote header */}
                <div className="flex flex-wrap items-start gap-2.5 border-b border-(--color-border) bg-(--color-bg-subtle) px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 line-clamp-2 text-[13px] font-bold leading-normal text-(--color-text-primary)">
                      {group.voteQuestion}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[11px] text-(--color-text-muted)">{voteDateStr}</span>
                      <span className="rounded-sm bg-(--color-chip-bg) px-1.5 py-0.5 text-[10px] font-semibold text-(--color-chip-text)">
                        matched on &ldquo;{group.matchedKeyword}&rdquo;
                      </span>
                    </div>
                  </div>
                  <span
                    className="inline-block shrink-0 whitespace-nowrap rounded-sm px-3 py-1 text-xs font-bold"
                    style={{ background: `var(${voteBgVar})`, color: `var(${voteTextVar})` }}
                  >
                    Voted {voteLabel}
                  </span>
                </div>

                {/* Related trades */}
                <div className="flex flex-wrap gap-1.5 px-3.5 py-2.5">
                  {group.trades.map((c, ti) => {
                    const isHolding = c.conflictType === 'holding';
                    const label = isHolding ? 'Held' : tradeLabel(c.tradeType);
                    const labelColor = isHolding ? 'var(--color-text-muted)' : label === 'Purchase' ? 'var(--color-positive)' : 'var(--color-negative)';
                    const absDelta = Math.abs(c.deltaDays);
                    const direction = c.deltaDays < 0 ? 'before' : c.deltaDays === 0 ? 'same day' : 'after';
                    const deltaLabel = isHolding
                      ? `${absDelta}d held`
                      : absDelta === 0 ? 'same day' : `${absDelta}d ${direction}`;

                    return (
                      <Link
                        key={ti}
                        href={`/stocks/${c.ticker}`}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-sm border border-(--color-border) px-2.5 py-1 transition-all duration-150 hover:-translate-y-0.5 hover:border-(--color-accent) hover:shadow-sm"
                      >
                        <span className="rounded-sm bg-(--color-chip-bg) px-1.5 py-0.5 text-xs font-bold text-(--color-chip-text)">{c.ticker}</span>
                        <span className="text-xs font-medium" style={{ color: labelColor }}>{label}</span>
                        <span className="text-[11px] text-(--color-text-secondary)">{formatMoney(c.tradeAmount)}</span>
                        <span className="text-[10px] text-(--color-text-muted)">{deltaLabel}</span>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Disclaimer */}
      {!notReady && (
        <div className="border-t border-(--color-border) px-5 pb-3.5 pt-2.5">
          <p className="m-0 text-center text-[11px] text-(--color-text-muted)">
            Conflicts are detected by matching vote topics to trade sectors using keyword analysis. Holdings are estimated from disclosed trade history. This is not legal analysis — correlation does not imply wrongdoing.
          </p>
        </div>
      )}
    </div>
  );
}

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

  return (
    <div className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
      <div style={{ padding: '24px 24px 8px' }}>
        <h2
          style={{
            fontSize: 'clamp(1.4rem, 5vw, 2rem)',
            fontWeight: 800,
            color: '#1f2937',
            marginBottom: '4px',
            textAlign: 'center',
          }}
        >
          Potential Conflicts of Interest
        </h2>
        <p style={{ textAlign: 'center', fontSize: '13px', color: '#9ca3af', marginBottom: '4px' }}>
          Trades within {WINDOW_DAYS} days of a related vote, plus holdings at vote time
        </p>
        {!notReady && conflicts.length > 0 && (
          <p style={{ textAlign: 'center', fontSize: '12px', color: '#6b7280', marginBottom: '12px' }}>
            {conflicts.length} potential conflict{conflicts.length !== 1 ? 's' : ''} detected
          </p>
        )}
      </div>

      {notReady ? (
        <div style={{ padding: '48px', textAlign: 'center' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              border: '3px solid #e0e7ff',
              borderTopColor: '#3b82f6',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto',
            }}
          />
          <p style={{ marginTop: '12px', fontSize: '13px', color: '#9ca3af' }}>Loading data…</p>
        </div>
      ) : error && !votes.length ? (
        <div style={{ padding: '48px', textAlign: 'center' }}>
          <p style={{ fontSize: '14px', color: '#9ca3af' }}>{error}</p>
        </div>
      ) : conflicts.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center' }}>
          <p style={{ fontSize: '14px', color: '#6b7280', fontWeight: 600 }}>No conflicts detected</p>
          <p style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
            No trades or holdings matched the sectors of recent votes.
          </p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '560px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Vote</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 600, color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Voted</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Trade</th>
                <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Δ Days</th>
              </tr>
            </thead>
            <tbody>
              {conflicts.map((c, i) => {
                const voteLabel = normalizeVoteLabel(c.memberVoted);
                const voteDateStr = new Date(c.voteDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const tradeDateStr = new Date(c.tradeDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const direction = c.deltaDays < 0 ? 'before' : c.deltaDays === 0 ? 'same day as' : 'after';
                const absDelta = Math.abs(c.deltaDays);
                return (
                  <tr
                    key={i}
                    style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafafa' }}
                  >
                    {/* Vote */}
                    <td style={{ padding: '10px 14px', color: '#1f2937', maxWidth: '380px', lineHeight: 1.5, verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 600, marginBottom: '2px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                        {c.voteQuestion}
                      </div>
                      <div style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '2px' }}>
                        {voteDateStr}
                      </div>
                      <div style={{ fontSize: '11px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            padding: '1px 6px',
                            borderRadius: '4px',
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            fontWeight: 600,
                            fontSize: '10px',
                          }}
                        >
                          {c.tradeSector}
                        </span>
                        {' '}
                        <span style={{ color: '#9ca3af' }}>matched on &ldquo;{c.matchedKeyword}&rdquo;</span>
                      </div>
                    </td>

                    {/* Voted */}
                    <td style={{ padding: '10px 14px', textAlign: 'center', verticalAlign: 'top' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: '9999px',
                          background: voteLabel === 'Yes' ? '#f0fdf4' : voteLabel === 'No' ? '#fef2f2' : '#f9fafb',
                          color: voteLabel === 'Yes' ? '#16a34a' : voteLabel === 'No' ? '#dc2626' : '#9ca3af',
                          fontWeight: 700,
                          fontSize: '12px',
                        }}
                      >
                        {voteLabel}
                      </span>
                    </td>

                    {/* Trade */}
                    <td style={{ padding: '10px 14px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      <Link
                        href={`/stocks/${c.ticker}`}
                        style={{ fontWeight: 700, color: '#1d4ed8', textDecoration: 'none' }}
                      >
                        {c.ticker}
                      </Link>
                      {c.conflictType === 'holding' ? (
                        <div style={{ fontSize: '11px', color: '#7c3aed', fontWeight: 600 }}>Held</div>
                      ) : (
                        <div style={{ fontSize: '11px', color: tradeLabel(c.tradeType) === 'Purchase' ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                          {tradeLabel(c.tradeType)}
                        </div>
                      )}
                      <div style={{ fontSize: '11px', color: '#6b7280' }}>{formatMoney(c.tradeAmount)}</div>
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                        {c.conflictType === 'holding' ? `since ${tradeDateStr}` : tradeDateStr}
                      </div>
                    </td>

                    {/* Δ Days */}
                    <td style={{ padding: '10px 14px', textAlign: 'right', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                      {c.conflictType === 'holding' ? (
                        <>
                          <span style={{ fontWeight: 700, color: '#7c3aed', fontSize: '14px' }}>{absDelta}d</span>
                          <div style={{ fontSize: '10px', color: '#9ca3af' }}>held at vote</div>
                        </>
                      ) : (
                        <>
                          <span style={{ fontWeight: 700, color: '#374151', fontSize: '14px' }}>
                            {absDelta === 0 ? '0' : `${absDelta}d`}
                          </span>
                          <div style={{ fontSize: '10px', color: '#9ca3af' }}>{direction} vote</div>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Disclaimer */}
      {!notReady && (
        <div style={{ padding: '10px 20px 14px', borderTop: '1px solid #f3f4f6' }}>
          <p style={{ fontSize: '11px', color: '#9ca3af', textAlign: 'center', margin: 0 }}>
            Conflicts are detected by matching vote topics to trade sectors using keyword analysis. Holdings are estimated from disclosed trade history. This is not legal analysis — correlation does not imply wrongdoing.
          </p>
        </div>
      )}
    </div>
  );
}

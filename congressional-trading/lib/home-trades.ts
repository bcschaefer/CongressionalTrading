export type HomeTrade = {
  id: number;
  bioguide: string;
  congressman: string;
  chamber: string | null;
  party: string | null;
  type: string;
  amount: number;
  ticker: string;
  date: string;
  datePublished: string | null;
  description: string;
};

export type CongressmanGroup = {
  bioguide: string;
  congressman: string;
  chamber: string | null;
  party: string | null;
  trades: HomeTrade[];
  latestDate: string;
  totalAmount: number;
};

export type TradeDirection = 'purchase' | 'sale' | 'other';

export function getTradeDirection(type: string): TradeDirection {
  const normalized = type.trim().toUpperCase();

  if (
    normalized === 'P' ||
    normalized === 'PURCHASE' ||
    normalized === 'BUY' ||
    normalized.startsWith('PURCHASE') ||
    normalized.startsWith('BUY')
  ) {
    return 'purchase';
  }

  if (
    normalized === 'S' ||
    normalized === 'SALE' ||
    normalized === 'SELL' ||
    normalized.startsWith('SALE') ||
    normalized.startsWith('SELL')
  ) {
    return 'sale';
  }

  return 'other';
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatDate(date: string): string {
  if (!date) {
    return 'Unknown';
  }

  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return date;
  }

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}

/** Days between a trade and when it was publicly disclosed, e.g. "+6". Null if either date is missing/invalid. */
export function getPublishDelayLabel(dateTraded: string, datePublished: string | null): string | null {
  if (!dateTraded || !datePublished) return null;

  const traded = new Date(`${dateTraded}T00:00:00Z`);
  const published = new Date(`${datePublished}T00:00:00Z`);
  if (Number.isNaN(traded.getTime()) || Number.isNaN(published.getTime())) return null;

  const days = Math.round((published.getTime() - traded.getTime()) / 86_400_000);
  return days >= 0 ? `+${days}` : `${days}`;
}

export function getTradeCountLabel(count: number): string {
  return count === 1 ? '1 trade' : `${count} trades`;
}

export function groupTradesByCongressman(trades: HomeTrade[]): CongressmanGroup[] {
  const groupMap = new Map<string, HomeTrade[]>();

  for (const trade of trades) {
    const existing = groupMap.get(trade.bioguide) ?? [];
    existing.push(trade);
    groupMap.set(trade.bioguide, existing);
  }

  return Array.from(groupMap.entries())
    .map(([bioguide, memberTrades]) => {
      const sortedTrades = [...memberTrades].sort((a, b) => b.date.localeCompare(a.date));
      return {
        bioguide,
        congressman: memberTrades[0].congressman,
        chamber: memberTrades[0].chamber ?? null,
        party: memberTrades[0].party ?? null,
        trades: sortedTrades,
        latestDate: sortedTrades[0]?.date ?? '',
        totalAmount: sortedTrades.reduce((sum, trade) => sum + trade.amount, 0),
      };
    })
    .sort((a, b) => {
      const byTradeCount = b.trades.length - a.trades.length;
      if (byTradeCount !== 0) {
        return byTradeCount;
      }

      return b.totalAmount - a.totalAmount;
    });
}

export type TraderSortMode = 'prolific' | 'recent';

export function sortCongressmanGroups(groups: CongressmanGroup[], mode: TraderSortMode): CongressmanGroup[] {
  if (mode === 'prolific') {
    return groups;
  }

  return [...groups].sort((a, b) => b.latestDate.localeCompare(a.latestDate));
}

export type HomeTrade = {
  id: number;
  bioguide: string;
  congressman: string;
  type: string;
  amount: number;
  ticker: string;
  date: string;
  description: string;
};

export type CongressmanGroup = {
  bioguide: string;
  congressman: string;
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

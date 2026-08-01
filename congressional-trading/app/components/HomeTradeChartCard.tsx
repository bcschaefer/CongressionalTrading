import TradeBarChart from './TradeBarChart';
import type { HomeTrade } from '@/lib/home-trades';

type HomeTradeChartCardProps = {
  isLoading: boolean;
  emptyMessage: string;
  purchaseTrades: HomeTrade[];
  saleTrades: HomeTrade[];
};

export default function HomeTradeChartCard({
  isLoading,
  emptyMessage,
  purchaseTrades,
  saleTrades,
}: HomeTradeChartCardProps) {
  const isEmpty = purchaseTrades.length === 0 && saleTrades.length === 0;
  return (
    <div className="overflow-hidden rounded-md border border-(--color-border) bg-white p-4">
      {isLoading || isEmpty ? (
        <div className="flex min-h-80 items-center justify-center rounded-sm border border-dashed border-(--color-border) bg-(--color-bg-subtle) text-sm font-semibold text-(--color-text-secondary)">
          {isLoading ? 'Loading chart data...' : 'Hover a trader to see their trades'}
        </div>
      ) : (
        <div style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden' }}>
          <TradeBarChart
            trades={purchaseTrades}
            saleTrades={saleTrades}
            color="var(--color-positive)"
            emptyMessage={emptyMessage}
            groupByYear={true}
          />
        </div>
      )}
    </div>
  );
}

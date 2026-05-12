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
    <div className="bg-white p-4 rounded-xl shadow-xl border border-gray-200 overflow-hidden">
      {isLoading || isEmpty ? (
        <div className="flex min-h-80 items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 text-sm font-semibold text-gray-500">
          {isLoading ? 'Loading chart data...' : 'Hover a trader to see their trades'}
        </div>
      ) : (
        <div style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden' }}>
          <TradeBarChart
            trades={purchaseTrades}
            saleTrades={saleTrades}
            color="#10b981"
            emptyMessage={emptyMessage}
            groupByYear={true}
          />
        </div>
      )}
    </div>
  );
}

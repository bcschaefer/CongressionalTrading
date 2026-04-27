import TradeBarChart from './TradeBarChart';
import type { HomeTrade } from '@/lib/home-trades';

type HomeTradeChartCardProps = {
  title: string;
  titleTextColor: string;
  titleBorderColor: string;
  titleBackgroundColor: string;
  chartColor: string;
  emptyMessage: string;
  trades: HomeTrade[];
};

export default function HomeTradeChartCard({
  title,
  titleTextColor,
  titleBorderColor,
  titleBackgroundColor,
  chartColor,
  emptyMessage,
  trades,
}: HomeTradeChartCardProps) {
  return (
    <div>
      <h3
        style={{
          marginTop: '1rem',
          borderRadius: '0.75rem',
          border: `1px solid ${titleBorderColor}`,
          backgroundColor: titleBackgroundColor,
          padding: '0.75rem 1rem',
          textAlign: 'center',
          fontSize: '1.5rem',
          fontWeight: 900,
          letterSpacing: '0.025em',
          color: titleTextColor,
          boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        }}
      >
        {title}
      </h3>
      <div className="bg-white p-4 rounded-xl shadow-xl border border-gray-200 overflow-hidden">
        <div style={{ width: '100%', overflowX: 'auto', overflowY: 'hidden' }}>
          <TradeBarChart
            trades={trades}
            color={chartColor}
            emptyMessage={emptyMessage}
            groupByTicker={true}
          />
        </div>
      </div>
    </div>
  );
}

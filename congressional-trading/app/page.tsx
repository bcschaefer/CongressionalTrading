'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import HomeTradeChartCard from './components/HomeTradeChartCard';
import ProlificTradersTable from './components/ProlificTradersTable';
import {
  getTradeDirection,
  groupTradesByCongressman,
  type HomeTrade,
} from '@/lib/home-trades';

export default function Hero() {
  const router = useRouter();
  const [recentTrades, setRecentTrades] = useState<HomeTrade[]>([]);
  const [selectedBioguide, setSelectedBioguide] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const loadTrades = async () => {
      let attempt = 0;
      const maxAttempts = 3;

      while (attempt < maxAttempts && !cancelled) {
        try {
          const response = await fetch('/api/recent-trades', { cache: 'no-store' });
          if (!response.ok) {
            throw new Error(`recent-trades request failed: ${response.status}`);
          }

          const data = await response.json();
          const trades: HomeTrade[] = Array.isArray(data.trades) ? data.trades : [];
          if (cancelled) {
            return;
          }

          setRecentTrades(trades);
          setSelectedBioguide(trades.length > 0 ? trades[0].bioguide : null);
          return;
        } catch {
          attempt += 1;
          if (attempt >= maxAttempts || cancelled) {
            return;
          }

          // Brief backoff to survive transient dev-server/API restarts.
          await new Promise((resolve) => setTimeout(resolve, 350 * attempt));
        }
      }
    };

    loadTrades();

    return () => {
      cancelled = true;
    };
  }, []);

  const groupedCongressmen = useMemo(() => groupTradesByCongressman(recentTrades), [recentTrades]);

  const selectedGroup = useMemo(
    () => groupedCongressmen.find((group) => group.bioguide === selectedBioguide) ?? null,
    [groupedCongressmen, selectedBioguide]
  );

  const purchaseTrades = selectedGroup
    ? selectedGroup.trades.filter((trade) => getTradeDirection(trade.type) === 'purchase')
    : [];
  const saleTrades = selectedGroup
    ? selectedGroup.trades.filter((trade) => getTradeDirection(trade.type) === 'sale')
    : [];

  return (
    <div>
      <div className="px-4 py-8 md:px-8" style={{ background: 'linear-gradient(135deg, #f9fafb 0%, #eff6ff 100%)' }}>
        <div
          className="mx-auto max-w-400"
          style={{ display: 'flex', gap: '2rem', alignItems: 'stretch' }}
        >
        <div style={{ width: '50%', minWidth: 0 }}>
          <div className="mb-6">
            <HomeTradeChartCard
              title="Purchases"
              titleTextColor="#15803d"
              titleBorderColor="#bbf7d0"
              titleBackgroundColor="#dcfce7"
              chartColor="#10b981"
              emptyMessage="No purchase trades in current data"
              trades={purchaseTrades}
            />
          </div>
          <div>
            <HomeTradeChartCard
              title="Sales"
              titleTextColor="#b91c1c"
              titleBorderColor="#fecaca"
              titleBackgroundColor="#fee2e2"
              chartColor="#ef4444"
              emptyMessage="No sale trades in current data"
              trades={saleTrades}
            />
          </div>
        </div>

        <div style={{ width: '50%', minWidth: 0 }}>
          <h2 style={{ marginBottom: '1.5rem', textAlign: 'center', fontSize: '1.875rem', fontWeight: 900, letterSpacing: '0.025em', color: '#6b21a8' }}>Most Prolific Traders</h2>
          <ProlificTradersTable
            groups={groupedCongressmen}
            selectedBioguide={selectedBioguide}
            onHoverRow={setSelectedBioguide}
            onOpenMember={(bioguide) => router.push(`/congressman/${bioguide}`)}
          />
        </div>
        </div> 
      </div>
    </div>
  );
}
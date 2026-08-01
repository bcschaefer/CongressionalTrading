'use client';

import { useMemo, useRef, useState } from 'react';
import NetWorthDonutChart, { CATEGORY_COLORS } from './NetWorthDonutChart';
import StatCard from './ui/StatCard';
import type { AnnualDisclosureItem } from './StockDisclosuresMenu';

type AssetEntry = {
  name: string;
  typeCode: string;
  owner: string;
  category: string;
  valueLow: number;
  valueHigh: number;
  valueMid: number;
};

type LiabilityEntry = {
  creditor: string;
  loanType: string;
  owner: string;
  valueLow: number;
  valueHigh: number;
  valueMid: number;
};

export type NetWorthData = {
  filing: { doc_id: string; filing_year: number; filing_date: string | null } | null;
  assets: AssetEntry[];
  liabilities: LiabilityEntry[];
  stocks: AssetEntry[];
  byCategory: Record<string, { total: number; count: number }>;
  summary: { totalAssets: number; totalLiabilities: number; estimatedNetWorth: number } | null;
  noElectronicDisclosures?: boolean;
  error?: string;
};

function formatMoney(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function NetWorthSection({
  netWorth,
  disclosures = [],
}: {
  netWorth: NetWorthData | null;
  disclosures?: AnnualDisclosureItem[];
}) {
  const [assetSort, setAssetSort] = useState<{
    key: 'name' | 'typeCode' | 'owner' | 'valueMid';
    direction: 'asc' | 'desc';
  }>({ key: 'valueMid', direction: 'desc' });
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const sortedAssets = useMemo(() => {
    const assets = [...(netWorth?.assets ?? [])];
    assets.sort((a, b) => {
      if (assetSort.key === 'valueMid') {
        return assetSort.direction === 'asc' ? a.valueMid - b.valueMid : b.valueMid - a.valueMid;
      }

      const aVal = String(a[assetSort.key] ?? '').toLowerCase();
      const bVal = String(b[assetSort.key] ?? '').toLowerCase();
      const cmp = aVal.localeCompare(bVal);
      return assetSort.direction === 'asc' ? cmp : -cmp;
    });
    return assets;
  }, [netWorth?.assets, assetSort]);

  const totalListedAssets = sortedAssets.reduce((sum, asset) => sum + asset.valueMid, 0);

  function toggleAssetSort(key: 'name' | 'typeCode' | 'owner' | 'valueMid') {
    setAssetSort((prev) => {
      if (prev.key === key) {
        return { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: key === 'valueMid' ? 'desc' : 'asc' };
    });
  }

  function sortIndicator(key: 'name' | 'typeCode' | 'owner' | 'valueMid') {
    if (assetSort.key !== key) return '↕';
    return assetSort.direction === 'asc' ? '↑' : '↓';
  }

  function sortHeaderClass(key: 'name' | 'typeCode' | 'owner' | 'valueMid') {
    return assetSort.key === key ? 'text-foreground' : 'text-(--color-text-muted)';
  }

  return (
    <div className="overflow-hidden rounded-md border border-(--color-border) bg-white p-6 pb-10">
      <h2 className="mb-1 text-lg font-bold text-foreground">Estimated Net Worth</h2>
      {netWorth?.filing && (
        <>
          <p className="mb-3 text-sm text-(--color-text-muted)">
            from {netWorth.filing.filing_year} Annual Financial Disclosure
          </p>
          {disclosures.length > 0 && (
            <div ref={dropdownRef} className="relative mb-4.5 flex">
              <button
                type="button"
                onClick={() => setDropdownOpen((v) => !v)}
                className="inline-flex cursor-pointer items-center gap-3.5 rounded-sm border border-(--color-border) bg-white px-3 py-1.5 text-[13px] font-semibold text-foreground"
              >
                View Disclosures ({disclosures.length})
                <span
                  className="inline-block text-[11px] transition-transform duration-200"
                  style={{ transform: dropdownOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}
                >
                  ▸
                </span>
              </button>
              {dropdownOpen && (
                <div className="absolute top-[calc(100%+6px)] left-1/2 z-50 max-h-65 w-[min(280px,calc(100vw-48px))] -translate-x-1/2 overflow-y-auto rounded-md border border-(--color-border) bg-white py-1.5">
                  {disclosures.map((d) => (
                    <a
                      key={d.id}
                      href={
                        d.source_url && /efdsearch\.senate\.gov\//i.test(d.source_url)
                          ? d.source_url
                          : `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${d.filing_year}/${d.doc_id}.pdf`
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center justify-between border-b border-(--color-border) px-4 py-2 text-[13px] text-foreground last:border-b-0 hover:bg-(--color-bg-subtle)"
                    >
                      <span className="font-semibold">
                        {d.filing_year}{' '}
                        {d.filing_type === 'O' ? 'Original' : d.filing_type === 'A' ? 'Amendment' : d.filing_type === 'C' ? 'Candidate' : d.filing_type === 'SENATE_ANNUAL' ? 'Annual' : d.filing_type}
                      </span>
                      {d.filing_date && (
                        <span className="ml-3 text-xs text-(--color-text-muted)">
                          {new Date(d.filing_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </span>
                      )}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {!netWorth && (
        <p className="py-8 text-center text-sm text-(--color-text-muted)">
          Loading financial data…
        </p>
      )}

      {netWorth?.noElectronicDisclosures && (
        <p className="py-8 text-center text-sm text-(--color-text-muted)">
          No electronic disclosures available for this member — their financial disclosures were
          filed as scanned paper documents, which can&apos;t be parsed into an assets/liabilities breakdown.
        </p>
      )}

      {netWorth && !netWorth.summary && !netWorth.noElectronicDisclosures && (
        <p className="py-8 text-center text-sm text-(--color-text-muted)">
          No annual disclosure data available for this member.
        </p>
      )}

      {netWorth?.summary && (
        <>
          <div className="mb-7 flex flex-wrap gap-3">
            <StatCard label="Est. Total Assets" value={formatMoney(netWorth.summary.totalAssets)} valueColor="var(--color-positive)" />
            <StatCard label="Est. Liabilities" value={`(${formatMoney(netWorth.summary.totalLiabilities)})`} valueColor="var(--color-negative)" />
            <StatCard label="Est. Net Worth" value={formatMoney(netWorth.summary.estimatedNetWorth)} />
          </div>

          <div className="mb-1 w-full overflow-x-auto">
            <NetWorthDonutChart byCategory={netWorth.byCategory} />
          </div>


          {netWorth.assets.length > 0 && (
            <>
              <div className="mb-3 ml-1 flex flex-wrap items-baseline gap-4 sm:ml-4">
                <h3 className="m-0 text-xl font-bold text-foreground">
                  Asset Holdings
                </h3>
                <span className="text-xs text-(--color-text-muted)">
                  {[['Self', 'Member'], ['SP', 'Spouse'], ['JT', 'Joint'], ['DC', 'Dependent Child']].map(
                    ([abbr, label]) => (
                      <span key={abbr} className="mr-2.5">
                        <span className="font-bold text-(--color-text-secondary)">{abbr}</span> = {label}
                      </span>
                    )
                  )}
                </span>
              </div>
              <div className="mb-1.5 overflow-x-auto sm:pl-4">
                <div className="max-h-90 overflow-y-auto rounded-md border border-(--color-border)">
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b-2 border-(--color-border)">
                        <th
                          onClick={() => toggleAssetSort('name')}
                          className="cursor-pointer select-none px-2.5 py-1.5 pl-4.5 text-left font-semibold text-(--color-text-muted)"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <span>Asset</span>
                            <span className={`text-xs font-bold ${sortHeaderClass('name')}`}>{sortIndicator('name')}</span>
                          </span>
                        </th>
                        <th
                          onClick={() => toggleAssetSort('typeCode')}
                          className="cursor-pointer select-none px-2.5 py-1.5 text-left font-semibold text-(--color-text-muted)"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <span>Type</span>
                            <span className={`text-xs font-bold ${sortHeaderClass('typeCode')}`}>{sortIndicator('typeCode')}</span>
                          </span>
                        </th>
                        <th
                          onClick={() => toggleAssetSort('owner')}
                          className="cursor-pointer select-none px-2.5 py-1.5 text-left font-semibold text-(--color-text-muted)"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <span>Owner</span>
                            <span className={`text-xs font-bold ${sortHeaderClass('owner')}`}>{sortIndicator('owner')}</span>
                          </span>
                        </th>
                        <th
                          onClick={() => toggleAssetSort('valueMid')}
                          className="cursor-pointer select-none px-2.5 py-1.5 text-right font-semibold text-(--color-text-muted)"
                        >
                          <span className="inline-flex items-center gap-1.5">
                            <span>Est. Value</span>
                            <span className={`text-xs font-bold ${sortHeaderClass('valueMid')}`}>{sortIndicator('valueMid')}</span>
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-(--color-border)">
                      {sortedAssets.map((asset, i) => (
                        <tr key={`${asset.name}-${asset.owner}-${i}`}>
                          <td className="px-2.5 py-1.5 pl-4.5 text-(--color-text-secondary)">{asset.name}</td>
                          <td className="px-2.5 py-1.5">
                            <span
                              className="rounded-sm px-1.5 py-0.5 text-[11px] font-bold text-white"
                              style={{ background: CATEGORY_COLORS[asset.category] ?? 'var(--color-text-muted)' }}
                            >
                              {asset.typeCode}
                            </span>
                          </td>
                          <td className="px-2.5 py-1.5 text-(--color-text-secondary)">{asset.owner}</td>
                          <td className="px-2.5 py-1.5 text-right font-mono font-semibold text-foreground">
                            {formatMoney(asset.valueMid)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="mt-2 mb-3 px-1 sm:pl-8 sm:pr-6">
                <div className="text-right font-mono text-[13px] font-bold text-foreground">
                  Total Asset Value: {formatMoney(totalListedAssets)}
                </div>
              </div>
            </>
          )}

          {netWorth.liabilities.length > 0 && (
            <>
              <h3 className="mt-7 mb-2.5 ml-1 text-lg font-bold text-foreground sm:ml-4">
                Liabilities
              </h3>
              <div className="overflow-x-auto sm:pl-4">
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b-2 border-(--color-border)">
                      <th className="px-2.5 py-1.5 pl-4.5 text-left font-semibold text-(--color-text-muted)">Creditor</th>
                      <th className="px-2.5 py-1.5 text-left font-semibold text-(--color-text-muted)">Type</th>
                      <th className="px-2.5 py-1.5 text-right font-semibold text-(--color-text-muted)">Est. Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-(--color-border)">
                    {netWorth.liabilities.map((l, i) => (
                      <tr key={i}>
                        <td className="px-2.5 py-1.5 pl-4.5 text-(--color-text-secondary)">{l.creditor}</td>
                        <td className="px-2.5 py-1.5 text-(--color-text-secondary)">{l.loanType}</td>
                        <td className="px-2.5 py-1.5 text-right font-mono font-semibold text-foreground">
                          ({formatMoney(l.valueMid)})
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

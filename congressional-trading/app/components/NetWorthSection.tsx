'use client';

import { useMemo, useRef, useState } from 'react';
import NetWorthDonutChart, { CATEGORY_COLORS } from './NetWorthDonutChart';
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

  return (
    <div
      className="bg-white rounded-xl shadow-xl border border-gray-200 p-6 overflow-hidden"
      style={{ paddingBottom: '40px' }}
    >
      <h2
        style={{
          marginTop: '12px',
          marginBottom: '14px',
          textAlign: 'center',
          fontSize: '40px',
          fontWeight: 800,
          lineHeight: 1.05,
          color: '#1e3a8a',
        }}
      >
        Estimated Net Worth
      </h2>
      {netWorth?.filing && (
        <>
          <p
            style={{
              textAlign: 'center',
              color: '#6b7280',
              fontSize: '15px',
              marginBottom: '12px',
              marginTop: '-6px',
            }}
          >
            from {netWorth.filing.filing_year} Annual Financial Disclosure
          </p>
          {disclosures.length > 0 && (
            <div
              ref={dropdownRef}
              style={{
                display: 'flex',
                justifyContent: 'center',
                marginBottom: '18px',
                position: 'relative',
              }}
            >
              <button
                type="button"
                onClick={() => setDropdownOpen((v) => !v)}
                style={{
                  border: '1px solid #d1d5db',
                  background: '#ffffff',
                  color: '#1f2937',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  fontSize: '13px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '26px',
                }}
              >
                View Disclosures ({disclosures.length})
                <span style={{ fontSize: '11px', transition: 'transform 200ms', display: 'inline-block', transform: dropdownOpen ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
              </button>
              {dropdownOpen && (
                <div
                  style={{
                    position: 'absolute',
                    top: 'calc(100% + 6px)',
                    left: '50%',
                    transform: 'translateX(-50%)',
                    background: '#ffffff',
                    border: '1px solid #e5e7eb',
                    borderRadius: '10px',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.10)',
                    zIndex: 50,
                    minWidth: '280px',
                    maxHeight: '260px',
                    overflowY: 'auto',
                    padding: '6px 0',
                  }}
                >
                  {disclosures.map((d) => (
                    <a
                      key={d.id}
                      href={`https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${d.filing_year}/${d.doc_id}.pdf`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 16px',
                        fontSize: '13px',
                        color: '#1f2937',
                        textDecoration: 'none',
                        borderBottom: '1px solid #f3f4f6',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f9fafb')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ fontWeight: 600 }}>
                        {d.filing_year}{' '}
                        {d.filing_type === 'O' ? 'Original' : d.filing_type === 'A' ? 'Amendment' : d.filing_type === 'C' ? 'Candidate' : d.filing_type}
                      </span>
                      {d.filing_date && (
                        <span style={{ color: '#9ca3af', fontSize: '12px', marginLeft: '12px' }}>
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
        <p style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 0', fontSize: '14px' }}>
          Loading financial data…
        </p>
      )}

      {netWorth && !netWorth.summary && (
        <p style={{ textAlign: 'center', color: '#9ca3af', padding: '32px 0', fontSize: '14px' }}>
          No annual disclosure data available for this member.
        </p>
      )}

      {netWorth?.summary && (
        <>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              gap: '32px',
              marginBottom: '28px',
            }}
          >
            {[
              { label: 'Est. Total Assets', value: formatMoney(netWorth.summary.totalAssets) },
              { label: 'Est. Liabilities', value: `(${formatMoney(netWorth.summary.totalLiabilities)})` },
              { label: 'Est. Net Worth', value: formatMoney(netWorth.summary.estimatedNetWorth) },
            ].map(({ label, value }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <div
                  style={{
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    color: '#6b7280',
                    marginBottom: '4px',
                  }}
                >
                  {label}
                </div>
                <div style={{ fontSize: '28px', fontWeight: 800, color: '#111827' }}>{value}</div>
              </div>
            ))}
          </div>

          <div className="w-full overflow-x-auto" style={{ marginBottom: '4px' }}>
            <NetWorthDonutChart byCategory={netWorth.byCategory} />
          </div>


          {netWorth.assets.length > 0 && (
            <>
              <div
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  alignItems: 'baseline',
                  gap: '16px',
                  marginBottom: '12px',
                  marginLeft: '16px',
                }}
              >
                <h3 style={{ fontSize: '20px', fontWeight: 700, color: '#111827', margin: 0 }}>
                  Asset Holdings
                </h3>
                <span style={{ fontSize: '12px', color: '#6b7280' }}>
                  {[['Self', 'Member'], ['SP', 'Spouse'], ['JT', 'Joint'], ['DC', 'Dependent Child']].map(
                    ([abbr, label]) => (
                      <span key={abbr} style={{ marginRight: '10px' }}>
                        <span style={{ fontWeight: 700, color: '#374151' }}>{abbr}</span> = {label}
                      </span>
                    )
                  )}
                </span>
              </div>
              <div className="overflow-x-auto" style={{ paddingLeft: '16px', marginBottom: '6px' }}>
                <div
                  style={{
                    maxHeight: '360px',
                    overflowY: 'auto',
                    border: '1px solid #e5e7eb',
                    borderRadius: '10px',
                  }}
                >
                  <table
                    style={{
                      width: 'calc(100% - 16px)',
                      fontSize: '13px',
                      borderCollapse: 'collapse',
                    }}
                  >
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                        <th
                          onClick={() => toggleAssetSort('name')}
                          style={{
                            textAlign: 'left',
                            padding: '6px 10px 6px 18px',
                            color: '#6b7280',
                            fontWeight: 600,
                            cursor: 'pointer',
                            userSelect: 'none',
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span>Asset</span>
                            <span
                              style={{
                                color: assetSort.key === 'name' ? '#111827' : '#9ca3af',
                                fontSize: '12px',
                                fontWeight: 700,
                              }}
                            >
                              {sortIndicator('name')}
                            </span>
                          </span>
                        </th>
                        <th
                          onClick={() => toggleAssetSort('typeCode')}
                          style={{
                            textAlign: 'left',
                            padding: '6px 10px',
                            color: '#6b7280',
                            fontWeight: 600,
                            cursor: 'pointer',
                            userSelect: 'none',
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span>Type</span>
                            <span
                              style={{
                                color: assetSort.key === 'typeCode' ? '#111827' : '#9ca3af',
                                fontSize: '12px',
                                fontWeight: 700,
                              }}
                            >
                              {sortIndicator('typeCode')}
                            </span>
                          </span>
                        </th>
                        <th
                          onClick={() => toggleAssetSort('owner')}
                          style={{
                            textAlign: 'left',
                            padding: '6px 10px',
                            color: '#6b7280',
                            fontWeight: 600,
                            cursor: 'pointer',
                            userSelect: 'none',
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span>Owner</span>
                            <span
                              style={{
                                color: assetSort.key === 'owner' ? '#111827' : '#9ca3af',
                                fontSize: '12px',
                                fontWeight: 700,
                              }}
                            >
                              {sortIndicator('owner')}
                            </span>
                          </span>
                        </th>
                        <th
                          onClick={() => toggleAssetSort('valueMid')}
                          style={{
                            textAlign: 'right',
                            padding: '6px 10px',
                            color: '#6b7280',
                            fontWeight: 600,
                            cursor: 'pointer',
                            userSelect: 'none',
                          }}
                        >
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span>Est. Value</span>
                            <span
                              style={{
                                color: assetSort.key === 'valueMid' ? '#111827' : '#9ca3af',
                                fontSize: '12px',
                                fontWeight: 700,
                              }}
                            >
                              {sortIndicator('valueMid')}
                            </span>
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedAssets.map((asset, i) => (
                        <tr
                          key={`${asset.name}-${asset.owner}-${i}`}
                          style={{
                            borderBottom: '1px solid #f3f4f6',
                            background: i % 2 === 0 ? '#fff' : '#f9fafb',
                          }}
                        >
                          <td style={{ padding: '7px 10px 7px 18px', color: '#6b7280' }}>{asset.name}</td>
                          <td style={{ padding: '7px 10px' }}>
                            <span
                              style={{
                                background: CATEGORY_COLORS[asset.category] ?? '#6b7280',
                                color: '#ffffff',
                                padding: '2px 7px',
                                borderRadius: '999px',
                                fontSize: '11px',
                                fontWeight: 700,
                              }}
                            >
                              {asset.typeCode}
                            </span>
                          </td>
                          <td style={{ padding: '7px 10px', color: '#6b7280' }}>{asset.owner}</td>
                          <td
                            style={{
                              padding: '7px 10px',
                              textAlign: 'right',
                              fontFamily: 'monospace',
                              fontWeight: 600,
                              color: '#111827',
                            }}
                          >
                            {formatMoney(asset.valueMid)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div style={{ paddingLeft: '34px', paddingRight: '26px', marginTop: '8px', marginBottom: '12px' }}>
                <div
                  style={{
                    textAlign: 'right',
                    color: '#111827',
                    fontSize: '13px',
                    fontWeight: 700,
                    fontFamily: 'monospace',
                  }}
                >
                  Total Asset Value: {formatMoney(totalListedAssets)}
                </div>
              </div>
            </>
          )}

          {netWorth.liabilities.length > 0 && (
            <>
              <h3
                style={{
                  fontSize: '18px',
                  fontWeight: 700,
                  color: '#111827',
                  marginBottom: '10px',
                  marginTop: '28px',
                  marginLeft: '16px',
                }}
              >
                Liabilities
              </h3>
              <div className="overflow-x-auto" style={{ paddingLeft: '16px' }}>
                <table
                  style={{
                    width: 'calc(100% - 16px)',
                    fontSize: '13px',
                    borderCollapse: 'collapse',
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: '2px solid #e5e7eb' }}>
                      <th
                        style={{ textAlign: 'left', padding: '6px 10px 6px 18px', color: '#6b7280', fontWeight: 600 }}
                      >
                        Creditor
                      </th>
                      <th
                        style={{ textAlign: 'left', padding: '6px 10px', color: '#6b7280', fontWeight: 600 }}
                      >
                        Type
                      </th>
                      <th
                        style={{ textAlign: 'right', padding: '6px 10px', color: '#6b7280', fontWeight: 600 }}
                      >
                        Est. Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {netWorth.liabilities.map((l, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                        <td style={{ padding: '7px 10px 7px 18px', color: '#6b7280' }}>{l.creditor}</td>
                        <td style={{ padding: '7px 10px', color: '#6b7280' }}>{l.loanType}</td>
                        <td
                          style={{
                            padding: '7px 10px',
                            textAlign: 'right',
                            fontFamily: 'monospace',
                            color: '#111827',
                            fontWeight: 600,
                          }}
                        >
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

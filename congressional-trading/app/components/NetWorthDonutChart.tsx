'use client';

import { useMemo, useState } from 'react';
import * as d3 from 'd3';

export const CATEGORY_COLORS: Record<string, string> = {
  Stocks: '#047857',
  'Mutual Funds': '#1d4ed8',
  'Real Estate': '#b45309',
  Retirement: '#6d28d9',
  'Business Interests': '#b91c1c',
  'Cash & Banking': '#0e7490',
  Insurance: '#c2410c',
  Bonds: '#374151',
  Other: '#6b7280',
};

function formatMoney(amount: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(amount);
}

export default function NetWorthDonutChart({
  byCategory,
}: {
  byCategory: Record<string, { total: number; count: number }>;
}) {
  const [hovered, setHovered] = useState<{
    category: string;
    pct: number;
    value: number;
    x: number;
    y: number;
  } | null>(null);

  const entries = Object.entries(byCategory)
    .filter(([, v]) => v.total > 0)
    .sort((a, b) => b[1].total - a[1].total);

  if (entries.length === 0) {
    return (
      <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '14px', marginBottom: '10px' }}>
        No assets to display
      </p>
    );
  }

  const total = entries.reduce((sum, [, v]) => sum + v.total, 0);
  const size = 260;
  const cx = size / 2;
  const cy = size / 2;
  const outerR = 104;
  const innerR = 60;

  const slices = useMemo(() => {
    const pie = d3
      .pie<[string, { total: number; count: number }]>()
      .value(([, value]) => value.total)
      .sort(null)
      .startAngle(-Math.PI / 2)
      .endAngle(Math.PI * 1.5);

    const arcPath = d3
      .arc<d3.PieArcDatum<[string, { total: number; count: number }]>>()
      .innerRadius(innerR)
      .outerRadius(outerR);

    return pie(entries).map((arcDatum) => {
      const [category, value] = arcDatum.data;
      return {
        category,
        value: value.total,
        path: arcPath(arcDatum) ?? '',
        color: CATEGORY_COLORS[category] ?? '#6b7280',
        pct: total > 0 ? (value.total / total) * 100 : 0,
      };
    });
  }, [entries, innerR, outerR, total]);

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        alignItems: 'center',
        gap: '22px',
        marginBottom: '16px',
      }}
    >
      <div style={{ position: 'relative', width: `${size}px`, height: `${size}px` }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Assets by category">
          <g transform={`translate(${cx}, ${cy})`}>
            {slices.map((s) => (
              <path
                key={s.category}
                d={s.path}
                fill={s.color}
                stroke="#ffffff"
                strokeWidth="2"
                onMouseMove={(e) => {
                  const rect = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
                  setHovered({
                    category: s.category,
                    pct: s.pct,
                    value: s.value,
                    x: e.clientX - rect.left,
                    y: e.clientY - rect.top,
                  });
                }}
                onMouseLeave={() => setHovered(null)}
              />
            ))}
          </g>
        </svg>
        {hovered && (
          <div
            style={{
              position: 'absolute',
              left: `${Math.min(hovered.x + 12, size - 140)}px`,
              top: `${Math.max(hovered.y - 40, 8)}px`,
              background: '#111827',
              color: '#ffffff',
              borderRadius: '8px',
              padding: '8px 10px',
              fontSize: '11px',
              lineHeight: 1.35,
              boxShadow: '0 8px 20px rgba(15, 23, 42, 0.28)',
              pointerEvents: 'none',
              zIndex: 2,
              minWidth: '128px',
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: '2px' }}>{hovered.category}</div>
            <div>{hovered.pct.toFixed(1)}%</div>
            <div>{formatMoney(hovered.value)}</div>
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            pointerEvents: 'none',
          }}
        >
          <span style={{ fontSize: '11px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Total Assets
          </span>
          <span style={{ fontSize: '14px', fontWeight: 800, color: '#111827' }}>{formatMoney(total)}</span>
        </div>
      </div>

      <div style={{ minWidth: '220px', maxWidth: '360px' }}>
        {slices.map((s) => (
          <div
            key={s.category}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              padding: '4px 0',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span
                style={{
                  display: 'inline-block',
                  width: '10px',
                  height: '10px',
                  borderRadius: '999px',
                  background: s.color,
                }}
              />
              <span style={{ fontSize: '13px', color: '#1f2937', fontWeight: 600 }}>{s.category}</span>
            </div>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              {s.pct.toFixed(0)}% ({formatMoney(s.value)})
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

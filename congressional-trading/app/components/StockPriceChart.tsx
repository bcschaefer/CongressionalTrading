'use client';

import { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';

type Trade = {
  id: number;
  trade_date: string | null;
  trade_type: string | null;
  price_start: number | null;
  price_end: number | null;
};

type StockPriceChartProps = {
  trades: Trade[];
};

function tradeDirection(type: string | null): 'buy' | 'sell' | 'other' {
  const t = (type ?? '').trim().toUpperCase();
  if (t === 'P' || t.startsWith('PURCHASE') || t.startsWith('BUY')) return 'buy';
  if (t === 'S' || t.startsWith('SALE') || t.startsWith('SELL')) return 'sell';
  return 'other';
}

export default function StockPriceChart({ trades }: StockPriceChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const data = useMemo(() => {
    const filtered = trades
      .filter((t) => t.trade_date && t.price_start != null)
      .map((t) => ({
        id: t.id,
        date: new Date(`${t.trade_date}T00:00:00`),
        price: t.price_start!,
        direction: tradeDirection(t.trade_type),
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    // Spread overlapping points (same date and same price) so all trades remain visible.
    const occurrence = new Map<string, number>();
    const totals = new Map<string, number>();

    for (const point of filtered) {
      const key = `${point.date.getTime()}-${point.price.toFixed(4)}`;
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }

    return filtered.map((point) => {
      const key = `${point.date.getTime()}-${point.price.toFixed(4)}`;
      const currentIndex = occurrence.get(key) ?? 0;
      occurrence.set(key, currentIndex + 1);

      return {
        ...point,
        stackIndex: currentIndex,
        stackCount: totals.get(key) ?? 1,
      };
    });
  }, [trades]);

  useEffect(() => {
    if (!svgRef.current || data.length === 0) return;

    const width = 1000;
    const height = 450;
    const margin = { top: 20, right: 20, bottom: 40, left: 60 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    const minPrice = d3.min(data, (d) => d.price) ?? 0;
    const maxPrice = d3.max(data, (d) => d.price) ?? 1;
    const priceRange = maxPrice - minPrice;
    const yMin = Math.max(0, minPrice - priceRange * 0.1);
    const yMax = maxPrice + priceRange * 0.1;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleTime()
      .domain([data[0].date, data[data.length - 1].date])
      .range([0, innerWidth]);

    const y = d3.scaleLinear().domain([yMin, yMax]).range([innerHeight, 0]);

    // Grid lines
    g.selectAll('.grid-line-y')
      .data(y.ticks(5))
      .enter()
      .append('line')
      .attr('class', 'grid-line-y')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d))
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2,2');

    // Y axis
    g.append('g')
      .attr('class', 'axis axis--y')
      .call(
        d3
          .axisLeft(y)
          .ticks(5)
          .tickFormat((d) => `$${Number(d).toFixed(0)}`)
      )
      .selectAll('text')
      .attr('fill', '#6b7280')
      .attr('font-size', '12px');

    // X axis
    g.append('g')
      .attr('class', 'axis axis--x')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(Math.min(5, data.length)))
      .selectAll('text')
      .attr('fill', '#6b7280')
      .attr('font-size', '12px');

    // Line generator
    const line = d3
      .line<(typeof data)[0]>()
      .x((d) => x(d.date))
      .y((d) => y(d.price));

    // Path for line
    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#0d9488')
      .attr('stroke-width', 2)
      .attr('d', line);

    const pointX = (d: (typeof data)[0]) => {
      const spread = 4;
      const centerOffset = (d.stackCount - 1) / 2;
      return x(d.date) + (d.stackIndex - centerOffset) * spread;
    };

    // Points (circles) for each trade
    const points = g
      .selectAll<SVGCircleElement, (typeof data)[0]>('.trade-point')
      .data(data)
      .enter()
      .append('circle')
      .attr('class', 'trade-point')
      .attr('cx', (d) => pointX(d))
      .attr('cy', (d) => y(d.price))
      .attr('r', 5)
      .attr('fill', (d) => (d.direction === 'buy' ? '#10b981' : d.direction === 'sell' ? '#ef4444' : '#9ca3af'))
      .attr('stroke', '#fff')
      .attr('stroke-width', 2);

    // Tooltips on hover
    points
      .on('mouseenter', function (event, d) {
        d3.select(this).attr('r', 7).attr('stroke-width', 2.5);
        g.append('text')
          .attr('class', 'tooltip')
          .attr('x', pointX(d))
          .attr('y', y(d.price) - 15)
          .attr('text-anchor', 'middle')
          .attr('font-size', '11px')
          .attr('fill', '#374151')
          .attr('font-weight', 'bold')
          .text(`$${d.price.toFixed(2)}`);
      })
      .on('mouseleave', function () {
        d3.select(this).attr('r', 5).attr('stroke-width', 2);
        g.selectAll('.tooltip').remove();
      });
  }, [data]);

  if (data.length === 0) {
    return (
      <div style={{ color: '#9ca3af', textAlign: 'center', padding: '40px 20px', fontSize: '14px' }}>
        No price data available
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px', marginBottom: '24px' }}>
      <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#111827', marginBottom: '16px' }}>Price Movement</h2>
      <svg ref={svgRef} className="block" style={{ margin: '0 auto' }} />
      <div style={{ display: 'flex', gap: '24px', marginTop: '16px', justifyContent: 'center', fontSize: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }} />
          <span style={{ color: '#6b7280' }}>Purchases</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
          <span style={{ color: '#6b7280' }}>Sales</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '20px', height: '2px', background: '#0d9488' }} />
          <span style={{ color: '#6b7280' }}>Price trend</span>
        </div>
      </div>
    </div>
  );
}

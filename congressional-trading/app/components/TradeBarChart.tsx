'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as d3 from 'd3';

type TradeLike = {
  id: number;
  ticker: string;
  amount: number;
  date?: string;
};

type TradeBarChartProps = {
  trades: TradeLike[];
  saleTrades?: TradeLike[]; // when provided, renders a grouped purchase+sale chart
  color: string;
  emptyMessage: string;
  groupByTicker?: boolean;
  groupByYear?: boolean;
};

function formatTick(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}

export default function TradeBarChart({
  trades,
  saleTrades,
  color,
  emptyMessage,
  groupByTicker = false,
  groupByYear = false,
}: TradeBarChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  // Grouped mode: compute purchase + sale maps and merged ticker/year list
  const groupedData = useMemo(() => {
    if (saleTrades === undefined) return null;

    const keyOf = (t: TradeLike) =>
      groupByYear ? String(new Date(t.date ?? '').getFullYear()) : t.ticker;

    const purchaseByKey = new Map<string, number>();
    for (const t of trades) {
      const k = keyOf(t);
      purchaseByKey.set(k, (purchaseByKey.get(k) ?? 0) + t.amount);
    }
    const saleByKey = new Map<string, number>();
    for (const t of saleTrades) {
      const k = keyOf(t);
      saleByKey.set(k, (saleByKey.get(k) ?? 0) + t.amount);
    }
    const allKeys = [...new Set([...purchaseByKey.keys(), ...saleByKey.keys()])].sort(
      groupByYear
        ? (a, b) => Number(a) - Number(b)
        : (a, b) => {
            const aTotal = (purchaseByKey.get(a) ?? 0) + (saleByKey.get(a) ?? 0);
            const bTotal = (purchaseByKey.get(b) ?? 0) + (saleByKey.get(b) ?? 0);
            return bTotal - aTotal;
          }
    );
    return { allTickers: allKeys, purchaseByTicker: purchaseByKey, saleByTicker: saleByKey, yearMode: groupByYear };
  }, [trades, saleTrades, groupByYear]);

  // Single-series mode
  const series = useMemo(() => {
    if (groupedData) return [];
    if (!groupByTicker) {
      return trades
        .map((t) => ({ key: `${t.ticker}-${t.id}`, label: t.ticker, amount: t.amount }))
        .sort((a, b) => b.amount - a.amount);
    }
    const grouped = new Map<string, number>();
    for (const t of trades) {
      grouped.set(t.ticker, (grouped.get(t.ticker) ?? 0) + t.amount);
    }
    return [...grouped.entries()]
      .map(([ticker, amount]) => ({ key: ticker, label: ticker, amount }))
      .sort((a, b) => b.amount - a.amount);
  }, [groupByTicker, trades, groupedData]);

  useLayoutEffect(() => {
    if (!svgRef.current) return;

    // ── GROUPED MODE ─────────────────────────────────────────────────────────
    if (groupedData) {
      const { allTickers, purchaseByTicker, saleByTicker } = groupedData;

      const containerWidth = groupedData.yearMode && containerRef.current
        ? containerRef.current.offsetWidth
        : 0;
      const width = groupedData.yearMode
        ? Math.max(320, containerWidth)
        : Math.max(680, allTickers.length * 80);
      const height = 380;
      const margin = { top: 30, right: 20, bottom: 80, left: 64 };
      const innerWidth = width - margin.left - margin.right;
      const innerHeight = height - margin.top - margin.bottom;

      const svg = d3.select(svgRef.current);
      svg.selectAll('*').remove();
      svg.attr('width', width).attr('height', height);

      if (allTickers.length === 0) {
        svg.append('text').attr('x', width / 2).attr('y', height / 2).attr('text-anchor', 'middle').attr('fill', '#6b7280').attr('font-size', '14px').text(emptyMessage);
        return;
      }

      const maxVal = d3.max([...purchaseByTicker.values(), ...saleByTicker.values()]) ?? 1;
      const yMax = maxVal > 0 ? maxVal * 1.05 : 1;

      const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

      const x0 = d3.scaleBand<string>().domain(allTickers).range([0, innerWidth]).padding(0.25);
      const x1 = d3.scaleBand<string>().domain(['purchase', 'sale']).range([0, x0.bandwidth()]).padding(0.05);
      const y = d3.scaleLinear().domain([0, yMax]).nice().range([innerHeight, 0]);

      // Y axis
      const yAxis = g.append('g').call(
        d3.axisLeft(y).ticks(5).tickFormat((v) => formatTick(Number(v)))
      );
      yAxis.selectAll('text').attr('fill', '#000000');

      // Grid lines
      g.selectAll('.grid-line')
        .data(y.ticks(5))
        .enter()
        .append('line')
        .attr('class', 'grid-line')
        .attr('x1', 0).attr('x2', innerWidth)
        .attr('y1', (d) => y(d)).attr('y2', (d) => y(d))
        .attr('stroke', '#e5e7eb').attr('stroke-width', 1).attr('stroke-dasharray', '2,2');

      // X axis (ticker labels centered under each group)
      g.append('g')
        .attr('transform', `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x0))
        .selectAll('text')
        .attr('transform', 'rotate(-35)')
        .style('text-anchor', 'end')
        .style('fill', '#111827')
        .style('font-weight', '600');

      // Purchase bars (green)
      const purchaseTickers = allTickers.filter((t) => purchaseByTicker.has(t));
      g.selectAll('.bar-purchase')
        .data(purchaseTickers)
        .enter()
        .append('rect')
        .attr('class', 'bar-purchase')
        .attr('x', (d) => (x0(d) ?? 0) + (x1('purchase') ?? 0))
        .attr('y', (d) => y(purchaseByTicker.get(d)!))
        .attr('width', x1.bandwidth())
        .attr('height', (d) => innerHeight - y(purchaseByTicker.get(d)!))
        .attr('fill', '#10b981')
        .attr('rx', 3)
        .attr('cursor', groupedData?.yearMode ? 'default' : 'pointer')
        .on('click', (_e, d) => { if (!groupedData?.yearMode) router.push(`/stocks/${d}`); });

      // Sale bars (red)
      const saleTickers = allTickers.filter((t) => saleByTicker.has(t));
      g.selectAll('.bar-sale')
        .data(saleTickers)
        .enter()
        .append('rect')
        .attr('class', 'bar-sale')
        .attr('x', (d) => (x0(d) ?? 0) + (x1('sale') ?? 0))
        .attr('y', (d) => y(saleByTicker.get(d)!))
        .attr('width', x1.bandwidth())
        .attr('height', (d) => innerHeight - y(saleByTicker.get(d)!))
        .attr('fill', '#ef4444')
        .attr('rx', 3)
        .attr('cursor', groupedData?.yearMode ? 'default' : 'pointer')
        .on('click', (_e, d) => { if (!groupedData?.yearMode) router.push(`/stocks/${d}`); });

      // Legend
      const legend = svg.append('g').attr('transform', `translate(${margin.left}, 8)`);
      legend.append('rect').attr('width', 12).attr('height', 12).attr('fill', '#10b981').attr('rx', 2);
      legend.append('text').attr('x', 16).attr('y', 10).text('Purchase').attr('font-size', '11px').attr('fill', '#374151').attr('font-weight', '600');
      legend.append('rect').attr('x', 86).attr('width', 12).attr('height', 12).attr('fill', '#ef4444').attr('rx', 2);
      legend.append('text').attr('x', 102).attr('y', 10).text('Sale').attr('font-size', '11px').attr('fill', '#374151').attr('font-weight', '600');

      return;
    }

    // ── SINGLE-SERIES MODE ────────────────────────────────────────────────────
    const width = Math.max(680, series.length * 52);
    const height = 380;
    const margin = { top: 20, right: 20, bottom: 80, left: 64 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();
    svg.attr('width', width).attr('height', height);

    if (series.length === 0) {
      svg
        .append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#6b7280')
        .attr('font-size', '14px')
        .text(emptyMessage);
      return;
    }

    const maxValue = d3.max(series, (d) => d.amount) ?? 1;
    const yMax = maxValue > 0 ? maxValue * 1.05 : 1;

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);
    const x = d3
      .scaleBand<string>()
      .domain(series.map((d) => d.key))
      .range([0, innerWidth])
      .padding(0.2);

    const y = d3.scaleLinear().domain([0, yMax]).nice().range([innerHeight, 0]);

    const yAxis = g.append('g').attr('class', 'axis axis--y').call(
      d3
        .axisLeft(y)
        .ticks(5)
        .tickFormat((v) => formatTick(Number(v)))
    );

    yAxis.selectAll('text').attr('fill', '#000000');

    g.append('g')
      .attr('class', 'axis axis--x')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickFormat((v) => {
        const found = series.find((s) => s.key === v);
        return found?.label ?? String(v);
      }))
      .selectAll('text')
      .attr('transform', 'rotate(-35)')
      .style('text-anchor', 'end')
      .style('fill', '#111827')
      .style('font-weight', '600');

    g.selectAll('.grid-line')
      .data(y.ticks(5))
      .enter()
      .append('line')
      .attr('class', 'grid-line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d))
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2,2');

    g.selectAll('.bar')
      .data(series)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d) => x(d.key) ?? 0)
      .attr('y', (d) => y(d.amount))
      .attr('width', x.bandwidth())
      .attr('height', (d) => innerHeight - y(d.amount))
      .attr('fill', color)
      .attr('rx', 4)
      .attr('cursor', 'pointer')
      .on('click', (_event, d) => {
        const ticker = d.label;
        if (ticker) router.push(`/stocks/${ticker}`);
      });

    g.selectAll('.label')
      .data(series)
      .enter()
      .append('text')
      .attr('class', 'label')
      .attr('x', (d) => (x(d.key) ?? 0) + x.bandwidth() / 2)
      .attr('y', (d) => y(d.amount) - 6)
      .attr('text-anchor', 'middle')
      .attr('fill', '#374151')
      .attr('font-size', '10px')
      .attr('font-weight', 'bold')
      .text((d) => formatTick(d.amount));
  }, [color, emptyMessage, router, series, groupedData]);

  const isYearMode = groupedData?.yearMode ?? false;
  return (
    <div ref={containerRef} style={{ width: '100%', overflowX: isYearMode ? 'visible' : 'auto', overflowY: 'hidden' }}>
      <svg ref={svgRef} className="block" style={isYearMode ? { maxWidth: '100%' } : undefined} />
    </div>
  );
}

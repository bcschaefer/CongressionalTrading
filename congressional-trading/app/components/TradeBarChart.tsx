'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import * as d3 from 'd3';

type TradeLike = {
  id: number;
  ticker: string;
  amount: number;
};

type TradeBarChartProps = {
  trades: TradeLike[];
  color: string;
  emptyMessage: string;
  groupByTicker?: boolean;
};

function formatTick(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}k`;
  return `$${Math.round(value)}`;
}

export default function TradeBarChart({
  trades,
  color,
  emptyMessage,
  groupByTicker = false,
}: TradeBarChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const router = useRouter();

  const series = useMemo(() => {
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
  }, [groupByTicker, trades]);

  useEffect(() => {
    if (!svgRef.current) return;

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
      .attr('y', innerHeight)
      .attr('width', x.bandwidth())
      .attr('height', 0)
      .attr('fill', color)
      .attr('rx', 4)
      .attr('cursor', 'pointer')
      .on('click', (_event, d) => {
        const ticker = d.label;
        if (ticker) router.push(`/stocks/${ticker}`);
      })
      .transition()
      .duration(700)
      .ease(d3.easeCubic)
      .attr('y', (d) => y(d.amount))
      .attr('height', (d) => innerHeight - y(d.amount));

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
  }, [color, emptyMessage, router, series]);

  return <svg ref={svgRef} className="block" />;
}

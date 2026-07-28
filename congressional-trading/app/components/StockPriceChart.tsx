'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';

type PricePoint = { date: string; close: number };

type Trade = {
  id: number;
  trade_date: string | null;
  trade_type: string | null;
  amount: number;
};

type StockPriceChartProps = {
  ticker: string;
  priceHistory: PricePoint[];
  priceInterval: '1d' | '1wk' | '1mo' | null;
  trades: Trade[];
};

type SeriesPoint = { date: Date; close: number };
type MarkerPoint = {
  id: number;
  date: Date;
  close: number;
  direction: 'buy' | 'sell' | 'other';
  amount: number;
  jitter: number;
};

function tradeDirection(type: string | null): 'buy' | 'sell' | 'other' {
  const t = (type ?? '').trim().toUpperCase();
  if (t === 'P' || t.startsWith('PURCHASE') || t.startsWith('BUY')) return 'buy';
  if (t === 'S' || t.startsWith('SALE') || t.startsWith('SELL')) return 'sell';
  return 'other';
}

function formatMoney(amount: number) {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
  return `$${amount.toFixed(0)}`;
}

const formatAxisDate = d3.timeFormat('%b %Y');
const formatTooltipDate = d3.timeFormat('%b %-d, %Y');

const intervalLabel: Record<string, string> = { '1d': 'daily', '1wk': 'weekly', '1mo': 'monthly' };

export default function StockPriceChart({ ticker, priceHistory, priceInterval, trades }: StockPriceChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  const series = useMemo<SeriesPoint[]>(
    () =>
      priceHistory
        .map((p) => ({ date: new Date(`${p.date}T00:00:00`), close: p.close }))
        .filter((p) => !Number.isNaN(p.date.getTime()))
        .sort((a, b) => a.date.getTime() - b.date.getTime()),
    [priceHistory]
  );

  const markers = useMemo<MarkerPoint[]>(() => {
    if (series.length === 0) return [];
    const bisectDate = d3.bisector<SeriesPoint, Date>((d) => d.date).left;

    const raw = trades
      .filter((t) => t.trade_date)
      .map((t) => {
        const date = new Date(`${t.trade_date}T00:00:00`);
        const idx = bisectDate(series, date);
        const lo = series[Math.max(0, idx - 1)];
        const hi = series[Math.min(series.length - 1, idx)];
        const nearest =
          !hi ? lo : !lo ? hi : Math.abs(hi.date.getTime() - date.getTime()) < Math.abs(date.getTime() - lo.date.getTime()) ? hi : lo;
        return {
          id: t.id,
          date,
          close: nearest.close,
          direction: tradeDirection(t.trade_type),
          amount: t.amount,
        };
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const dayGroups = new Map<string, typeof raw>();
    for (const point of raw) {
      const key = point.date.toISOString().slice(0, 10);
      const group = dayGroups.get(key) ?? [];
      group.push(point);
      dayGroups.set(key, group);
    }

    return raw.map((point) => {
      const key = point.date.toISOString().slice(0, 10);
      const group = dayGroups.get(key)!;
      const idx = group.indexOf(point);
      const center = (group.length - 1) / 2;
      return { ...point, jitter: idx - center };
    });
  }, [trades, series]);

  useLayoutEffect(() => {
    if (!svgRef.current || !tooltipRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (series.length === 0) return;

    const width = 1000;
    const height = 420;
    const margin = { top: 20, right: 24, bottom: 32, left: 64 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .attr('role', 'img')
      .attr(
        'aria-label',
        `${ticker} price history from ${formatTooltipDate(series[0].date)} to ${formatTooltipDate(series[series.length - 1].date)}, with ${markers.length} congressional trade${markers.length === 1 ? '' : 's'} marked`
      )
      .style('width', '100%')
      .style('height', 'auto');

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleTime()
      .domain(d3.extent(series, (d) => d.date) as [Date, Date])
      .range([0, innerWidth]);

    const minClose = d3.min(series, (d) => d.close) ?? 0;
    const maxClose = d3.max(series, (d) => d.close) ?? 1;
    const pad = (maxClose - minClose) * 0.1 || maxClose * 0.1 || 1;
    const y = d3
      .scaleLinear()
      .domain([minClose - pad, maxClose + pad])
      .nice()
      .range([innerHeight, 0]);

    // Gridlines — solid hairline, one step off the surface color.
    g.selectAll('.grid-line-y')
      .data(y.ticks(5))
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => y(d))
      .attr('y2', (d) => y(d))
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1);

    g.append('g')
      .attr('class', 'axis axis--y')
      .call(d3.axisLeft(y).ticks(5).tickFormat((d) => `$${Number(d).toFixed(0)}`))
      .selectAll('text')
      .attr('fill', '#6b7280')
      .attr('font-size', '12px');

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(Math.min(6, series.length)).tickFormat((d) => formatAxisDate(d as Date)))
      .selectAll('text')
      .attr('fill', '#6b7280')
      .attr('font-size', '12px');

    // Price line
    const lineGen = d3
      .line<SeriesPoint>()
      .x((d) => x(d.date))
      .y((d) => y(d.close));

    g.append('path').datum(series).attr('fill', 'none').attr('stroke', '#2a78d6').attr('stroke-width', 2).attr('d', lineGen);

    const JITTER_PX = 5;
    const markerX = (d: MarkerPoint) => x(d.date) + d.jitter * JITTER_PX;
    const markerColor = (d: MarkerPoint) => (d.direction === 'buy' ? '#10b981' : d.direction === 'sell' ? '#ef4444' : '#9ca3af');

    const tooltip = d3.select(tooltipRef.current);

    function renderTradeRows(items: MarkerPoint[]) {
      return items
        .map(
          (m) =>
            `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:2px;">
              <span style="color:${markerColor(m)};font-weight:600;">${m.direction === 'buy' ? 'Buy' : m.direction === 'sell' ? 'Sell' : 'Trade'}</span>
              <span style="font-weight:700;">${formatMoney(m.amount)}</span>
            </div>`
        )
        .join('');
    }

    function showTooltip(clientX: number, clientY: number, date: Date, close: number, dayMarkers: MarkerPoint[]) {
      tooltip
        .style('opacity', '1')
        .style('left', `${clientX + 14}px`)
        .style('top', `${clientY - 10}px`)
        .html(
          `<div style="font-weight:700;margin-bottom:4px;">${formatTooltipDate(date)}</div>
           <div>Price: <b>$${close.toFixed(2)}</b></div>
           ${renderTradeRows(dayMarkers)}`
        );
    }

    function hideTooltip() {
      tooltip.style('opacity', '0');
    }

    // Crosshair driven by pointer position across the whole plot area.
    const crosshair = g
      .append('line')
      .attr('class', 'crosshair')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 1)
      .style('opacity', 0);

    const bisectDate = d3.bisector<SeriesPoint, Date>((d) => d.date).left;

    g.append('rect')
      .attr('width', innerWidth)
      .attr('height', innerHeight)
      .attr('fill', 'transparent')
      .style('cursor', 'crosshair')
      .on('pointermove', (event: PointerEvent) => {
        const [mx] = d3.pointer(event);
        const hoveredDate = x.invert(mx);
        const idx = bisectDate(series, hoveredDate);
        const d0 = series[Math.max(0, idx - 1)];
        const d1 = series[Math.min(series.length - 1, idx)];
        const point = !d1 ? d0 : !d0 ? d1 : hoveredDate.getTime() - d0.date.getTime() > d1.date.getTime() - hoveredDate.getTime() ? d1 : d0;

        crosshair.attr('x1', x(point.date)).attr('x2', x(point.date)).style('opacity', 1);

        const key = point.date.toISOString().slice(0, 10);
        const dayMarkers = markers.filter((m) => m.date.toISOString().slice(0, 10) === key);

        showTooltip(event.clientX, event.clientY, point.date, point.close, dayMarkers);
      })
      .on('pointerleave', () => {
        crosshair.style('opacity', 0);
        hideTooltip();
      });

    // Markers group is appended after the overlay rect so it paints on top and
    // can receive its own pointer/focus events instead of the overlay eating them.
    const markerG = g.append('g').attr('class', 'markers');

    // Trade markers — hit target is bigger than the painted dot (>=24px).
    const markerSel = markerG
      .selectAll<SVGCircleElement, MarkerPoint>('.trade-hit')
      .data(markers)
      .enter()
      .append('circle')
      .attr('class', 'trade-hit')
      .attr('cx', markerX)
      .attr('cy', (d) => y(d.close))
      .attr('r', 12)
      .attr('fill', 'transparent')
      .attr('tabindex', 0)
      .attr('role', 'button')
      .attr(
        'aria-label',
        (d) => `${d.direction === 'buy' ? 'Purchase' : d.direction === 'sell' ? 'Sale' : 'Trade'} on ${formatTooltipDate(d.date)}, ${formatMoney(d.amount)}`
      )
      .style('cursor', 'pointer')
      .on('pointerenter focus', function (event, d) {
        d3.select(this.previousSibling as SVGCircleElement | null).attr('r', 8);
        const key = d.date.toISOString().slice(0, 10);
        const dayMarkers = markers.filter((m) => m.date.toISOString().slice(0, 10) === key);
        const clientPos = 'clientX' in event ? event : (this as SVGCircleElement).getBoundingClientRect();
        const clientX = 'clientX' in event ? event.clientX : clientPos.left;
        const clientY = 'clientY' in event ? event.clientY : clientPos.top;
        crosshair.attr('x1', markerX(d)).attr('x2', markerX(d)).style('opacity', 1);
        showTooltip(clientX, clientY, d.date, d.close, dayMarkers);
      })
      .on('pointerleave blur', function () {
        d3.select(this.previousSibling as SVGCircleElement | null).attr('r', 6);
        crosshair.style('opacity', 0);
        hideTooltip();
      });

    // Visible marker dot drawn before the hit target so the hit target sits on top for events.
    markerSel.each(function (d) {
      const node = d3.select(this);
      const parent = d3.select(this.parentNode as SVGGElement);
      parent
        .insert('circle', () => node.node())
        .attr('class', 'trade-dot')
        .attr('cx', markerX(d))
        .attr('cy', y(d.close))
        .attr('r', 6)
        .attr('fill', markerColor(d))
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)
        .style('pointer-events', 'none');
    });
  }, [series, markers, ticker]);

  if (series.length === 0) {
    return (
      <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px', marginBottom: '24px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#111827', marginBottom: '8px' }}>Price History</h2>
        <div style={{ color: '#9ca3af', textAlign: 'center', padding: '40px 20px', fontSize: '14px' }}>
          No price data available for this range.
        </div>
      </div>
    );
  }

  return (
    <div style={{ background: '#fff', borderRadius: '12px', border: '1px solid #e2e8f0', padding: '16px', marginBottom: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: '16px', fontWeight: 700, color: '#111827' }}>Price History</h2>
        <span style={{ fontSize: '12px', color: '#9ca3af' }}>
          {priceInterval ? intervalLabel[priceInterval] : ''} close price
        </span>
      </div>
      <div style={{ width: '100%', overflow: 'hidden' }}>
        <svg ref={svgRef} />
      </div>
      {markers.length === 0 && (
        <p style={{ textAlign: 'center', color: '#9ca3af', fontSize: '12px', marginTop: '8px' }}>No trades match the current filter.</p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 24px', marginTop: '16px', justifyContent: 'center', fontSize: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#10b981' }} />
          <span style={{ color: '#6b7280' }}>Purchases</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444' }} />
          <span style={{ color: '#6b7280' }}>Sales</span>
        </div>
      </div>
      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          background: 'rgba(15,23,42,0.92)',
          color: '#fff',
          padding: '8px 12px',
          borderRadius: '8px',
          fontSize: '12px',
          pointerEvents: 'none',
          opacity: 0,
          zIndex: 9999,
          transition: 'opacity 0.12s',
        }}
      />
    </div>
  );
}

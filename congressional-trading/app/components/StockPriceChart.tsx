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
};
type MarkerCluster = {
  direction: 'buy' | 'sell' | 'other';
  px: number;
  py: number;
  count: number;
  totalAmount: number;
  minDate: Date;
  maxDate: Date;
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

function sanitizeForId(value: string) {
  return value.replace(/[^a-zA-Z0-9]/g, '');
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

    return trades
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

    const trendColor =
      series[series.length - 1].close >= series[0].close ? 'var(--color-positive)' : 'var(--color-negative)';

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

    const gradientId = `price-gradient-${sanitizeForId(ticker)}`;
    const defs = svg.append('defs');
    const gradient = defs
      .append('linearGradient')
      .attr('id', gradientId)
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');
    gradient.append('stop').attr('offset', '0%').attr('stop-color', trendColor).attr('stop-opacity', 0.25);
    gradient.append('stop').attr('offset', '100%').attr('stop-color', trendColor).attr('stop-opacity', 0);

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

    // Minimal axes — no domain line, no tick marks, just quiet labels. Gridlines are
    // deliberately gone; precision comes from the hover tooltip, not a ruled grid.
    const yAxis = g
      .append('g')
      .call(d3.axisLeft(y).ticks(4).tickSize(0).tickFormat((d) => `$${Number(d).toFixed(0)}`));
    yAxis.select('.domain').remove();
    yAxis.selectAll('text').attr('fill', 'var(--color-text-muted)').attr('font-size', '11px').attr('dx', '-4px');

    const xAxis = g
      .append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).ticks(Math.min(6, series.length)).tickSize(0).tickFormat((d) => formatAxisDate(d as Date)));
    xAxis.select('.domain').remove();
    xAxis.selectAll('text').attr('fill', 'var(--color-text-muted)').attr('font-size', '11px');

    // Area fill + line — smooth curve, gradient fading to transparent, colored by
    // whether the stock is up or down over the visible range (the classic
    // Google Finance / brokerage-app treatment).
    const areaGen = d3
      .area<SeriesPoint>()
      .x((d) => x(d.date))
      .y0(innerHeight)
      .y1((d) => y(d.close))
      .curve(d3.curveMonotoneX);

    const lineGen = d3
      .line<SeriesPoint>()
      .x((d) => x(d.date))
      .y((d) => y(d.close))
      .curve(d3.curveMonotoneX);

    g.append('path').datum(series).attr('fill', `url(#${gradientId})`).attr('d', areaGen);
    g.append('path').datum(series).attr('fill', 'none').attr('stroke', trendColor).attr('stroke-width', 2).attr('d', lineGen);

    const markerColor = (direction: 'buy' | 'sell' | 'other') =>
      direction === 'buy' ? 'var(--color-positive)' : direction === 'sell' ? 'var(--color-negative)' : 'var(--color-text-muted)';

    const tooltip = d3.select(tooltipRef.current);

    function renderTradeRows(items: MarkerPoint[]) {
      const byDirection = new Map<'buy' | 'sell' | 'other', { count: number; total: number }>();
      for (const m of items) {
        const entry = byDirection.get(m.direction) ?? { count: 0, total: 0 };
        entry.count += 1;
        entry.total += m.amount;
        byDirection.set(m.direction, entry);
      }
      return Array.from(byDirection.entries())
        .map(([direction, { count, total }]) => {
          const label = direction === 'buy' ? 'Buy' : direction === 'sell' ? 'Sell' : 'Trade';
          return `<div style="display:flex;justify-content:space-between;gap:12px;margin-top:2px;">
              <span style="color:${markerColor(direction)};font-weight:600;">${label}${count > 1 ? ` ×${count}` : ''}</span>
              <span style="font-weight:700;">${formatMoney(total)}</span>
            </div>`;
        })
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

    // Crosshair + a focus dot pinned to the line at the hovered date — the detail
    // that makes a hover feel like Google Finance instead of a bare vertical rule.
    const crosshair = g
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', 'var(--color-border-strong)')
      .attr('stroke-width', 1)
      .style('opacity', 0);

    const focusDot = g
      .append('circle')
      .attr('r', 4)
      .attr('fill', trendColor)
      .attr('stroke', 'var(--color-bg)')
      .attr('stroke-width', 1.5)
      .style('opacity', 0)
      .style('pointer-events', 'none');

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
        focusDot.attr('cx', x(point.date)).attr('cy', y(point.close)).style('opacity', 1);

        const key = point.date.toISOString().slice(0, 10);
        const dayMarkers = markers.filter((m) => m.date.toISOString().slice(0, 10) === key);

        showTooltip(event.clientX, event.clientY, point.date, point.close, dayMarkers);
      })
      .on('pointerleave', () => {
        crosshair.style('opacity', 0);
        focusDot.style('opacity', 0);
        hideTooltip();
      });

    // Cluster trades that land within a few pixels of each other (same direction) into a
    // single density-scaled bubble instead of a pile of overlapping, unreadable dots — the
    // visual weight (size) carries how many trades are represented, like a mini heatmap.
    const PIXEL_BUCKET = 10;
    type ClusterAccum = {
      direction: 'buy' | 'sell' | 'other';
      pxSum: number;
      pySum: number;
      count: number;
      totalAmount: number;
      minDate: Date;
      maxDate: Date;
    };
    const clusterMap = new Map<string, ClusterAccum>();
    for (const m of markers) {
      const px = x(m.date);
      const py = y(m.close);
      const bucketKey = `${m.direction}:${Math.round(px / PIXEL_BUCKET)}`;
      const existing = clusterMap.get(bucketKey);
      if (existing) {
        existing.pxSum += px;
        existing.pySum += py;
        existing.count += 1;
        existing.totalAmount += m.amount;
        if (m.date < existing.minDate) existing.minDate = m.date;
        if (m.date > existing.maxDate) existing.maxDate = m.date;
      } else {
        clusterMap.set(bucketKey, {
          direction: m.direction,
          pxSum: px,
          pySum: py,
          count: 1,
          totalAmount: m.amount,
          minDate: m.date,
          maxDate: m.date,
        });
      }
    }

    const clusters: MarkerCluster[] = Array.from(clusterMap.values()).map((c) => ({
      direction: c.direction,
      px: c.pxSum / c.count,
      py: c.pySum / c.count,
      count: c.count,
      totalAmount: c.totalAmount,
      minDate: c.minDate,
      maxDate: c.maxDate,
    }));

    // Base dot is deliberately below the usual marker floor (r>=4) — with many trades on
    // one line, small individual dots plus size-scaled clusters read far better than large
    // dots that bury the price line underneath them.
    const BASE_R = 3;
    const MAX_R = 14;
    // A fixed domain (not each chart's own max) so a 3-trade cluster always reads as
    // "a few trades" and a 40-trade cluster always reads as "very dense", consistent
    // across tickers — a per-chart-relative max would make the same count look tiny on
    // a heavily-traded ticker and huge on a sparse one.
    const CLUSTER_SCALE_MAX = 40;
    const radiusScale = d3.scaleSqrt().domain([1, CLUSTER_SCALE_MAX]).range([BASE_R, MAX_R]).clamp(true);
    const opacityScale = d3.scaleLinear().domain([1, CLUSTER_SCALE_MAX]).range([0.65, 1]).clamp(true);

    function clusterTooltipHtml(c: MarkerCluster) {
      const color = markerColor(c.direction);
      const singularLabel = c.direction === 'buy' ? 'Purchase' : c.direction === 'sell' ? 'Sale' : 'Trade';
      if (c.count === 1) {
        return `<div style="font-weight:700;margin-bottom:4px;">${formatTooltipDate(c.minDate)}</div>
          <div style="display:flex;justify-content:space-between;gap:12px;">
            <span style="color:${color};font-weight:600;">${singularLabel}</span>
            <span style="font-weight:700;">${formatMoney(c.totalAmount)}</span>
          </div>`;
      }
      const dateRange =
        c.minDate.getTime() === c.maxDate.getTime()
          ? formatTooltipDate(c.minDate)
          : `${formatTooltipDate(c.minDate)} – ${formatTooltipDate(c.maxDate)}`;
      return `<div style="font-weight:700;margin-bottom:4px;">${dateRange}</div>
        <div style="display:flex;justify-content:space-between;gap:12px;">
          <span style="color:${color};font-weight:600;">${c.count} ${singularLabel.toLowerCase()}s</span>
          <span style="font-weight:700;">${formatMoney(c.totalAmount)}</span>
        </div>`;
    }

    // Markers group is appended after the overlay rect so it paints on top and
    // can receive its own pointer/focus events instead of the overlay eating them.
    const markerG = g.append('g').attr('class', 'markers');

    // Trade markers — hit target is bigger than the painted dot (>=24px) regardless of
    // how small the dot itself renders.
    const markerSel = markerG
      .selectAll<SVGCircleElement, MarkerCluster>('.trade-hit')
      .data(clusters)
      .enter()
      .append('circle')
      .attr('class', 'trade-hit')
      .attr('cx', (d) => d.px)
      .attr('cy', (d) => d.py)
      .attr('r', (d) => Math.max(12, radiusScale(d.count) + 6))
      .attr('fill', 'transparent')
      .style('cursor', 'pointer')
      .on('pointerenter', function (event, d) {
        d3.select(this.previousSibling as SVGCircleElement | null).attr('r', radiusScale(d.count) + 2);
        crosshair.attr('x1', d.px).attr('x2', d.px).style('opacity', 1);
        tooltip
          .style('opacity', '1')
          .style('left', `${event.clientX + 14}px`)
          .style('top', `${event.clientY - 10}px`)
          .html(clusterTooltipHtml(d));
      })
      .on('pointerleave', function (_event, d) {
        d3.select(this.previousSibling as SVGCircleElement | null).attr('r', radiusScale(d.count));
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
        .attr('cx', d.px)
        .attr('cy', d.py)
        .attr('r', radiusScale(d.count))
        .attr('fill', markerColor(d.direction))
        .attr('fill-opacity', opacityScale(d.count))
        .attr('stroke', 'var(--color-bg)')
        .attr('stroke-width', 1.5)
        .style('pointer-events', 'none')
        .style('transition', 'r 0.15s ease');
    });
  }, [series, markers, ticker]);

  if (series.length === 0) {
    return (
      <div className="mb-6 rounded-md border border-(--color-border) bg-white p-4">
        <h2 className="mb-2 text-base font-bold text-foreground">Price History</h2>
        <div className="px-5 py-10 text-center text-sm text-(--color-text-muted)">No price data available for this range.</div>
      </div>
    );
  }

  return (
    <div className="mb-6 rounded-md border border-(--color-border) bg-white p-4">
      <div className="mb-4 flex flex-wrap items-baseline gap-2">
        <h2 className="text-base font-bold text-foreground">Price History</h2>
        <span className="text-xs text-(--color-text-muted)">{priceInterval ? intervalLabel[priceInterval] : ''} close price</span>
      </div>
      <div className="w-full overflow-hidden">
        <svg ref={svgRef} />
      </div>
      {markers.length === 0 && <p className="mt-2 text-center text-xs text-(--color-text-muted)">No trades match the current filter.</p>}
      <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-(--color-positive)" />
          <span className="text-(--color-text-secondary)">Purchases</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-(--color-negative)" />
          <span className="text-(--color-text-secondary)">Sales</span>
        </div>
      </div>
      <div
        ref={tooltipRef}
        style={{
          position: 'fixed',
          background: 'var(--color-ink)',
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

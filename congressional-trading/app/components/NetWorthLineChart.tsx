'use client';

import { useEffect, useRef } from 'react';
import * as d3 from 'd3';

export type NetWorthHistoryPoint = {
  year: number;
  netWorth: number;
};

function formatMoney(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

export default function NetWorthLineChart({
  data,
  isLoading,
  onYearClick,
}: {
  data: NetWorthHistoryPoint[];
  isLoading: boolean;
  onYearClick?: (year: number) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    if (data.length === 0) return;

    const W = 900;
    const H = 300;
    const margin = { top: 24, right: 40, bottom: 48, left: 80 };
    const iw = W - margin.left - margin.right;
    const ih = H - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${W} ${H}`).attr('preserveAspectRatio', 'xMidYMid meet').style('width', '100%').style('height', 'auto');

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const years = data.map((d) => d.year);
    const xScale = d3.scalePoint<number>().domain(years).range([0, iw]).padding(0.3);

    const allValues = data.map((d) => d.netWorth);
    const yMin = Math.min(0, d3.min(allValues) ?? 0);
    const yMax = d3.max(allValues) ?? 1;
    const yPad = (yMax - yMin) * 0.12;
    const yScale = d3.scaleLinear().domain([yMin - yPad, yMax + yPad]).nice().range([ih, 0]);

    // Grid lines
    g.selectAll('.grid')
      .data(yScale.ticks(5))
      .enter()
      .append('line')
      .attr('x1', 0).attr('x2', iw)
      .attr('y1', (d) => yScale(d)).attr('y2', (d) => yScale(d))
      .attr('stroke', '#e5e7eb').attr('stroke-dasharray', '3,3');

    // Zero line (if visible)
    if (yMin < 0) {
      g.append('line')
        .attr('x1', 0).attr('x2', iw)
        .attr('y1', yScale(0)).attr('y2', yScale(0))
        .attr('stroke', '#9ca3af').attr('stroke-width', 1.5);
    }

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${ih})`)
      .call(d3.axisBottom(xScale).tickFormat((d) => String(d)))
      .selectAll('text')
      .style('fill', '#374151')
      .style('font-size', '12px')
      .style('font-weight', '600');

    g.append('g')
      .call(d3.axisLeft(yScale).ticks(5).tickFormat((d) => formatMoney(Number(d))))
      .selectAll('text')
      .style('fill', '#6b7280')
      .style('font-size', '11px');

    // Tooltip div
    const tooltip = d3
      .select('body')
      .append('div')
      .style('position', 'fixed')
      .style('background', 'rgba(15,23,42,0.92)')
      .style('color', '#fff')
      .style('padding', '8px 12px')
      .style('border-radius', '8px')
      .style('font-size', '12px')
      .style('pointer-events', 'none')
      .style('opacity', '0')
      .style('z-index', '9999')
      .style('transition', 'opacity 0.12s');

    // Line
    const lineGen = d3
      .line<NetWorthHistoryPoint>()
      .x((d) => xScale(d.year) ?? 0)
      .y((d) => yScale(d.netWorth))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#3b82f6')
      .attr('stroke-width', 2.5)
      .attr('d', lineGen);

    // Dots
    g.selectAll('.dot')
      .data(data)
      .enter()
      .append('circle')
      .attr('cx', (d) => xScale(d.year) ?? 0)
      .attr('cy', (d) => yScale(d.netWorth))
      .attr('r', 5)
      .attr('fill', '#3b82f6')
      .attr('stroke', '#fff')
      .attr('stroke-width', 1.5)
      .style('cursor', onYearClick ? 'pointer' : 'default')
      .on('mouseover', function (event, d) {
        d3.select(this).attr('r', 7).attr('fill', '#2563eb');
        tooltip
          .style('opacity', '1')
          .html(
            `<div style="font-weight:700;margin-bottom:4px;">${d.year}</div>
             <div>Net Worth: <b>${formatMoney(d.netWorth)}</b></div>
             ${onYearClick ? '<div style="margin-top:4px;font-size:11px;color:#93c5fd">Click for detail</div>' : ''}`
          );
      })
      .on('mousemove', function (event) {
        tooltip
          .style('left', `${(event as MouseEvent).clientX + 14}px`)
          .style('top', `${(event as MouseEvent).clientY - 8}px`);
      })
      .on('mouseleave', function () {
        d3.select(this).attr('r', 5).attr('fill', '#3b82f6');
        tooltip.style('opacity', '0');
      })
      .on('click', function (_event, d) {
        if (onYearClick) onYearClick(d.year);
      });

    return () => { tooltip.remove(); };
  }, [data, onYearClick]);

  if (isLoading) {
    return (
      <div style={{ height: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ width: '32px', height: '32px', border: '3px solid #e0e7ff', borderTopColor: '#3b82f6', borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto' }} />
          <p style={{ marginTop: '12px', fontSize: '13px', color: '#9ca3af' }}>Loading historical data…</p>
        </div>
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div style={{ height: '120px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <p style={{ fontSize: '14px', color: '#9ca3af' }}>No historical net worth data available.</p>
      </div>
    );
  }

  if (data.length === 1) {
    const [d] = data;
    return (
      <div style={{ textAlign: 'center', padding: '24px 0' }}>
        <p style={{ fontSize: '13px', color: '#6b7280', marginBottom: '6px' }}>{d.year}</p>
        <p style={{ fontSize: '28px', fontWeight: 800, color: '#1e3a8a' }}>
          {formatMoney(d.netWorth)}
        </p>
        {onYearClick && (
          <button
            onClick={() => onYearClick(d.year)}
            style={{ marginTop: '10px', fontSize: '12px', color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}
          >
            View breakdown
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ width: '100%', overflow: 'hidden' }}>
      <svg ref={svgRef} />
    </div>
  );
}

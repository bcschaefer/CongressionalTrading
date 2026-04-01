'use client';

import { useState, useEffect } from 'react';
import * as d3 from 'd3';

export default function Hero() {
  // Mock data for recent trades - to be replaced with database fetch
  const recentTrades = [
    { congressman: 'John Doe', type: 'Buy', amount: '$10,000', ticker: 'AAPL', date: '2023-10-01', description: 'Initial investment in tech sector' },
    { congressman: 'Jane Smith', type: 'Sell', amount: '$5,000', ticker: 'GOOGL', date: '2023-10-02', description: 'Profit taking on Google shares' },
    { congressman: 'Bob Johnson', type: 'Buy', amount: '$15,000', ticker: 'MSFT', date: '2023-10-03', description: 'Diversification into software' },
    { congressman: 'Alice Brown', type: 'Sell', amount: '$8,000', ticker: 'TSLA', date: '2023-10-04', description: 'Selling Tesla holdings' },
    { congressman: 'Charlie Wilson', type: 'Buy', amount: '$12,000', ticker: 'AMZN', date: '2023-10-05', description: 'Amazon growth opportunity' },
  ];

  const [hoveredTrade, setHoveredTrade] = useState(recentTrades[0]);

  const maxAmount = Math.max(
    ...recentTrades.map((trade) => parseInt(trade.amount.replace('$', '').replace(',', '')))
  );

  useEffect(() => {
    if (hoveredTrade) {
      renderD3Graph(hoveredTrade);
    }
  }, [hoveredTrade]);

  const renderD3Graph = (trade) => {
    const amount = parseInt(trade.amount.replace('$', '').replace(',', ''));

    const svg = d3.select('#d3-graph');
    svg.selectAll('*').remove();

    const width = 300, height = 250, margin = { top: 40, right: 20, bottom: 50, left: 60 };

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    svg.attr('viewBox', `0 0 ${width} ${height}`);

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand().domain([trade.ticker]).range([0, innerWidth]).padding(0.3);
    const y = d3.scaleLinear().domain([0, maxAmount]).nice().range([innerHeight, 0]);

    // Add title
    svg.append('text')
      .attr('x', width / 2)
      .attr('y', 20)
      .attr('text-anchor', 'middle')
      .attr('class', 'text-lg font-bold text-gray-800')
      .text(`${trade.congressman} - ${trade.type}`);

    g.append('g')
      .attr('class', 'axis axis--y')
      .call(d3.axisLeft(y).ticks(5).tickFormat(d => `$${d / 1000}k`));

    g.append('g')
      .attr('class', 'axis axis--x')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x));

    // Add grid lines
    g.selectAll('.grid-line')
      .data(y.ticks(5))
      .enter()
      .append('line')
      .attr('class', 'grid-line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', d => y(d))
      .attr('y2', d => y(d))
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2,2');

    g.selectAll('.bar')
      .data([trade])
      .enter().append('rect')
      .attr('class', 'bar')
      .attr('x', d => x(d.ticker))
      .attr('y', innerHeight)
      .attr('width', x.bandwidth())
      .attr('height', 0)
      .attr('fill', trade.type === 'Buy' ? '#10b981' : '#ef4444')
      .attr('rx', 4)
      .transition()
      .duration(700)
      .ease(d3.easeCubic)
      .attr('y', d => y(amount))
      .attr('height', d => innerHeight - y(amount));

    // Add value label
    g.selectAll('.label')
      .data([trade])
      .enter().append('text')
      .attr('class', 'label')
      .attr('x', d => x(d.ticker) + x.bandwidth() / 2)
      .attr('y', d => y(amount) - 5)
      .attr('text-anchor', 'middle')
      .attr('fill', '#374151')
      .attr('font-size', '12px')
      .attr('font-weight', 'bold')
      .text(d => `$${amount / 1000}k`);
  };

  return (
    <div>
      <div className="h-[90vh] bg-linear-to-r from-red-500 to-blue-500 flex items-center justify-center text-center text-white">
        <div>
          <h1 className="text-9xl p-3 font-bold bg-linear-to-r from-blue-500 to-red-500 bg-clip-text text-transparent drop-shadow-lg">
            InsideTrader
          </h1>

          <p className="text-3xl opacity-50 drop-shadow-2xl mb-8">
            Money in Congress
          </p>

          <div className="flex justify-center gap-6">
            <button className="px-6 py-3 text-lg font-semibold text-white rounded-lg shadow-lg bg-violet-600/20 backdrop-blur-md hover:bg-white/20 hover:scale-110 transition cursor-pointer">
              Top Stocks
            </button>

            <button className="px-6 py-3 text-lg font-semibold text-white rounded-lg shadow-lg bg-violet-600/20 backdrop-blur-md hover:bg-white/20 hover:scale-110 transition cursor-pointer">
              Top Representatives
            </button>
          </div>
        </div>
      </div>

      <div className="p-8 bg-gradient-to-br from-gray-50 to-blue-50 min-h-screen flex gap-8">
        <div className="w-1/2">
          <h2 className="text-2xl font-bold mb-4 text-gray-800 bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">Trade Graph</h2>
          <div className="bg-white p-4 rounded-xl shadow-xl border border-gray-200">
            <svg id="d3-graph" className="w-full"></svg>
          </div>
        </div>

        <div className="w-1/2">
          <h2 className="text-4xl font-bold text-center mb-8 text-gray-800 bg-gradient-to-r from-red-600 to-pink-600 bg-clip-text text-transparent">Recent Trades</h2>
          <div className="overflow-auto max-h-96 bg-white rounded-xl shadow-xl border border-gray-200">
            <table className="w-full">
              <thead className="bg-gradient-to-r from-gray-100 to-gray-200">
                <tr>
                  <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Congressman</th>
                  <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Ticker</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {recentTrades.map((trade, index) => (
                  <tr 
                    key={index} 
                    className={`cursor-pointer transition-all duration-200 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} hover:bg-blue-50 hover:shadow-md`}
                    onMouseEnter={() => setHoveredTrade(trade)}
                  >
                    <td className="px-6 py-6 whitespace-nowrap text-sm font-medium text-gray-900 text-center">{trade.congressman}</td>
                    <td className="px-6 py-6 whitespace-nowrap text-sm text-gray-500 text-center">
                      <span className={`px-3 py-1 inline-flex text-xs leading-5 font-semibold rounded-full transition-all duration-200 ${trade.type === 'Buy' ? 'bg-green-100 text-green-800 hover:bg-green-200' : 'bg-red-100 text-red-800 hover:bg-red-200'}`}>
                        {trade.type}
                      </span>
                    </td>
                    <td className="px-6 py-6 whitespace-nowrap text-sm text-gray-500 text-center font-semibold">{trade.amount}</td>
                    <td className="px-6 py-6 whitespace-nowrap text-sm text-gray-500 text-center font-mono bg-gray-100 rounded px-2 py-1">{trade.ticker}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
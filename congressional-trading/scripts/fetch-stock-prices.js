#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv/config');

const pkg = require('yahoo-finance2');
const YahooFinance = pkg.default;
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Client: PgClient } = require('pg');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const yahooFinance = new YahooFinance();

async function fetchHistoricalPrices(ticker, startDate, endDate) {
  try {
    const result = await yahooFinance.historical(ticker, {
      period1: startDate,
      period2: endDate,
    });

    // Create a map of date -> price
    const priceMap = new Map();
    for (const candle of result) {
      const dateStr = candle.date.toISOString().split('T')[0];
      priceMap.set(dateStr, candle.close);
    }

    return priceMap;
  } catch (error) {
    console.error(`Failed to fetch prices for ${ticker}:`, error.message);
    return new Map();
  }
}

async function main() {
  console.log('Fetching unique tickers from database...');

  const connectionString =
    process.env.TRADING_STORAGE_PRISMA_DATABASE_URL ||
    process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL or TRADING_STORAGE_PRISMA_DATABASE_URL must be set');
  }

  const pgClient = new PgClient({
    connectionString,
  });

  const adapter = new PrismaPg(pgClient);
  const prisma = new PrismaClient({ adapter });

  await prisma.$connect();

  try {
    const uniqueTickers = await prisma.trades.findMany({
      where: { ticker: { not: null } },
      distinct: ['ticker'],
      select: { ticker: true },
    });

    const tickers = uniqueTickers.map((t) => t.ticker).filter((t) => t && t.trim());
    console.log(`Found ${tickers.length} unique tickers`);

    // Date range for historical prices
    const endDate = new Date();
    const startDate = new Date();
    startDate.setFullYear(startDate.getFullYear() - 5); // Get 5 years of data

    for (const ticker of tickers) {
      if (!ticker) continue;

      console.log(`\nFetching prices for ${ticker}...`);
      const priceMap = await fetchHistoricalPrices(ticker, startDate, endDate);

      if (priceMap.size === 0) {
        console.log(`  No price data found for ${ticker}`);
        continue;
      }

      // Get all trades for this ticker
      const trades = await prisma.trades.findMany({
        where: { ticker },
        select: { id: true, trade_date: true, price_start: true },
      });

      let updated = 0;
      for (const trade of trades) {
        if (!trade.trade_date || trade.price_start) continue; // Skip if no date or already has price

        const dateStr = trade.trade_date;
        let price = priceMap.get(dateStr);

        // If exact date not found, try nearby dates
        if (!price) {
          const tradeDate = new Date(`${dateStr}T00:00:00`);
          let searchDate = new Date(tradeDate);

          // Look up to 5 business days back
          for (let i = 1; i <= 5; i++) {
            searchDate.setDate(searchDate.getDate() - 1);
            const searchStr = searchDate.toISOString().split('T')[0];
            if (priceMap.has(searchStr)) {
              price = priceMap.get(searchStr);
              break;
            }
          }
        }

        if (price) {
          await prisma.trades.update({
            where: { id: trade.id },
            data: { price_start: price },
          });
          updated++;
        }
      }

      console.log(`  Updated ${updated} trades with price data`);

      // Rate limit to avoid hitting API limits
      await sleep(1000);
    }

    console.log('\nDone!');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

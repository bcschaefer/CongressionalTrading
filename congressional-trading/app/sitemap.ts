import type { MetadataRoute } from 'next';
import { prisma } from '@/lib/prisma';

export const revalidate = 86400; // regenerate once per day

const BASE = 'https://insidetrader.app';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Static routes
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: BASE, lastModified: new Date(), changeFrequency: 'daily', priority: 1.0 },
    { url: `${BASE}/representatives`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 },
    { url: `${BASE}/stocks`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.7 },
  ];

  // Dynamic congressman pages
  const members = await prisma.members.findMany({
    select: { bioguide: true },
  });

  const memberRoutes: MetadataRoute.Sitemap = members.map((m) => ({
    url: `${BASE}/congressman/${m.bioguide}`,
    changeFrequency: 'weekly' as const,
    priority: 0.6,
  }));

  // Dynamic stock ticker pages
  const tickers = await prisma.disclosures.findMany({
    where: { ticker: { not: null } },
    select: { ticker: true },
    distinct: ['ticker'],
  });

  const stockRoutes: MetadataRoute.Sitemap = tickers
    .filter((t) => t.ticker)
    .map((t) => ({
      url: `${BASE}/stocks/${t.ticker}`,
      changeFrequency: 'weekly' as const,
      priority: 0.5,
    }));

  return [...staticRoutes, ...memberRoutes, ...stockRoutes];
}

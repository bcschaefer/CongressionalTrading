import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

type SearchResult = {
  type: 'member' | 'stock';
  label: string;
  sublabel: string;
  href: string;
};

function cleanQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const rawQuery = searchParams.get('q') ?? '';
    const q = cleanQuery(rawQuery);

    if (q.length < 2) {
      return NextResponse.json({ results: [] as SearchResult[] });
    }

    const [members, stocks] = await Promise.all([
      prisma.members.findMany({
        where: {
          OR: [
            { full_name: { contains: q, mode: 'insensitive' } },
            { bioguide: { contains: q.toUpperCase(), mode: 'insensitive' } },
          ],
        },
        orderBy: [{ is_active: 'desc' }, { full_name: 'asc' }],
        take: 6,
        select: {
          bioguide: true,
          full_name: true,
          party: true,
          chamber: true,
          is_active: true,
        },
      }),
      prisma.trades.groupBy({
        by: ['ticker'],
        where: {
          ticker: {
            not: null,
            contains: q.toUpperCase(),
            mode: 'insensitive',
          },
        },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 6,
      }),
    ]);

    const memberResults: SearchResult[] = members.map((m: (typeof members)[number]) => {
      const parts = [m.party, m.chamber, m.is_active ? 'Active' : 'Former'].filter(Boolean);
      return {
        type: 'member',
        label: m.full_name,
        sublabel: `${parts.join(' • ')} • ${m.bioguide}`,
        href: `/congressman/${m.bioguide}`,
      };
    });

    const filteredStocks = stocks.filter((s: (typeof stocks)[number]) => s.ticker && s.ticker.trim() !== '');
    const stockResults: SearchResult[] = filteredStocks.map((s: (typeof filteredStocks)[number]) => ({
        type: 'stock',
        label: s.ticker!,
        sublabel: `${s._count.id} trades`,
        href: `/stocks/${encodeURIComponent(s.ticker!)}`,
      }));

    // Keep results stable and intuitive: exact/startsWith first within each type.
    const queryLower = q.toLowerCase();
    const rank = (text: string) => {
      const t = text.toLowerCase();
      if (t === queryLower) return 0;
      if (t.startsWith(queryLower)) return 1;
      return 2;
    };

    memberResults.sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));
    stockResults.sort((a, b) => rank(a.label) - rank(b.label) || a.label.localeCompare(b.label));

    const results = [...memberResults, ...stockResults].slice(0, 10);

    return NextResponse.json(
      { results },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=120' } }
    );
  } catch (error) {
    console.error('Failed to run search', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

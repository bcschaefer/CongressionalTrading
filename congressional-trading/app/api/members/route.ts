import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
import { prisma } from '@/lib/prisma';

// `revalidate` alone doesn't reliably re-run this route in production — Next.js can
// treat it as fully static and freeze it at whatever the last build produced. Force
// per-request execution and let the Cache-Control header below handle CDN caching.
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const members = await prisma.members.findMany({
      where: {
        OR: [
          { is_active: true },
          { disclosures: { some: {} } },
        ],
      },
      orderBy: { full_name: 'asc' },
      select: {
        bioguide: true,
        full_name: true,
        party: true,
        chamber: true,
        state: true,
        is_active: true,
        annual_disclosures: {
          orderBy: { filing_year: 'asc' },
          select: { filing_year: true },
        },
        net_worth_history: {
          orderBy: { year: 'desc' },
          take: 1,
        },
      },
    });

    const result = members.map((m) => {
      const years = m.annual_disclosures.map((d) => d.filing_year).filter(Boolean);
      const firstYear = years.length > 0 ? Math.min(...years) : null;
      const lastYear = years.length > 0 ? Math.max(...years) : null;

      const latestNetWorth = (m.net_worth_history as Array<{ net_worth: number | null }>)[0]?.net_worth ?? null;

      return {
        bioguide: m.bioguide,
        full_name: m.full_name,
        party: m.party,
        chamber: m.chamber,
        is_active: m.is_active,
        state: m.state,
        first_year: firstYear,
        last_year: lastYear,
        net_worth: latestNetWorth,
      };
    });

    return NextResponse.json({ members: result }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error('Failed to fetch members', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

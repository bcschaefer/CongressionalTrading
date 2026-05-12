import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
import { prisma } from '@/lib/prisma';

export const revalidate = 300; // cache for 5 minutes

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
        is_active: true,
        annual_disclosures: {
          orderBy: { filing_year: 'asc' },
          select: { filing_year: true, state_district: true },
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

      // State from most recent annual disclosure with a state_district
      const stateDistrict = [...m.annual_disclosures]
        .reverse()
        .find((d) => d.state_district)?.state_district ?? null;
      const state = stateDistrict ? stateDistrict.slice(0, 2) : null;

      const latestNetWorth = (m.net_worth_history as Array<{ net_worth: number | null }>)[0]?.net_worth ?? null;

      return {
        bioguide: m.bioguide,
        full_name: m.full_name,
        party: m.party,
        chamber: m.chamber,
        is_active: m.is_active,
        state,
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

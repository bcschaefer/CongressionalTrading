import { NextResponse } from 'next/server';
export const runtime = 'nodejs';
import { prisma } from '@/lib/prisma';

export const revalidate = 300; // cache for 5 minutes

type MemberSelect = {
  bioguide: string;
  full_name: string;
  party: string | null;
  chamber: string | null;
  is_active: boolean;
  annual_disclosures: Array<{ filing_year: number }>;
};

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
          orderBy: { filing_year: 'desc' },
          take: 1,
          select: { filing_year: true },
        },
      },
    });

    // Return members with placeholder for estimated net worth (will be fetched on-demand on client)
    const membersWithNetWorth = members.map((m: MemberSelect) => ({
      bioguide: m.bioguide,
      full_name: m.full_name,
      party: m.party,
      chamber: m.chamber,
      is_active: m.is_active,
      latestFilingYear: m.annual_disclosures?.[0]?.filing_year ?? null,
    }));

    return NextResponse.json({ members: membersWithNetWorth }, {
      headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=7200' },
    });
  } catch (error) {
    console.error('Failed to fetch members', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

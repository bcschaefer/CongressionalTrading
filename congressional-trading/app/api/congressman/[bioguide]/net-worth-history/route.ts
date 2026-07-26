import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSenateFilingKind } from '@/lib/senate-annual-filing';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ bioguide: string }> }
) {
  const { bioguide } = await params;

  try {
    const rows = await prisma.member_net_worth.findMany({
      where: { bioguide, net_worth: { gt: 0 } },
      orderBy: { year: 'asc' },
      select: { year: true, net_worth: true },
    });

    const history = rows.map((r) => ({ year: r.year, netWorth: r.net_worth }));

    if (history.length === 0) {
      // If this member has disclosures but every single one is a paper (scanned) filing,
      // surface that distinctly from "no data at all" — there's nothing to parse for those.
      const disclosures = await prisma.annual_financial_disclosures.findMany({
        where: { bioguide },
        select: { source_url: true },
      });
      const noElectronicDisclosures =
        disclosures.length > 0 && disclosures.every((d) => getSenateFilingKind(d.source_url) === 'paper');

      return NextResponse.json({ history, noElectronicDisclosures });
    }

    return NextResponse.json({ history });
  } catch (error) {
    console.error('[net-worth-history]', String(error));
    return NextResponse.json({ history: [] });
  }
}

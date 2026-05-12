import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

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
    return NextResponse.json({ history });
  } catch (error) {
    console.error('[net-worth-history]', String(error));
    return NextResponse.json({ history: [] });
  }
}

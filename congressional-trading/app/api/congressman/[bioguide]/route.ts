import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { readLocalCache, writeLocalCache } from '@/lib/local-api-cache';

export const runtime = 'nodejs';

function parseAmountRange(amountRange: string | null): number {
  if (!amountRange) return 0;
  const values = amountRange
    .replace(/[$,]/g, '')
    .split(' - ')
    .map((v) => Number.parseFloat(v.trim()))
    .filter((v) => Number.isFinite(v));
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  return (values[0] + values[1]) / 2;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ bioguide: string }> }
) {
  const { bioguide } = await params;

  try {
    const member = await prisma.members.findUnique({
      where: { bioguide },
    });

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    // Fetch state/district/party from Congress.gov (non-throwing, cached, and gracefully degrading)
    let state: string | null = null;
    let district: string | null = null;
    let party: string | null = member.party;
    let termStart: number | null = null;
    let termEnd: number | null = null;
    type CongressMemberResponse = {
      member?: {
        state?: string;
        district?: number;
        partyHistory?: Array<{
          partyAbbreviation?: string;
          partyName?: string;
          startYear?: number | string;
        }>;
        terms?: Array<{
          stateCode?: string;
          district?: number;
          startYear?: number | string;
          endYear?: number | string;
        }>;
      };
    };

    try {
      const cacheNamespace = 'congress-member-v3';
      const cacheKey = bioguide.toUpperCase();
      let cgData = await readLocalCache<CongressMemberResponse>(cacheNamespace, cacheKey);

      if (!cgData) {
        const apiKey = process.env.CONGRESS_API_KEY;
        if (!apiKey) {
          throw new Error('Missing CONGRESS_API_KEY');
        }

        const cgRes = await fetch(
          `https://api.congress.gov/v3/member/${bioguide}?format=json&api_key=${apiKey}`
        );

        if (cgRes.ok) {
          cgData = (await cgRes.json()) as CongressMemberResponse;
          await writeLocalCache(cacheNamespace, cacheKey, cgData, 86400);
        } else {
          cgData = await readLocalCache<CongressMemberResponse>(cacheNamespace, cacheKey, {
            allowExpired: true,
          });
        }
      }

      if (cgData) {

        const terms = cgData.member?.terms ?? [];
        const primaryTerm = terms[0];
        state = cgData.member?.state ?? primaryTerm?.stateCode ?? null;
        const districtNum = cgData.member?.district ?? primaryTerm?.district;
        if (state && districtNum != null) {
          district = `${state}-${districtNum}`;
        } else if (state) {
          district = state; 
        }

        const partyHistory = cgData.member?.partyHistory ?? [];
        const currentParty = [...partyHistory].sort((a, b) => {
          const yearA = Number(a.startYear ?? 0);
          const yearB = Number(b.startYear ?? 0);
          return yearB - yearA;
        })[0];

        party = currentParty?.partyAbbreviation ?? currentParty?.partyName ?? party;

        if (terms.length > 0) {
          const startYears = terms.map((t) => Number(t.startYear ?? 0)).filter((y) => y > 0);
          const endYears = terms.map((t) => Number(t.endYear ?? 0)).filter((y) => y > 0);
          if (startYears.length > 0) termStart = Math.min(...startYears);
          if (endYears.length > 0) termEnd = Math.max(...endYears);
        }
      }
    } catch {
    }

    const disclosures = await prisma.disclosures.findMany({
      where: { bioguide },
      orderBy: { id: 'desc' },
      include: {
        trades: { orderBy: { id: 'desc' } },
      },
    });

    let annualDisclosures: Array<{
      id: number;
      doc_id: string;
      filing_type: string;
      filing_year: number;
      filing_date: string | null;
    }> = [];

    try {
      annualDisclosures = await prisma.annual_financial_disclosures.findMany({
        where: { bioguide },
        orderBy: [{ filing_year: 'asc' }, { filing_date: 'asc' }],
        select: {
          id: true,
          doc_id: true,
          filing_type: true,
          filing_year: true,
          filing_date: true,
        },
      });
    } catch (error) {
      console.warn('Annual disclosures query skipped:', error);
    }

    const trades = disclosures
      .flatMap<{
        id: number;
        bioguide: string;
        type: string;
        amount: number;
        ticker: string;
        date: string;
        sector: string;
      }>((row: (typeof disclosures)[number]) => {
        if (row.trades.length === 0) {
          return [
            {
              id: row.id,
              bioguide: row.bioguide,
              type: (row.transaction_type ?? 'UNKNOWN').toUpperCase(),
              amount: parseAmountRange(row.amount_range),
              ticker: row.ticker ?? 'N/A',
              date: row.trade_date ?? '',
              sector: row.sector ?? '',
            },
          ];
        }
        return row.trades.map((trade: (typeof row.trades)[number]) => ({
          id: trade.id,
          bioguide: row.bioguide,
          type: (trade.trade_type ?? row.transaction_type ?? 'UNKNOWN').toUpperCase(),
          amount: trade.amount ?? parseAmountRange(row.amount_range),
          ticker: trade.ticker ?? row.ticker ?? 'N/A',
          date: trade.trade_date ?? row.trade_date ?? '',
          sector: row.sector ?? '',
        }));
      })
      .filter((t) => t.ticker !== 'N/A' && t.amount > 0);

    return NextResponse.json({
      member: { ...member, party, state, district, is_active: member.is_active ?? true, termStart, termEnd },
      trades,
      annualDisclosures,
    });
  } catch (error) {
    console.error('Failed to fetch congressman data', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

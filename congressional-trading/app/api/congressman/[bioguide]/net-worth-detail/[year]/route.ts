import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { extractTextFromPdf, parsePdfSummary } from '@/lib/parse-net-worth';

export const runtime = 'nodejs';
export const maxDuration = 30;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ bioguide: string; year: string }> }
) {
  const { bioguide, year: yearStr } = await params;
  const year = Number(yearStr);

  if (!year || isNaN(year)) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 });
  }

  try {
    // Find the disclosure for this bioguide + year
    const disclosures = await prisma.annual_financial_disclosures.findMany({
      where: { bioguide, filing_year: year },
      orderBy: [{ filing_date: 'desc' }],
      take: 1,
      select: { doc_id: true, filing_year: true, source_url: true },
    });

    const disclosure = disclosures[0] ?? null;

    if (!disclosure) {
      return NextResponse.json({ error: 'No disclosure found for that year' }, { status: 404 });
    }

    const sourceIsPdf =
      !!disclosure.source_url &&
      /^https?:\/\//i.test(disclosure.source_url) &&
      /\.pdf(?:\?|#|$)/i.test(disclosure.source_url);

    const pdfUrl = sourceIsPdf
      ? disclosure.source_url!
      : `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${disclosure.filing_year}/${disclosure.doc_id}.pdf`;

    const text = await extractTextFromPdf(pdfUrl);
    const { totalAssets, totalLiabilities } = parsePdfSummary(text);
    const netWorth = totalAssets - totalLiabilities;

    // Write back to DB if we got data
    if (totalAssets > 0 || totalLiabilities > 0) {
      prisma.annual_financial_disclosures
        .update({
          where: { doc_id: disclosure.doc_id },
          data: {
            total_assets: totalAssets,
            total_liabilities: totalLiabilities,
            net_worth: netWorth,
            net_worth_parsed_at: new Date(),
          },
        })
        .catch((e: unknown) => console.error('[net-worth-detail] DB write failed', e));
    }

    return NextResponse.json({ year, totalAssets, totalLiabilities, netWorth });
  } catch (error) {
    console.error('[net-worth-detail]', error);
    return NextResponse.json({ error: 'Failed to parse PDF' }, { status: 500 });
  }
}

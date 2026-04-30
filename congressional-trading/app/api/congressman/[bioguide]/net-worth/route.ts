import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

export const runtime = 'nodejs';

const execFileAsync = promisify(execFile);

export type AssetEntry = {
  name: string;
  typeCode: string;
  owner: string;
  category: string;
  valueLow: number;
  valueHigh: number;
  valueMid: number;
};

export type LiabilityEntry = {
  creditor: string;
  loanType: string;
  owner: string;
  valueLow: number;
  valueHigh: number;
  valueMid: number;
};

const CODE_TO_CATEGORY: Record<string, string> = {
  ST: 'Stocks',
  RE: 'Real Estate',
  BA: 'Cash & Banking',
  BK: 'Cash & Banking',
  CU: 'Cash & Banking',
  WU: 'Insurance',
  WL: 'Insurance',
  WS: 'Insurance',
  PS: 'Business Interests',
  PF: 'Business Interests',
  PT: 'Business Interests',
  FE: 'Bonds',
  FX: 'Bonds',
  BO: 'Bonds',
  RP: 'Retirement',
  MF: 'Mutual Funds',
  EF: 'Mutual Funds',
  OL: 'Other',
};

function tokenizeName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((t) => !['hon', 'mr', 'mrs', 'ms', 'dr', 'rep', 'sen'].includes(t));
}

function extractFirstLast(name: string): { first: string | null; last: string | null } {
  const parts = tokenizeName(name);
  if (parts.length === 0) return { first: null, last: null };
  if (parts.length === 1) return { first: parts[0], last: parts[0] };
  return { first: parts[0], last: parts[parts.length - 1] };
}

function classifyAsset(name: string, typeCode: string): string {
  const fromCode = CODE_TO_CATEGORY[typeCode.toUpperCase()];
  if (fromCode) return fromCode;
  const n = name.toLowerCase();
  if (/401k|403b|\bira\b|thrift savings|pension|retirement/i.test(n)) return 'Retirement';
  if (/life insurance|universal life|whole life/i.test(n)) return 'Insurance';
  if (/real estate|property|\bland\b|realty/i.test(n)) return 'Real Estate';
  if (/savings|checking|bank|credit union/i.test(n)) return 'Cash & Banking';
  return 'Other';
}

function parseFullRange(str: string): { low: number; high: number; mid: number } | null {
  const m = str.match(/\$([\d,]+)\s*-\s*\$([\d,]+)/);
  if (!m) return null;
  const low = Number(m[1].replace(/,/g, ''));
  const high = Number(m[2].replace(/,/g, ''));
  return { low, high, mid: (low + high) / 2 };
}

function parseRangeStart(str: string): number | null {
  // "$250,001 -" at end of string (split range continues on next line)
  const m = str.match(/\$([\d,]+)\s*-\s*$/);
  if (!m) return null;
  return Number(m[1].replace(/,/g, ''));
}

function parseRangeEnd(str: string, low: number): { low: number; high: number; mid: number } | null {
  const m = str.match(/^\$([\d,]+)/);
  if (!m) return null;
  const high = Number(m[1].replace(/,/g, ''));
  return { low, high, mid: (low + high) / 2 };
}

async function extractTextFromPdf(pdfUrl: string): Promise<string> {
  const scriptPath = path.join(process.cwd(), 'scripts', 'extract-pdf-text.js');
  const { stdout } = await execFileAsync(process.execPath, [scriptPath, pdfUrl], {
    maxBuffer: 10 * 1024 * 1024,
  });

  const parsed = JSON.parse(stdout) as { text?: string; error?: string };
  if (parsed.error) {
    throw new Error(parsed.error);
  }
  return parsed.text ?? '';
}

function parsePdfText(text: string): { assets: AssetEntry[]; liabilities: LiabilityEntry[] } {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !/^[\u0000\s]+$/.test(l));

  const assets: AssetEntry[] = [];
  const liabilities: LiabilityEntry[] = [];

  type Sec = 'none' | 'a' | 'd';
  let sec: Sec = 'none';

  let pendingAsset: { name: string; typeCode: string; owner: string } | null = null;
  let pendingLow: number | null = null;

  let pendingLiab: { creditor: string; loanType: string; owner: string } | null = null;
  let pendingLiabLow: number | null = null;

  const emitAsset = (
    name: string,
    typeCode: string,
    owner: string,
    v: { low: number; high: number; mid: number }
  ) => {
    assets.push({
      name,
      typeCode,
      owner,
      category: classifyAsset(name, typeCode),
      valueLow: v.low,
      valueHigh: v.high,
      valueMid: v.mid,
    });
    pendingAsset = null;
    pendingLow = null;
  };

  for (const line of lines) {
    if (line.includes('Value of Asset') && line.includes('Owner')) {
      sec = 'a';
      pendingAsset = null;
      pendingLow = null;
      continue;
    }
    if (line.includes('Creditor') && line.includes('Date Incurred')) {
      sec = 'd';
      pendingLiab = null;
      pendingLiabLow = null;
      continue;
    }
    if (line.startsWith('https://') || line.startsWith('* Asset')) continue;
    if (/^--\s*\d+\s*of\s*\d+\s*--$/.test(line)) continue;

    if (sec === 'a') {
      const typeMatch = line.match(/\[([A-Z]{2,4})\]/);
      if (typeMatch) {
        pendingAsset = null;
        pendingLow = null;

        const typeCode = typeMatch[1];
        const name = line.split('[')[0].replace(/\t/g, ' ').trim();
        const ownerMatch = line.match(/\b(SP|JT|DC)\b/);
        const owner = ownerMatch ? ownerMatch[1] : 'Self';

        const full = parseFullRange(line);
        if (full) {
          emitAsset(name, typeCode, owner, full);
        } else {
          const low = parseRangeStart(line);
          pendingAsset = { name, typeCode, owner };
          if (low !== null) pendingLow = low;
        }
      } else if (pendingAsset) {
        if (pendingLow !== null) {
          const completed = parseRangeEnd(line, pendingLow);
          if (completed) {
            emitAsset(pendingAsset.name, pendingAsset.typeCode, pendingAsset.owner, completed);
          }
        } else {
          const ownerMatch = line.match(/^(SP|JT|DC)\b/);
          if (ownerMatch) pendingAsset.owner = ownerMatch[1];

          const full = parseFullRange(line);
          if (full) {
            emitAsset(pendingAsset.name, pendingAsset.typeCode, pendingAsset.owner, full);
          } else {
            const low = parseRangeStart(line);
            if (low !== null) pendingLow = low;
          }
        }
      }
    }

    if (sec === 'd') {
      if (pendingLiabLow !== null && pendingLiab) {
        const m = line.match(/^\$([\d,]+)/);
        if (m) {
          const high = Number(m[1].replace(/,/g, ''));
          liabilities.push({
            ...pendingLiab,
            valueLow: pendingLiabLow,
            valueHigh: high,
            valueMid: (pendingLiabLow + high) / 2,
          });
          pendingLiab = null;
          pendingLiabLow = null;
          continue;
        }
      }

      const ownerMatch = line.match(/^(JT|SP|DC|Self)\b/);
      if (ownerMatch) {
        const owner = ownerMatch[1];
        const parts = line.split('\t');
        const creditor = (parts[1] ?? '').trim() || 'Unknown';
        const typeStr = (parts[2] ?? '').trim();
        const loanType = typeStr.replace(/^[A-Za-z]+\s+\d{4}\s+/, '').trim() || 'Other';

        const full = parseFullRange(line);
        if (full) {
          liabilities.push({ creditor, loanType, owner, valueLow: full.low, valueHigh: full.high, valueMid: full.mid });
        } else {
          const low = parseRangeStart(line);
          if (low !== null) {
            pendingLiab = { creditor, loanType, owner };
            pendingLiabLow = low;
          }
        }
      }
    }
  }

  return { assets, liabilities };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ bioguide: string }> }
) {
  const { bioguide } = await params;

  try {
    const member = await prisma.members.findUnique({
      where: { bioguide },
      select: { full_name: true },
    });

    if (!member) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 });
    }

    let disclosure = await prisma.annual_financial_disclosures.findFirst({
      where: { bioguide },
      orderBy: [{ filing_year: 'desc' }, { filing_date: 'desc' }, { id: 'desc' }],
      select: { doc_id: true, filing_year: true, filing_date: true },
    });

    if (!disclosure) {
      const { first, last } = extractFirstLast(member.full_name);
      if (first && last) {
        const candidates = await prisma.annual_financial_disclosures.findMany({
          where: {
            AND: [
              { last_name: { equals: last, mode: 'insensitive' } },
              {
                OR: [
                  { first_name: { startsWith: first, mode: 'insensitive' } },
                  {
                    full_name: {
                      contains: `${first} ${last}`,
                      mode: 'insensitive',
                    },
                  },
                ],
              },
            ],
          },
          orderBy: [{ filing_year: 'desc' }, { filing_date: 'desc' }, { id: 'desc' }],
          take: 10,
          select: {
            doc_id: true,
            filing_year: true,
            filing_date: true,
            first_name: true,
            last_name: true,
          },
        });

        const strict = candidates.find(
          (c: (typeof candidates)[number]) =>
            (c.first_name ?? '').toLowerCase().startsWith(first) &&
            (c.last_name ?? '').toLowerCase() === last
        );

        const picked = strict ?? candidates[0];
        if (picked) {
          disclosure = {
            doc_id: picked.doc_id,
            filing_year: picked.filing_year,
            filing_date: picked.filing_date,
          };
        }
      }
    }

    if (!disclosure) {
      return NextResponse.json({
        assets: [],
        liabilities: [],
        stocks: [],
        byCategory: {},
        summary: null,
        filing: null,
      });
    }

    const pdfUrl = `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${disclosure.filing_year}/${disclosure.doc_id}.pdf`;
    const pdfText = await extractTextFromPdf(pdfUrl);
    const { assets, liabilities } = parsePdfText(pdfText);

    const totalAssets = assets.reduce((s, a) => s + a.valueMid, 0);
    const totalLiabilities = liabilities.reduce((s, l) => s + l.valueMid, 0);

    const byCategory: Record<string, { total: number; count: number }> = {};
    for (const asset of assets) {
      if (!byCategory[asset.category]) byCategory[asset.category] = { total: 0, count: 0 };
      byCategory[asset.category].total += asset.valueMid;
      byCategory[asset.category].count += 1;
    }

    const stocks = assets.filter((a) => a.typeCode === 'ST');

    return NextResponse.json({
      filing: disclosure,
      assets,
      liabilities,
      stocks,
      byCategory,
      summary: {
        totalAssets,
        totalLiabilities,
        estimatedNetWorth: totalAssets - totalLiabilities,
      },
    });
  } catch (error) {
    console.error('[net-worth] Failed:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

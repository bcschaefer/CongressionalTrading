/**
 * Shared utilities for fetching and parsing net worth from House financial disclosure PDFs.
 */

type AssetEntry = { valueMid: number };
type LiabilityEntry = { valueMid: number };

function parseFullRange(str: string): { low: number; high: number; mid: number } | null {
  const m = str.match(/\$([\d,]+)\s*-\s*\$([\d,]+)/);
  if (!m) return null;
  const low = Number(m[1].replace(/,/g, ''));
  const high = Number(m[2].replace(/,/g, ''));
  return { low, high, mid: (low + high) / 2 };
}

function parseRangeStart(str: string): number | null {
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

export async function extractTextFromPdf(pdfUrl: string): Promise<string> {
  const response = await fetch(pdfUrl, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`PDF unavailable: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfParseModule: any = await import('pdf-parse/lib/pdf-parse.js');
  const parsePdf = pdfParseModule.default ?? pdfParseModule;
  const result = await parsePdf(buffer);
  return result?.text ?? '';
}

export function parsePdfSummary(text: string): { totalAssets: number; totalLiabilities: number } {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);

  const assets: AssetEntry[] = [];
  const liabilities: LiabilityEntry[] = [];

  type Sec = 'none' | 'a' | 'd';
  let sec: Sec = 'none';
  let pendingAsset: { name: string; typeCode: string } | null = null;
  let pendingLow: number | null = null;
  let pendingLiabLow: number | null = null;

  const emitAsset = (name: string, typeCode: string, v: { low: number; high: number; mid: number }) => {
    void name; void typeCode;
    assets.push({ valueMid: v.mid });
    pendingAsset = null;
    pendingLow = null;
  };

  for (const line of lines) {
    if (line.includes('Value of Asset') && line.includes('Owner')) { sec = 'a'; pendingAsset = null; pendingLow = null; continue; }
    if (line.includes('Creditor') && line.includes('Date Incurred')) { sec = 'd'; pendingLiabLow = null; continue; }
    if (line.startsWith('https://') || line.startsWith('* Asset')) continue;
    if (/^--\s*\d+\s*of\s*\d+\s*--$/.test(line)) continue;

    if (sec === 'a') {
      const typeMatch = line.match(/\[([A-Z]{2,4})\]/);
      if (typeMatch) {
        pendingAsset = null; pendingLow = null;
        const typeCode = typeMatch[1];
        const name = line.split('[')[0].replace(/\t/g, ' ').trim();
        const full = parseFullRange(line);
        if (full) {
          emitAsset(name, typeCode, full);
        } else {
          const low = parseRangeStart(line);
          pendingAsset = { name, typeCode };
          if (low !== null) pendingLow = low;
        }
      } else if (pendingAsset) {
        if (pendingLow !== null) {
          const completed = parseRangeEnd(line, pendingLow);
          if (completed) emitAsset(pendingAsset.name, pendingAsset.typeCode, completed);
        } else {
          const full = parseFullRange(line);
          if (full) {
            emitAsset(pendingAsset.name, pendingAsset.typeCode, full);
          } else {
            const low = parseRangeStart(line);
            if (low !== null) pendingLow = low;
          }
        }
      }
    }

    if (sec === 'd') {
      if (pendingLiabLow !== null) {
        const m = line.match(/^\$([\d,]+)/);
        if (m) {
          const high = Number(m[1].replace(/,/g, ''));
          liabilities.push({ valueMid: (pendingLiabLow + high) / 2 });
          pendingLiabLow = null;
          continue;
        }
      }
      const ownerMatch = line.match(/^(JT|SP|DC|Self)\b/);
      if (ownerMatch) {
        const full = parseFullRange(line);
        if (full) {
          liabilities.push({ valueMid: full.mid });
        } else {
          const low = parseRangeStart(line);
          if (low !== null) pendingLiabLow = low;
        }
      }
    }
  }

  return {
    totalAssets: assets.reduce((s, a) => s + a.valueMid, 0),
    totalLiabilities: liabilities.reduce((s, l) => s + l.valueMid, 0),
  };
}

/**
 * Given a disclosure row, fetch the PDF and parse net worth.
 * Returns null if the PDF is unavailable or yields zero values.
 */
export async function parseNetWorthForDisclosure(disclosure: {
  doc_id: string;
  filing_year: number;
  source_url: string | null;
}): Promise<{ totalAssets: number; totalLiabilities: number; netWorth: number } | null> {
  const sourceIsPdf =
    !!disclosure.source_url &&
    /^https?:\/\//i.test(disclosure.source_url) &&
    /\.pdf(?:\?|#|$)/i.test(disclosure.source_url);

  const pdfUrl = sourceIsPdf
    ? disclosure.source_url!
    : `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${disclosure.filing_year}/${disclosure.doc_id}.pdf`;

  const text = await extractTextFromPdf(pdfUrl);
  const { totalAssets, totalLiabilities } = parsePdfSummary(text);

  if (totalAssets === 0 && totalLiabilities === 0) return null;

  return { totalAssets, totalLiabilities, netWorth: totalAssets - totalLiabilities };
}

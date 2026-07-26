/**
 * Senate annual financial disclosures come in two forms:
 *   - Electronic ("/search/view/annual/{id}/") — a structured HTML report where each
 *     asset/liability row states its value as clean text (e.g. "$100,001 - $250,000").
 *   - Paper ("/search/view/paper/{id}/") — a scanned image with no text layer at all.
 *
 * Paper filings are ignored — there's nothing here to parse without OCR/ML, which we've
 * deliberately decided not to build. This module only handles electronic filings.
 */

export type SenateFilingKind = 'electronic' | 'paper' | null;

export function getSenateFilingKind(url: string | null | undefined): SenateFilingKind {
  if (!url) return null;
  if (/efdsearch\.senate\.gov\/search\/view\/annual\//i.test(url)) return 'electronic';
  if (/efdsearch\.senate\.gov\/search\/view\/paper\//i.test(url)) return 'paper';
  return null;
}

const SENATE_BASE_URL = 'https://efdsearch.senate.gov';
const SEARCH_HOME_URL = `${SENATE_BASE_URL}/search/home/`;

type CookieJar = Record<string, string>;

function extractSetCookies(headers: Headers): string[] {
  if (typeof (headers as { getSetCookie?: () => string[] }).getSetCookie === 'function') {
    return (headers as unknown as { getSetCookie: () => string[] }).getSetCookie();
  }
  const combined = headers.get('set-cookie');
  if (!combined) return [];
  return combined.split(/,(?=\s*[^;,\s]+=)/g).map((s) => s.trim());
}

function mergeCookies(jar: CookieJar, setCookies: string[]) {
  for (const cookieText of setCookies) {
    const pair = cookieText.split(';')[0];
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
}

function cookieHeader(jar: CookieJar): string {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

async function createSenateSession(): Promise<CookieJar> {
  const cookieJar: CookieJar = {};

  const homeRes = await fetch(SEARCH_HOME_URL, { signal: AbortSignal.timeout(15_000) });
  if (!homeRes.ok) throw new Error(`Senate home request failed: ${homeRes.status}`);
  mergeCookies(cookieJar, extractSetCookies(homeRes.headers));

  const homeHtml = await homeRes.text();
  const csrfMatch = homeHtml.match(/name=["']csrfmiddlewaretoken["']\s+value=["']([^"']+)/i);
  const csrfToken = csrfMatch?.[1];
  if (!csrfToken) throw new Error('Unable to parse Senate CSRF token');

  const agreementBody = new URLSearchParams({ prohibition_agreement: '1', csrfmiddlewaretoken: csrfToken });
  // The agreement form's action="" posts back to /search/home/ (not /search/)
  const agreeRes = await fetch(SEARCH_HOME_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(cookieJar),
      referer: SEARCH_HOME_URL,
    },
    body: agreementBody.toString(),
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
  });
  mergeCookies(cookieJar, extractSetCookies(agreeRes.headers));

  return cookieJar;
}

export async function fetchSenateAnnualFilingHtml(viewerUrl: string): Promise<string> {
  const cookieJar = await createSenateSession();
  const res = await fetch(viewerUrl, {
    headers: {
      cookie: cookieHeader(cookieJar),
      referer: `${SENATE_BASE_URL}/search/`,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Senate filing page request failed: ${res.status}`);
  return res.text();
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}

function stripHtml(html: string): string {
  return decodeHtmlEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function extractSection(html: string, sectionTitle: string): string | null {
  const startMatch = html.match(new RegExp(`<h3[^>]*>\\s*${sectionTitle}\\s*</h3>`, 'i'));
  if (!startMatch || startMatch.index === undefined) return null;
  const start = startMatch.index + startMatch[0].length;
  const rest = html.slice(start);
  const nextHeading = rest.match(/<h3[^>]*>\s*Part\s+\d/i);
  const end = nextHeading && nextHeading.index !== undefined ? start + nextHeading.index : html.length;
  return html.slice(start, end);
}

function extractRows(sectionHtml: string): string[][] {
  const rowRegex = /<tr class="nowrap">([\s\S]*?)<\/tr>/g;
  const rows: string[][] = [];
  let rowMatch;
  while ((rowMatch = rowRegex.exec(sectionHtml))) {
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      cells.push(stripHtml(cellMatch[1]));
    }
    rows.push(cells);
  }
  return rows;
}

function firstValueRange(cells: string[]): { low: number; high: number; mid: number; cellIndex: number } | null {
  for (let i = 0; i < cells.length; i++) {
    const m = cells[i].match(/\$([\d,]+)\s*-\s*\$([\d,]+)/);
    if (m) {
      const low = Number(m[1].replace(/,/g, ''));
      const high = Number(m[2].replace(/,/g, ''));
      return { low, high, mid: (low + high) / 2, cellIndex: i };
    }
  }
  return null;
}

function classifyCategory(assetType: string, name: string): string {
  const t = assetType.toLowerCase();
  const n = name.toLowerCase();
  if (/stock|reit\b/.test(t) || /stock/.test(n)) return 'Stocks';
  if (/bond|treasury|note\b/.test(t) || /bond|treasury/.test(n)) return 'Bonds';
  if (/retirement|ira\b|401k|403b|pension|thrift savings/.test(t) || /retirement|ira\b|401k|403b|pension/.test(n)) return 'Retirement';
  if (/annuity|insurance|life\b/.test(t) || /annuity|insurance|whole life|universal life/.test(n)) return 'Insurance';
  if (/bank deposit|cash|checking|savings/.test(t) || /bank|checking|savings|credit union/.test(n)) return 'Cash & Banking';
  if (/real estate|reit\b/.test(t) || /real estate|property|\bland\b|realty/.test(n)) return 'Real Estate';
  if (/business|partnership|llc|trust/.test(t)) return 'Business Interests';
  if (/mutual fund|etf\b/.test(t) || /mutual fund|etf\b/.test(n)) return 'Mutual Funds';
  return 'Other';
}

export type SenateAssetEntry = {
  name: string;
  typeCode: string;
  owner: string;
  category: string;
  valueLow: number;
  valueHigh: number;
  valueMid: number;
};

export type SenateLiabilityEntry = {
  creditor: string;
  loanType: string;
  owner: string;
  valueLow: number;
  valueHigh: number;
  valueMid: number;
};

/**
 * Assets rows: [#, Asset, Asset Type, Owner, Value, Income Type, Income]
 * The Value cell always precedes the also money-shaped Income cell, so scanning
 * left-to-right for the first "$lo - $hi" cell reliably picks Value.
 */
function parseAssetRow(cells: string[]): SenateAssetEntry | null {
  const range = firstValueRange(cells);
  if (!range) return null;
  const name = cells[1] ?? '';
  const typeCode = cells[2] ?? '';
  const owner = cells[3] ?? 'Self';
  return {
    name,
    typeCode,
    owner,
    category: classifyCategory(typeCode, name),
    valueLow: range.low,
    valueHigh: range.high,
    valueMid: range.mid,
  };
}

/**
 * Liabilities rows: [(blank), #, Incurred, Debtor, Type, Points, Rate(Term), Amount, Creditor, Comments]
 * Amount is the only "$lo - $hi"-shaped cell in the row, so the same left-to-right scan works.
 */
function parseLiabilityRow(cells: string[]): SenateLiabilityEntry | null {
  const range = firstValueRange(cells);
  if (!range) return null;
  const creditor = cells[8] ?? cells[cells.length - 2] ?? 'Unknown';
  const loanType = cells[4] ?? 'Other';
  const owner = cells[3] ?? 'Self';
  return {
    creditor,
    loanType,
    owner,
    valueLow: range.low,
    valueHigh: range.high,
    valueMid: range.mid,
  };
}

export function parseSenateAnnualFiling(html: string): {
  assets: SenateAssetEntry[];
  liabilities: SenateLiabilityEntry[];
} {
  const assetsSection = extractSection(html, 'Part\\s+3\\.\\s+Assets');
  const liabilitiesSection = extractSection(html, 'Part\\s+7\\.\\s+Liabilities');

  const assets = assetsSection
    ? extractRows(assetsSection).map(parseAssetRow).filter((a): a is SenateAssetEntry => a !== null)
    : [];
  const liabilities = liabilitiesSection
    ? extractRows(liabilitiesSection).map(parseLiabilityRow).filter((l): l is SenateLiabilityEntry => l !== null)
    : [];

  return { assets, liabilities };
}

#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
require('dotenv/config');

const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
const { Client: PgClient } = require('pg');

const SENATE_BASE_URL = 'https://efdsearch.senate.gov';
const SEARCH_HOME_URL = `${SENATE_BASE_URL}/search/home/`;
const SEARCH_AGREE_URL = `${SENATE_BASE_URL}/search/`;
const SEARCH_REPORT_DATA_URL = `${SENATE_BASE_URL}/search/report/data/`;

const NICKNAME_VARIANTS = {
  william: ['bill', 'will', 'billy'],
  james: ['jim', 'jimmy'],
  robert: ['bob', 'rob', 'bobby'],
  thomas: ['tom', 'tommy'],
  edward: ['ted', 'ed', 'eddie', 'ned'],
  theodore: ['ted'],
  joseph: ['joe', 'joey'],
  donald: ['don', 'donnie'],
  michael: ['mike', 'mick', 'mikey'],
  luis: ['lou'],
  lewis: ['lou'],
  louis: ['lou'],
  john: ['jack', 'jake', 'johnny'],
  jacob: ['jake'],
  randolph: ['randy'],
  randall: ['randy'],
  benjamin: ['ben', 'benny'],
  daniel: ['dan', 'danny'],
  charles: ['chuck', 'charlie'],
  richard: ['dick', 'rick', 'rich', 'ricky'],
  peter: ['pete'],
  anthony: ['tony'],
  gregory: ['greg'],
  steven: ['steve'],
  stephen: ['steve'],
  kenneth: ['ken', 'kenny'],
  francis: ['frank'],
  franklin: ['frank'],
  david: ['dave'],
  christopher: ['chris'],
  christian: ['chris'],
  albert: ['al'],
  alfred: ['al'],
  andrew: ['andy'],
  matthew: ['matt'],
  samuel: ['sam'],
  timothy: ['tim', 'timmie'],
  henry: ['hank'],
  raymond: ['ray'],
  frederick: ['fred'],
  ernest: ['ernie'],
  lawrence: ['larry'],
  nathaniel: ['nate'],
  nicholas: ['nick'],
  phillip: ['phil'],
  philip: ['phil'],
  yevgeny: ['eugene', 'gene'],
};

const NICK_TO_CANONICAL = {};
for (const [canonical, nicks] of Object.entries(NICKNAME_VARIANTS)) {
  for (const nick of nicks) {
    if (!NICK_TO_CANONICAL[nick]) NICK_TO_CANONICAL[nick] = [];
    NICK_TO_CANONICAL[nick].push(canonical);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhitespace(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeName(value) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[.,'`]/g, '')
    .replace(/\b(hon|mr|mrs|ms|dr|jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function toIsoDate(mmddyyyy) {
  const m = String(mmddyyyy ?? '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  const day = Number(m[2]);
  const year = Number(m[3]);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function decodeHtmlEntities(html) {
  return String(html ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(Number(code)));
}

function stripHtml(html) {
  return normalizeWhitespace(decodeHtmlEntities(String(html ?? '').replace(/<[^>]+>/g, ' ')));
}

function extractSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const combined = headers.get('set-cookie');
  if (!combined) return [];
  return combined.split(/,(?=\s*[^;,\s]+=)/g).map((s) => s.trim());
}

function mergeCookies(cookieJar, setCookieHeaders) {
  for (const cookieText of setCookieHeaders) {
    const pair = cookieText.split(';')[0];
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    cookieJar[key] = value;
  }
}

function cookieHeader(cookieJar) {
  return Object.entries(cookieJar)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
}

function parseCsrfToken(html) {
  const m = String(html).match(/name=["']csrfmiddlewaretoken["']\s+value=["']([^"']+)/i);
  return m ? m[1] : null;
}

async function fetchWithRetry(url, options = {}, retries = 4) {
  let lastError = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, options);
      if (res.status >= 500 && attempt < retries) {
        await sleep(600 * (attempt + 1));
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(600 * (attempt + 1));
        continue;
      }
    }
  }

  throw lastError ?? new Error('Request failed without response');
}

async function createSenateSession() {
  const cookieJar = {};

  const homeRes = await fetchWithRetry(SEARCH_HOME_URL, { redirect: 'manual' });
  if (!homeRes.ok) {
    throw new Error(`Senate home request failed: ${homeRes.status}`);
  }
  mergeCookies(cookieJar, extractSetCookies(homeRes.headers));

  const homeHtml = await homeRes.text();
  const csrfToken = parseCsrfToken(homeHtml);
  if (!csrfToken) {
    throw new Error('Unable to parse Senate CSRF token from agreement page');
  }

  const agreementBody = new URLSearchParams({
    prohibition_agreement: '1',
    csrfmiddlewaretoken: csrfToken,
  });

  const agreeRes = await fetchWithRetry(SEARCH_AGREE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookieHeader(cookieJar),
      referer: SEARCH_HOME_URL,
    },
    body: agreementBody.toString(),
    redirect: 'manual',
  });

  mergeCookies(cookieJar, extractSetCookies(agreeRes.headers));

  return {
    csrfToken,
    cookieJar,
  };
}

function parseOfficeTextName(officeText) {
  const office = normalizeWhitespace(officeText);
  const left = office.split('(')[0].trim();
  const m = left.match(/^([^,]+),\s*(.+)$/);
  if (!m) {
    return {
      firstName: null,
      lastName: null,
    };
  }

  const lastName = normalizeWhitespace(m[1]);
  const firstName = normalizeWhitespace(m[2]);
  return { firstName, lastName };
}

function extractReportPathFromHtml(text) {
  const match = String(text).match(/\/search\/view\/(?:ptr|paper|annual|report)\/[^"'<>\s]+\//i);
  return match ? match[0] : null;
}

function normalizeReportKind(pathname) {
  if (!pathname) return 'unknown';
  if (pathname.includes('/view/ptr/')) return 'ptr';
  if (pathname.includes('/view/paper/')) return 'paper';
  if (pathname.includes('/view/annual/')) return 'annual';
  return 'report';
}

function extractReportId(pathname) {
  if (!pathname) return null;
  const m = pathname.match(/\/view\/(?:ptr|paper|annual|report)\/([^/]+)\//i);
  return m ? m[1] : null;
}

function isLikelyAnnualTitle(title) {
  const t = String(title ?? '').toLowerCase();
  return t.includes('annual') || t.includes('periodic report for annual') || t.includes('financial disclosure report');
}

function isLikelyPtrTitle(title) {
  const t = String(title ?? '').toLowerCase();
  return t.includes('periodic transaction report') || t.includes('ptr');
}

function parseReportRow(row) {
  const values = Array.isArray(row)
    ? row
    : row && typeof row === 'object'
      ? Object.values(row)
      : [row];

  const htmlJoined = values.map((v) => String(v ?? '')).join(' ');
  const textJoined = stripHtml(htmlJoined);
  const reportPath = extractReportPathFromHtml(htmlJoined);
  const reportId = extractReportId(reportPath);
  const reportKind = normalizeReportKind(reportPath);

  const dateMatch = textJoined.match(/\b\d{2}\/\d{2}\/\d{4}\b/);
  const filedDateText = dateMatch ? dateMatch[0] : null;
  const filedDateIso = filedDateText ? toIsoDate(filedDateText) : null;

  let reportTitle = null;
  for (const v of values) {
    const txt = stripHtml(v);
    if (!txt) continue;
    if (/periodic|annual|report|financial disclosure/i.test(txt) && txt.length > 8) {
      reportTitle = txt;
      break;
    }
  }
  if (!reportTitle) {
    reportTitle = textJoined;
  }

  let officeText = null;
  for (const v of values) {
    const txt = stripHtml(v);
    if (/\(senator\)|\bsenator\b/i.test(txt) && txt.length > 6) {
      officeText = txt;
      break;
    }
  }

  if (!officeText) {
    const m = textJoined.match(/[A-Za-z .'-]+,\s*[A-Za-z .'-]+\s*\(Senator\)/i);
    officeText = m ? normalizeWhitespace(m[0]) : null;
  }

  const parsedName = parseOfficeTextName(officeText);

  return {
    firstName: parsedName.firstName,
    lastName: parsedName.lastName,
    officeText,
    reportTitle,
    reportPath,
    reportKind,
    reportId,
    filedDateText,
    filedDateIso,
    rawText: textJoined,
  };
}

async function fetchReportDataPage(session, options) {
  const form = new URLSearchParams();
  form.set('draw', String(options.draw ?? 1));
  form.set('start', String(options.start ?? 0));
  form.set('length', String(options.length ?? 100));
  form.set('submitted_start_date', options.startDate);
  form.set('submitted_end_date', options.endDate);
  form.set('first_name', options.firstName ?? '');
  form.set('last_name', options.lastName ?? '');

  if (options.reportTypes) {
    form.set('report_types', JSON.stringify(options.reportTypes));
  } else {
    form.set('report_types', '[]');
  }

  if (options.filerTypes) {
    form.set('filer_types', JSON.stringify(options.filerTypes));
  } else {
    form.set('filer_types', '[4]');
  }

  form.set('office_id_first', '0');
  form.set('csrfmiddlewaretoken', session.csrfToken);

  const res = await fetchWithRetry(SEARCH_REPORT_DATA_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
      cookie: cookieHeader(session.cookieJar),
      referer: SEARCH_AGREE_URL,
      'x-requested-with': 'XMLHttpRequest',
      'x-csrftoken': session.csrfToken,
    },
    body: form.toString(),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Senate report data request failed ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = await res.json();
  return data;
}

async function fetchAllReportRows(session, options) {
  const length = options.pageSize ?? 100;
  let start = options.start ?? 0;
  let draw = options.draw ?? 1;
  let total = null;
  const rows = [];

  while (true) {
    const page = await fetchReportDataPage(session, {
      ...options,
      start,
      draw,
      length,
    });

    const pageRows = Array.isArray(page.data) ? page.data : [];
    rows.push(...pageRows);

    const recordsFiltered = Number(page.recordsFiltered ?? page.recordsTotal ?? 0);
    if (Number.isFinite(recordsFiltered) && recordsFiltered >= 0) {
      total = recordsFiltered;
    }

    start += pageRows.length;
    draw += 1;

    if (pageRows.length === 0) break;
    if (total != null && start >= total) break;
  }

  return rows;
}

function firstNameVariants(token) {
  const out = new Set([token]);
  (NICKNAME_VARIANTS[token] || []).forEach((v) => out.add(v));
  (NICK_TO_CANONICAL[token] || []).forEach((v) => out.add(v));
  return out;
}

function buildMemberIndex(members) {
  return members.map((m) => ({
    bioguide: m.bioguide,
    normalized: normalizeName(m.full_name),
  }));
}

function resolveBioguideForName(firstName, lastName, memberIndex) {
  const firstNorm = normalizeName(firstName);
  const lastNorm = normalizeName(lastName);
  const fullNorm = normalizeName(`${firstName ?? ''} ${lastName ?? ''}`);

  if (!firstNorm || !lastNorm) return null;

  const exact = memberIndex.find((m) => m.normalized === fullNorm);
  if (exact) return exact.bioguide;

  const lastFiltered = memberIndex.filter((m) => m.normalized.split(' ').includes(lastNorm));
  if (lastFiltered.length === 0) return null;

  const firstToken = firstNorm.split(' ').filter(Boolean)[0] || '';
  const tokenMatch = lastFiltered.find((m) => m.normalized.split(' ').includes(firstToken));
  if (tokenMatch) return tokenMatch.bioguide;

  const tokens = firstNorm.split(' ').filter((t) => t.length >= 2);
  const variants = new Set();
  for (const t of tokens) {
    for (const v of firstNameVariants(t)) variants.add(v);
  }

  const variantMatch = lastFiltered.find((m) => {
    const memberTokens = m.normalized.split(' ');
    for (const v of variants) {
      if (memberTokens.includes(v)) return true;
    }
    return false;
  });
  if (variantMatch) return variantMatch.bioguide;

  if (lastFiltered.length === 1) return lastFiltered[0].bioguide;
  return null;
}

function parseMoney(value) {
  const n = Number(String(value ?? '').replace(/[$,]/g, '').trim());
  return Number.isFinite(n) ? n : null;
}

function parseAmountRange(value) {
  const text = String(value ?? '');
  const m = text.match(/\$([\d,]+)\s*-\s*\$([\d,]+)/);
  if (m) {
    const low = parseMoney(m[1]);
    const high = parseMoney(m[2]);
    if (low != null && high != null) {
      return {
        amount: (low + high) / 2,
        rangeText: `$${low.toLocaleString()} - $${high.toLocaleString()}`,
      };
    }
  }

  const single = text.match(/\$([\d,]+)/);
  if (single) {
    const num = parseMoney(single[1]);
    if (num != null) {
      return {
        amount: num,
        rangeText: `$${num.toLocaleString()} - $${num.toLocaleString()}`,
      };
    }
  }

  return null;
}

function extractTicker(rowText) {
  const inParens = rowText.match(/\(([A-Z][A-Z0-9.-]{0,9})\)/);
  if (inParens) return inParens[1];

  const fromSymbol = rowText.match(/\b([A-Z]{1,5})(?:\s+common stock|\s+inc\.?|\s+corp\.?|\s+etf)?\b/);
  if (fromSymbol) return fromSymbol[1];

  return null;
}

function extractTradeType(rowText) {
  const t = rowText.toLowerCase();
  if (/\b(purchase|buy|acquisition|received)\b/.test(t)) return 'P';
  if (/\b(sale|sell|sold|divest)\b/.test(t)) return 'S';
  if (/\b(exchange)\b/.test(t)) return 'X';
  return null;
}

function extractTransactionsFromReportHtml(html) {
  const content = String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ');

  const trades = [];
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch = rowRegex.exec(content);

  while (rowMatch) {
    const rowHtml = rowMatch[1];
    const cells = [];

    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch = cellRegex.exec(rowHtml);
    while (cellMatch) {
      cells.push(stripHtml(cellMatch[1]));
      cellMatch = cellRegex.exec(rowHtml);
    }

    const rowText = normalizeWhitespace(cells.join(' '));
    if (rowText.length > 0) {
      const type = extractTradeType(rowText);
      const dateMatch = rowText.match(/\b\d{2}\/\d{2}\/\d{4}\b/);
      const dateIso = dateMatch ? toIsoDate(dateMatch[0]) : null;
      const amount = parseAmountRange(rowText);

      if (type && dateIso && amount) {
        trades.push({
          ticker: extractTicker(rowText),
          tradeType: type,
          tradeDate: dateIso,
          amount: amount.amount,
          amountRangeText: amount.rangeText,
        });
      }
    }

    rowMatch = rowRegex.exec(content);
  }

  return trades;
}

function getPostgresUrl() {
  const direct =
    process.env.TRADING_STORAGE_POSTGRES_URL ||
    process.env.TRADING_STORAGE_PRISMA_DATABASE_URL ||
    process.env.POSTGRES_URL;

  if (direct && direct.startsWith('postgres')) return direct;

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.startsWith('postgres')) return dbUrl;

  throw new Error('Missing direct Postgres URL. Set TRADING_STORAGE_POSTGRES_URL (or POSTGRES_URL).');
}

async function createPrismaClient() {
  const pgClient = new PgClient({ connectionString: getPostgresUrl() });
  const adapter = new PrismaPg(pgClient);
  const prisma = new PrismaClient({ adapter });
  await prisma.$connect();
  return prisma;
}

module.exports = {
  SENATE_BASE_URL,
  SEARCH_HOME_URL,
  SEARCH_AGREE_URL,
  normalizeWhitespace,
  normalizeName,
  toIsoDate,
  stripHtml,
  isLikelyAnnualTitle,
  isLikelyPtrTitle,
  parseReportRow,
  createSenateSession,
  fetchAllReportRows,
  buildMemberIndex,
  resolveBioguideForName,
  extractTransactionsFromReportHtml,
  createPrismaClient,
};

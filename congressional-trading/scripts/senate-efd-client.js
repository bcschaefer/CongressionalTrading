/* eslint-disable @typescript-eslint/no-require-imports */

const BASE_URL = 'https://efdsearch.senate.gov';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return [408, 425, 429, 500, 502, 503, 504].includes(status);
}

function isRetryableFetchError(error) {
  const msg = String(error?.message ?? '').toUpperCase();
  const code = String(error?.code ?? error?.cause?.code ?? '').toUpperCase();

  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'EAI_AGAIN') return true;
  if (msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT')) return true;
  if (msg.includes('FETCH FAILED') || msg.includes('NETWORK')) return true;
  return false;
}

function normalizeWhitespace(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripTags(html) {
  return normalizeWhitespace(String(html ?? '').replace(/<[^>]*>/g, ' '));
}

function decodeHtmlEntities(text) {
  return String(text ?? '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x2F;/g, '/');
}

function mmddyyyyToIso(mmddyyyy) {
  const parts = String(mmddyyyy ?? '')
    .split('/')
    .map((v) => Number(v));
  if (parts.length !== 3) return null;
  const [mm, dd, yyyy] = parts;
  if (!Number.isInteger(mm) || !Number.isInteger(dd) || !Number.isInteger(yyyy)) return null;
  const date = new Date(Date.UTC(yyyy, mm - 1, dd));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function getSetCookieValues(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const raw = headers.get('set-cookie');
  if (!raw) return [];

  // Fallback parser for environments without getSetCookie().
  // Extract only cookie-pairs (`name=value`) from a potentially combined header.
  const cookiePairs = [];
  const re = /(?:^|,\s*)([!#$%&'*+.^_`|~0-9A-Za-z-]+)=([^;,\r\n]*)/g;
  let m = re.exec(raw);
  while (m) {
    cookiePairs.push(`${m[1]}=${m[2]}`);
    m = re.exec(raw);
  }
  return cookiePairs;
}

class SenateEfdClient {
  constructor() {
    this.cookies = new Map();
    this.csrfToken = '';
  }

  cookieHeader() {
    return [...this.cookies.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  storeCookies(headers) {
    const setCookies = getSetCookieValues(headers);
    for (const raw of setCookies) {
      const first = String(raw).split(';')[0];
      const idx = first.indexOf('=');
      if (idx <= 0) continue;
      const name = first.slice(0, idx).trim();
      const value = first.slice(idx + 1).trim();
      if (!name) continue;
      this.cookies.set(name, value);
    }
  }

  async request(path, options = {}) {
    const maxAttempts = Number(options.maxAttempts ?? 5);
    const baseDelayMs = Number(options.baseDelayMs ?? 500);

    let url = String(path).startsWith('http') ? String(path) : `${BASE_URL}${path}`;
    const method = options.method ?? 'GET';
    const maxRedirects = 5;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        let currentUrl = url;

        for (let i = 0; i <= maxRedirects; i += 1) {
          const headers = new Headers(options.headers ?? {});
          const cookie = this.cookieHeader();
          if (cookie) headers.set('Cookie', cookie);

          const res = await fetch(currentUrl, {
            method,
            headers,
            body: options.body,
            redirect: 'manual',
          });

          this.storeCookies(res.headers);

          const isRedirect = [301, 302, 303, 307, 308].includes(res.status);
          if (!isRedirect) {
            if (isRetryableStatus(res.status) && attempt < maxAttempts) {
              const waitMs = baseDelayMs * attempt;
              await sleep(waitMs);
              break;
            }
            return res;
          }

          const location = res.headers.get('location');
          if (!location) return res;

          currentUrl = new URL(location, currentUrl).toString();
        }
      } catch (error) {
        if (!isRetryableFetchError(error) || attempt >= maxAttempts) {
          throw error;
        }

        const waitMs = baseDelayMs * attempt;
        await sleep(waitMs);
      }
    }

    throw new Error(`Request failed after ${maxAttempts} attempts: ${path}`);
  }

  extractCsrfTokenFromHtml(html) {
    const m = String(html).match(/name="csrfmiddlewaretoken"\s+value="([^"]+)"/i);
    if (m) return m[1];
    return this.cookies.get('csrftoken') ?? '';
  }

  async authenticate() {
    const homeRes = await this.request('/search/home/');
    if (!homeRes.ok) {
      throw new Error(`Failed to load Senate eFD home page: ${homeRes.status}`);
    }

    const homeHtml = await homeRes.text();
    const token = this.extractCsrfTokenFromHtml(homeHtml);
    if (!token) {
      throw new Error('Failed to acquire CSRF token from Senate eFD home page.');
    }

    const body = new URLSearchParams({
      csrfmiddlewaretoken: token,
      prohibition_agreement: '1',
    }).toString();

    const agreeRes = await this.request('/search/home/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: `${BASE_URL}/search/home/`,
        'X-CSRFToken': token,
      },
      body,
    });

    if (!agreeRes.ok) {
      throw new Error(`Failed to submit Senate eFD agreement: ${agreeRes.status}`);
    }

    const searchRes = await this.request('/search/');
    if (!searchRes.ok) {
      throw new Error(`Failed to load Senate eFD search page: ${searchRes.status}`);
    }

    const searchHtml = await searchRes.text();
    const searchToken = this.extractCsrfTokenFromHtml(searchHtml);
    if (!searchToken) {
      throw new Error('Failed to acquire CSRF token from Senate eFD search page.');
    }

    this.csrfToken = searchToken;
  }

  buildDataTableBody({
    draw,
    start,
    length,
    filerTypes,
    reportTypes,
    submittedStart,
    submittedEnd,
    firstName = '',
    lastName = '',
    senatorState = '',
    candidateState = '',
  }) {
    const params = new URLSearchParams();

    // DataTables column metadata expected by backend.
    for (let i = 0; i < 5; i += 1) {
      params.set(`columns[${i}][data]`, String(i));
      params.set(`columns[${i}][name]`, '');
      params.set(`columns[${i}][searchable]`, 'true');
      params.set(`columns[${i}][orderable]`, 'true');
      params.set(`columns[${i}][search][value]`, '');
      params.set(`columns[${i}][search][regex]`, 'false');
    }

    params.set('order[0][column]', '4');
    params.set('order[0][dir]', 'desc');
    params.set('start', String(start));
    params.set('length', String(length));
    params.set('draw', String(draw));
    params.set('search[value]', '');
    params.set('search[regex]', 'false');

    params.set('report_types', JSON.stringify(reportTypes));
    params.set('filer_types', JSON.stringify(filerTypes));
    params.set('submitted_start_date', `${submittedStart} 00:00:00`);
    params.set('submitted_end_date', `${submittedEnd} 23:59:59`);
    params.set('candidate_state', candidateState);
    params.set('senator_state', senatorState);
    params.set('office_id', '');
    params.set('first_name', firstName);
    params.set('last_name', lastName);

    return params.toString();
  }

  async fetchReportPage({
    draw,
    start,
    length,
    filerTypes,
    reportTypes,
    submittedStart,
    submittedEnd,
    firstName,
    lastName,
    senatorState,
    candidateState,
  }) {
    const body = this.buildDataTableBody({
      draw,
      start,
      length,
      filerTypes,
      reportTypes,
      submittedStart,
      submittedEnd,
      firstName,
      lastName,
      senatorState,
      candidateState,
    });

    const res = await this.request('/search/report/data/', {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/javascript, */*; q=0.01',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Referer: `${BASE_URL}/search/`,
        'X-CSRFToken': this.csrfToken,
        'X-Requested-With': 'XMLHttpRequest',
      },
      body,
    });

    if (!res.ok) {
      throw new Error(`Senate report data query failed: ${res.status}`);
    }

    return res.json();
  }

  async fetchReportHtml(reportPath) {
    const res = await this.request(reportPath);
    if (!res.ok) {
      throw new Error(`Failed to fetch report page ${reportPath}: ${res.status}`);
    }
    return res.text();
  }
}

function parseReportRow(row) {
  const firstName = stripTags(row?.[0] ?? '');
  const lastName = stripTags(row?.[1] ?? '');
  const officeText = stripTags(row?.[2] ?? '');
  const reportHtml = String(row?.[3] ?? '');
  const filedDateText = stripTags(row?.[4] ?? '');
  const reportTitle = stripTags(reportHtml);

  const hrefMatch = reportHtml.match(/href="([^"]+)"/i);
  const href = hrefMatch ? decodeHtmlEntities(hrefMatch[1]) : null;

  let reportKind = null;
  let reportId = null;
  if (href) {
    const ptrMatch = href.match(/\/search\/view\/ptr\/([^/]+)\//i);
    const paperMatch = href.match(/\/search\/view\/paper\/([^/]+)\//i);
    if (ptrMatch) {
      reportKind = 'ptr';
      reportId = ptrMatch[1];
    } else if (paperMatch) {
      reportKind = 'paper';
      reportId = paperMatch[1];
    }
  }

  return {
    firstName,
    lastName,
    officeText,
    reportTitle,
    reportPath: href,
    reportKind,
    reportId,
    filedDateText,
    filedDateIso: mmddyyyyToIso(filedDateText),
  };
}

module.exports = {
  SenateEfdClient,
  mmddyyyyToIso,
  normalizeWhitespace,
  stripTags,
  parseReportRow,
};

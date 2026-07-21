/**
 * Senate annual financial disclosures are filed as scanned paper documents, not
 * text PDFs — there's nothing for a PDF-text parser to read. This fetches the
 * page images from the Senate's own filing viewer so they can be shown as-is.
 */

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

export function isSenateViewerUrl(url: string | null | undefined): boolean {
  return !!url && /efdsearch\.senate\.gov\/search\/view\//i.test(url);
}

/** Returns the ordered list of page-image URLs for a Senate paper filing. */
export async function fetchSenateFilingImages(viewerUrl: string): Promise<string[]> {
  const cookieJar = await createSenateSession();

  const res = await fetch(viewerUrl, {
    headers: {
      cookie: cookieHeader(cookieJar),
      referer: `${SENATE_BASE_URL}/search/`,
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Senate filing page request failed: ${res.status}`);

  const html = await res.text();
  const matches = [...html.matchAll(/src="(https:\/\/efd-media-public\.senate\.gov\/[^"]+)"/g)];
  return matches.map((m) => m[1]);
}

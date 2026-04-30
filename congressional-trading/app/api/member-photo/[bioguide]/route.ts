import { NextResponse } from 'next/server';

const cacheHeaders = {
  'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=604800',
};

async function fetchImage(url: string): Promise<Response | null> {
  try {
    const response = await fetch(url, { next: { revalidate: 86400 } });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? '';
    if (!contentType.startsWith('image/')) return null;
    return response;
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ bioguide: string }> }
) {
  const { bioguide } = await params;
  const normalized = bioguide.trim().toUpperCase();

  if (!normalized) {
    return new NextResponse('Missing bioguide', { status: 400 });
  }

  const firstLetter = normalized[0];

  const urls = [
    `https://clerk.house.gov/content/assets/img/members/${normalized}.jpg`,
    `https://bioguide.congress.gov/bioguide/photo/${firstLetter}/${normalized}.jpg`,
    `https://bioguide.congress.gov/photo/${normalized}.jpg`,
  ];

  for (const url of urls) {
    const response = await fetchImage(url);
    if (response) {
      const bytes = await response.arrayBuffer();
      return new NextResponse(bytes, {
        status: 200,
        headers: {
          ...cacheHeaders,
          'Content-Type': response.headers.get('content-type') ?? 'image/jpeg',
        },
      });
    }
  }

  return new NextResponse('Photo not found', { status: 404, headers: cacheHeaders });
}

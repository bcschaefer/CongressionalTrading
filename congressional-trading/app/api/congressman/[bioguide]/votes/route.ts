import { NextResponse } from 'next/server';
import { readLocalCache, writeLocalCache } from '@/lib/local-api-cache';
import { prisma } from '@/lib/prisma';

export const runtime = 'nodejs';

type GovTrackVoteVoter = {
  created: string;
  option: { key: string; value: string };
  vote: {
    created: string;
    question: string;
    question_details: string;
    chamber: string;
    result: string;
    category_label: string;
    related_bill?: number | null;
  };
};

type VoteRecord = {
  date: string;
  question: string;
  description: string;
  memberVoted: string;
  result: string;
  chamber: string;
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ bioguide: string }> }
) {
  const { bioguide } = await params;
  const cacheKey = bioguide.toUpperCase();

  const cached = await readLocalCache<{ votes: VoteRecord[] }>('member-votes-v2', cacheKey);
  if (cached) {
    return NextResponse.json(cached);
  }

  try {
    // Look up member's last name from DB to use as GovTrack search query
    const member = await prisma.members.findUnique({
      where: { bioguide },
      select: { full_name: true },
    });

    if (!member) {
      return NextResponse.json({ votes: [] });
    }

    // Extract last name: "Nancy Pelosi" → "Pelosi"
    const lastName = member.full_name.trim().split(/\s+/).pop() ?? member.full_name.trim();

    // Step 1: Search GovTrack by last name, find the record with matching bioguideid
    const personRes = await fetch(
      `https://www.govtrack.us/api/v2/person?q=${encodeURIComponent(lastName)}&limit=20`,
      { signal: AbortSignal.timeout(10_000) }
    );

    if (!personRes.ok) {
      return NextResponse.json({ votes: [] });
    }

    const personData = await personRes.json();
    const match = (personData.objects ?? []).find(
      (p: { bioguideid: string; link: string }) => p.bioguideid === bioguide
    );

    // ID is the last path segment of the link URL e.g. ".../nancy_pelosi/400314"
    const personId: number | undefined = match
      ? Number(match.link.replace(/\/$/, '').split('/').pop())
      : undefined;

    if (!personId) {
      // No GovTrack record for this member — cache to avoid repeated lookups
      await writeLocalCache('member-votes-v2', cacheKey, { votes: [] }, 24 * 3_600);
      return NextResponse.json({ votes: [] });
    }

    // Step 2: Fetch recent votes for that person
    const votesRes = await fetch(
      `https://www.govtrack.us/api/v2/vote_voter?person=${personId}&limit=150&sort=-id`,
      { signal: AbortSignal.timeout(15_000) }
    );

    if (!votesRes.ok) {
      return NextResponse.json({ votes: [] });
    }

    const votesData = await votesRes.json();
    const rawVotes: GovTrackVoteVoter[] = votesData.objects ?? [];

    const votes: VoteRecord[] = rawVotes.map((v) => ({
      date: v.created,
      question: v.vote.question,
      description: v.vote.question_details,
      memberVoted: v.option.value,
      result: v.vote.result,
      chamber: v.vote.chamber,
    }));

    const result = { votes };
    await writeLocalCache('member-votes-v2', cacheKey, result, 12 * 3_600);
    return NextResponse.json(result);
  } catch (err) {
    console.error('[votes]', err);
    return NextResponse.json({ votes: [] });
  }
}


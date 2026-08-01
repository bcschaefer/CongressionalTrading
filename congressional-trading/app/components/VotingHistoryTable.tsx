'use client';

export type VoteRecord = {
  date: string;
  question: string;
  description: string;
  memberVoted: string;
  result: string;
  chamber: string;
};

function normalizeVote(raw: string): { label: string; textVar: string; bgVar: string } {
  const v = raw?.toLowerCase().trim();
  if (v === 'yea' || v === 'aye' || v === 'yes') {
    return { label: 'Yes', textVar: '--color-positive', bgVar: '--color-positive-bg' };
  }
  if (v === 'nay' || v === 'no') {
    return { label: 'No', textVar: '--color-negative', bgVar: '--color-negative-bg' };
  }
  return { label: 'Abstained', textVar: '--color-text-muted', bgVar: '--color-bg-subtle' };
}

type Props = {
  votes: VoteRecord[];
  isLoading: boolean;
  error: string | null;
};

export default function VotingHistoryTable({ votes, isLoading, error }: Props) {
  return (
    <div className="overflow-hidden rounded-md border border-(--color-border) bg-white">
      <div className="px-6 pb-2 pt-6">
        <h2 className="mb-1 text-lg font-bold text-(--color-text-primary)">Voting History</h2>
        <p className="mb-4 text-[13px] text-(--color-text-muted)">Recent votes cast in Congress</p>
      </div>

      {isLoading ? (
        <div className="p-12 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-[3px] border-(--color-border) border-t-(--color-accent)" />
          <p className="mt-3 text-[13px] text-(--color-text-muted)">Loading votes…</p>
        </div>
      ) : error && votes.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-sm text-(--color-text-muted)">{error}</p>
        </div>
      ) : votes.length === 0 ? (
        <div className="p-12 text-center">
          <p className="text-sm text-(--color-text-muted)">No voting records found.</p>
        </div>
      ) : (
        <div className="max-h-[520px] overflow-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead className="sticky top-0 z-[1] bg-(--color-bg-subtle)">
              <tr className="border-b border-(--color-border)">
                <th className="whitespace-nowrap px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Date</th>
                <th className="px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Bill / Question</th>
                <th className="whitespace-nowrap px-4 py-2.5 text-right text-[11px] font-semibold uppercase tracking-wide text-(--color-text-muted)">Vote</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-border)">
              {votes.map((v, i) => {
                const { label, textVar, bgVar } = normalizeVote(v.memberVoted);
                const dateStr = v.date
                  ? new Date(v.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : '—';
                return (
                  <tr key={`${v.date}-${i}`} className="transition-colors duration-150 hover:bg-(--color-bg-subtle)">
                    <td className="whitespace-nowrap px-4 py-2.5 align-top text-(--color-text-secondary)">{dateStr}</td>
                    <td className="max-w-[520px] px-4 py-2.5 align-top leading-normal text-(--color-text-primary)">
                      <div className="mb-0.5 line-clamp-2 font-semibold">{v.question}</div>
                      <div className="text-[11px] text-(--color-text-muted)">{v.description}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right align-top">
                      <span
                        className="inline-block whitespace-nowrap rounded-sm px-2.5 py-0.5 text-xs font-bold"
                        style={{ background: `var(${bgVar})`, color: `var(${textVar})` }}
                      >
                        {label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

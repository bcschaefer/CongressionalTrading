import type { CongressmanGroup } from '@/lib/home-trades';
import { formatDate, formatMoney, getPublishDelayLabel, getTradeCountLabel } from '@/lib/home-trades';
import { partyTokens } from '@/lib/party';

// Table recipe used across the app's dense tables: real <table> markup, a container
// with `rounded-md border border-(--color-border)` (no shadow), header row
// `bg-(--color-bg-subtle)` with muted uppercase text (left-aligned for text columns,
// right-aligned for numeric — never centered), body `divide-y divide-(--color-border)`
// only (no zebra striping).

type ProlificTradersTableProps = {
  groups: CongressmanGroup[];
  isLoading: boolean;
  selectedBioguide: string | null;
  onHoverRow: (bioguide: string) => void;
  onPrefetchMember: (bioguide: string) => void;
  onOpenMember: (bioguide: string) => void;
};

function chamberLabel(chamber: string | null): string {
  return (chamber ?? '').toLowerCase() === 'senate' ? 'Senate' : 'House';
}

export default function ProlificTradersTable({
  groups,
  isLoading,
  selectedBioguide,
  onHoverRow,
  onPrefetchMember,
  onOpenMember,
}: ProlificTradersTableProps) {
  if (isLoading) {
    return (
      <div className="flex min-h-96 items-center justify-center rounded-md border border-(--color-border) bg-white">
        <div className="text-center">
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-(--color-border) border-t-(--color-accent)" />
          <p className="mt-4 text-sm font-semibold text-(--color-text-secondary)">Loading recent congressional trades...</p>
        </div>
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <div className="flex min-h-96 items-center justify-center rounded-md border border-(--color-border) bg-white">
        <p className="px-6 text-center text-sm font-semibold text-(--color-text-secondary)">No trade data found for the current dataset.</p>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto rounded-md border border-(--color-border) bg-white" style={{ maxHeight: '760px' }}>
      <div className="divide-y divide-(--color-border) md:hidden">
        {groups.map((group, index) => (
          <button
            key={group.bioguide}
            className={`w-full cursor-pointer text-left px-4 py-3 transition-colors ${selectedBioguide === group.bioguide ? 'bg-(--color-bg-subtle)' : 'bg-white'} hover:bg-(--color-bg-subtle)`}
            onMouseEnter={() => {
              onHoverRow(group.bioguide);
              onPrefetchMember(group.bioguide);
            }}
            onFocus={() => {
              onHoverRow(group.bioguide);
              onPrefetchMember(group.bioguide);
            }}
            onClick={() => onOpenMember(group.bioguide)}
            type="button"
          >
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-(--color-text-muted)">#{index + 1}</span>
              <span className="text-sm font-semibold" style={{ color: `var(${partyTokens(group.party).text})` }}>
                {group.congressman}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-(--color-text-secondary)">
              <span>{chamberLabel(group.chamber)}</span>
              <span>Traded {formatDate(group.trades[0]?.date ?? group.latestDate)}</span>
              <span>
                Published{' '}
                {group.trades[0]?.datePublished ? (
                  <>
                    {formatDate(group.trades[0].datePublished)}
                    {(() => {
                      const delay = getPublishDelayLabel(group.trades[0].date, group.trades[0].datePublished);
                      return delay ? ` (${delay})` : '';
                    })()}
                  </>
                ) : (
                  '—'
                )}
              </span>
              <span>{getTradeCountLabel(group.trades.length)}</span>
              <span className="font-semibold text-foreground">{formatMoney(group.totalAmount)}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full table-fixed border-collapse">
          <thead className="sticky top-0 bg-(--color-bg-subtle)">
            <tr className="border-b border-(--color-border)">
              <th className="w-[5%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">#</th>
              <th className="w-[22%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">Congressman</th>
              <th className="w-[13%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">Chamber</th>
              <th className="w-[13%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">Date Traded</th>
              <th className="w-[16%] px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">Date Published</th>
              <th className="w-[11%] px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">Trades</th>
              <th className="w-[20%] px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-(--color-text-muted)">Total Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-(--color-border)">
            {groups.map((group, index) => (
              <tr
                key={group.bioguide}
                className={`cursor-pointer transition-colors duration-150 ${selectedBioguide === group.bioguide ? 'bg-(--color-bg-subtle)' : 'bg-white'} hover:bg-(--color-bg-subtle)`}
                onMouseEnter={() => {
                  onHoverRow(group.bioguide);
                  onPrefetchMember(group.bioguide);
                }}
                onFocus={() => {
                  onHoverRow(group.bioguide);
                  onPrefetchMember(group.bioguide);
                }}
                onClick={() => onOpenMember(group.bioguide)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onOpenMember(group.bioguide);
                  }
                }}
                tabIndex={0}
                role="link"
              >
                <td className="px-3 py-3 text-sm text-(--color-text-muted)">#{index + 1}</td>
                <td className="px-3 py-3 text-sm font-medium">
                  <span className="font-semibold" style={{ color: `var(${partyTokens(group.party).text})` }}>
                    {group.congressman}
                  </span>
                </td>
                <td className="px-3 py-3 text-sm text-(--color-text-secondary)">{chamberLabel(group.chamber)}</td>
                <td className="px-3 py-3 text-sm text-(--color-text-secondary)">
                  {formatDate(group.trades[0]?.date ?? group.latestDate)}
                </td>
                <td className="px-3 py-3 text-sm text-(--color-text-secondary)">
                  {group.trades[0]?.datePublished ? (
                    <>
                      {formatDate(group.trades[0].datePublished)}
                      {(() => {
                        const delay = getPublishDelayLabel(group.trades[0].date, group.trades[0].datePublished);
                        return delay ? (
                          <span className="ml-1 font-semibold text-(--color-text-muted)">({delay})</span>
                        ) : null;
                      })()}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="px-3 py-3 text-right text-sm text-(--color-text-secondary)">{getTradeCountLabel(group.trades.length)}</td>
                <td className="px-3 py-3 text-right text-sm font-semibold text-foreground">{formatMoney(group.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

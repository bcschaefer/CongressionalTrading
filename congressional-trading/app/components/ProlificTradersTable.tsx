import type { CongressmanGroup } from '@/lib/home-trades';
import { formatDate, formatMoney, getTradeCountLabel } from '@/lib/home-trades';

type ProlificTradersTableProps = {
  groups: CongressmanGroup[];
  selectedBioguide: string | null;
  onHoverRow: (bioguide: string) => void;
  onOpenMember: (bioguide: string) => void;
};

export default function ProlificTradersTable({
  groups,
  selectedBioguide,
  onHoverRow,
  onOpenMember,
}: ProlificTradersTableProps) {
  return (
    <div className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden" style={{ maxHeight: '928px', overflowY: 'auto' }}>
      <div className="divide-y divide-gray-200 md:hidden">
        {groups.map((group, index) => (
          <button
            key={group.bioguide}
            className={`w-full text-left px-4 py-3 transition-colors ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${selectedBioguide === group.bioguide ? 'bg-blue-100' : ''} hover:bg-blue-50`}
            onMouseEnter={() => onHoverRow(group.bioguide)}
            onFocus={() => onHoverRow(group.bioguide)}
            onClick={() => onOpenMember(group.bioguide)}
            type="button"
          >
            <div className="text-sm font-semibold text-blue-700">{group.congressman}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
              <span>{formatDate(group.latestDate)}</span>
              <span>{getTradeCountLabel(group.trades.length)}</span>
              <span className="font-semibold text-gray-700">{formatMoney(group.totalAmount)}</span>
            </div>
          </button>
        ))}
      </div>

      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-170">
          <thead className="bg-linear-to-r from-gray-100 to-gray-200">
            <tr>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider sm:px-6 sm:py-4">Congressman</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider sm:px-6 sm:py-4">Recent Date</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider sm:px-6 sm:py-4">Trades</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider sm:px-6 sm:py-4">Total Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {groups.map((group, index) => (
              <tr
                key={group.bioguide}
                className={`cursor-pointer transition-all duration-200 ${index % 2 === 0 ? 'bg-white' : 'bg-gray-50'} ${selectedBioguide === group.bioguide ? 'bg-blue-100' : ''} hover:bg-blue-50 hover:shadow-md`}
                onMouseEnter={() => onHoverRow(group.bioguide)}
                onFocus={() => onHoverRow(group.bioguide)}
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
                <td className="px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-center sm:px-6 sm:py-6">
                  <span className="font-semibold text-blue-700">{group.congressman}</span>
                </td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 text-center sm:px-6 sm:py-6">{formatDate(group.latestDate)}</td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 text-center sm:px-6 sm:py-6">{getTradeCountLabel(group.trades.length)}</td>
                <td className="px-4 py-4 whitespace-nowrap text-sm text-gray-500 text-center font-semibold sm:px-6 sm:py-6">{formatMoney(group.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

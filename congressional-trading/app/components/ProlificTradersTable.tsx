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
    <div className="bg-white rounded-xl shadow-xl border border-gray-200" style={{ maxHeight: '928px', overflowY: 'auto' }}>
      <table className="w-full">
        <thead className="bg-linear-to-r from-gray-100 to-gray-200">
          <tr>
            <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Congressman</th>
            <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Recent Date</th>
            <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Trades</th>
            <th className="px-6 py-4 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">Total Amount</th>
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
              <td className="px-6 py-6 whitespace-nowrap text-sm font-medium text-gray-900 text-center">
                <span className="font-semibold text-blue-700">{group.congressman}</span>
              </td>
              <td className="px-6 py-6 whitespace-nowrap text-sm text-gray-500 text-center">{formatDate(group.latestDate)}</td>
              <td className="px-6 py-6 whitespace-nowrap text-sm text-gray-500 text-center">{getTradeCountLabel(group.trades.length)}</td>
              <td className="px-6 py-6 whitespace-nowrap text-sm text-gray-500 text-center font-semibold">{formatMoney(group.totalAmount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

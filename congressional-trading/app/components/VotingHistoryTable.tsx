'use client';

export type VoteRecord = {
  date: string;
  question: string;
  description: string;
  memberVoted: string;
  result: string;
  chamber: string;
};

function normalizeVote(raw: string): { label: string; color: string; bg: string } {
  const v = raw?.toLowerCase().trim();
  if (v === 'yea' || v === 'aye' || v === 'yes') {
    return { label: 'Yes', color: '#16a34a', bg: '#f0fdf4' };
  }
  if (v === 'nay' || v === 'no') {
    return { label: 'No', color: '#dc2626', bg: '#fef2f2' };
  }
  return { label: 'Abstained', color: '#9ca3af', bg: '#f9fafb' };
}

type Props = {
  votes: VoteRecord[];
  isLoading: boolean;
  error: string | null;
};

export default function VotingHistoryTable({ votes, isLoading, error }: Props) {
  return (
    <div className="bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
      <div style={{ padding: '24px 24px 8px' }}>
        <h2
          style={{
            fontSize: 'clamp(1.4rem, 5vw, 2rem)',
            fontWeight: 800,
            color: '#1f2937',
            marginBottom: '4px',
            textAlign: 'center',
          }}
        >
          Voting History
        </h2>
        <p style={{ textAlign: 'center', fontSize: '13px', color: '#9ca3af', marginBottom: '16px' }}>
          Recent votes cast in Congress
        </p>
      </div>

      {isLoading ? (
        <div style={{ padding: '48px', textAlign: 'center' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              border: '3px solid #e0e7ff',
              borderTopColor: '#3b82f6',
              borderRadius: '50%',
              animation: 'spin 0.8s linear infinite',
              margin: '0 auto',
            }}
          />
          <p style={{ marginTop: '12px', fontSize: '13px', color: '#9ca3af' }}>Loading votes…</p>
        </div>
      ) : error && votes.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center' }}>
          <p style={{ fontSize: '14px', color: '#9ca3af' }}>{error}</p>
        </div>
      ) : votes.length === 0 ? (
        <div style={{ padding: '48px', textAlign: 'center' }}>
          <p style={{ fontSize: '14px', color: '#9ca3af' }}>No voting records found.</p>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', overflowY: 'auto', maxHeight: '520px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ background: '#f9fafb', borderBottom: '1px solid #e5e7eb' }}>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Date</th>
                <th style={{ padding: '10px 16px', textAlign: 'left', fontWeight: 600, color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bill / Question</th>
                <th style={{ padding: '10px 16px', textAlign: 'center', fontWeight: 600, color: '#6b7280', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', whiteSpace: 'nowrap' }}>Vote</th>
              </tr>
            </thead>
            <tbody>
              {votes.map((v, i) => {
                const { label, color, bg } = normalizeVote(v.memberVoted);
                const dateStr = v.date
                  ? new Date(v.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                  : '—';
                return (
                  <tr
                    key={`${v.date}-${i}`}
                    style={{ borderBottom: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafafa' }}
                  >
                    <td style={{ padding: '10px 16px', color: '#6b7280', whiteSpace: 'nowrap', verticalAlign: 'top' }}>{dateStr}</td>
                    <td style={{ padding: '10px 16px', color: '#1f2937', maxWidth: '520px', lineHeight: 1.5, verticalAlign: 'top' }}>
                      <div style={{ fontWeight: 600, marginBottom: '2px', overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{v.question}</div>
                      <div style={{ fontSize: '11px', color: '#9ca3af' }}>{v.description}</div>
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'center', verticalAlign: 'top' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          padding: '3px 10px',
                          borderRadius: '9999px',
                          background: bg,
                          color,
                          fontWeight: 700,
                          fontSize: '12px',
                          whiteSpace: 'nowrap',
                        }}
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

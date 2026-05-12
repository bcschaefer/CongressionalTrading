'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import FilterDropdown from '@/app/components/FilterDropdown';

type Member = {
  bioguide: string;
  full_name: string;
  party: string | null;
  chamber: string | null;
  is_active: boolean;
  state: string | null;
  first_year: number | null;
  last_year: number | null;
  net_worth: number | null;
};

type SortKey = 'full_name' | 'chamber' | 'party' | 'state' | 'first_year' | 'last_year' | 'net_worth';

function partyLabel(party: string | null): string {
  const p = (party ?? '').trim().toUpperCase();
  if (p === 'D' || p.startsWith('DEM')) return 'Democrat';
  if (p === 'R' || p.startsWith('REP')) return 'Republican';
  if (p === 'I' || p.startsWith('IND')) return 'Independent';
  return party ?? 'Unknown';
}

function partyColor(party: string | null): string {
  const p = (party ?? '').trim().toUpperCase();
  if (p === 'D' || p.startsWith('DEM')) return '#1d4ed8';
  if (p === 'R' || p.startsWith('REP')) return '#b91c1c';
  return '#6b7280';
}

function chamberLabel(chamber: string | null): string {
  const c = (chamber ?? '').trim().toLowerCase();
  if (c === 'house') return 'House';
  if (c === 'senate') return 'Senate';
  return chamber ?? '';
}

function formatNetWorth(n: number | null): string {
  if (n === null || n === 0) return '—';
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────

function SortIcon({ columnKey, sortKey, sortDir }: { columnKey: SortKey; sortKey: SortKey; sortDir: 'asc' | 'desc' }) {
  if (sortKey !== columnKey) return <span className="ml-1 text-slate-300">↕</span>;
  return <span className="ml-1 text-indigo-500">{sortDir === 'asc' ? '↑' : '↓'}</span>;
}

type ThProps = {
  columnKey: SortKey;
  label: string;
  align?: 'left' | 'center' | 'right';
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
};

function Th({ columnKey, label, align = 'left', sortKey, sortDir, onSort }: ThProps) {
  return (
    <th
      onClick={() => onSort(columnKey)}
      className={`cursor-pointer select-none whitespace-nowrap border-b border-slate-200 bg-slate-50 px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-wide ${sortKey === columnKey ? 'text-indigo-500' : 'text-slate-500'}`}
      style={{ textAlign: align }}
    >
      {label}<SortIcon columnKey={columnKey} sortKey={sortKey} sortDir={sortDir} />
    </th>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RepresentativesPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [partyFilter, setPartyFilter] = useState<'all' | 'D' | 'R' | 'I'>('all');
  const [chamberFilter, setChamberFilter] = useState<'all' | 'house' | 'senate'>('all');
  const [activeFilter, setActiveFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [sortKey, setSortKey] = useState<SortKey>('net_worth');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [hoveredBioguide, setHoveredBioguide] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/members')
      .then((r) => r.json())
      .then((data) => {
        setMembers(data.members ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const activeCount = useMemo(() => members.filter((m) => m.is_active).length, [members]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = members.filter((m) => {
      if (activeFilter === 'active' && !m.is_active) return false;
      if (activeFilter === 'inactive' && m.is_active) return false;
      if (q && !m.full_name.toLowerCase().includes(q)) return false;
      if (partyFilter !== 'all') {
        const p = (m.party ?? '').trim().toUpperCase();
        if (partyFilter === 'D' && !(p === 'D' || p.startsWith('DEM'))) return false;
        if (partyFilter === 'R' && !(p === 'R' || p.startsWith('REP'))) return false;
        if (partyFilter === 'I' && !(p === 'I' || p.startsWith('IND'))) return false;
      }
      if (chamberFilter !== 'all') {
        const c = (m.chamber ?? '').trim().toLowerCase();
        if (chamberFilter !== c) return false;
      }
      return true;
    });

    list = [...list].sort((a, b) => {
      let av: string | number | null = null;
      let bv: string | number | null = null;
      if (sortKey === 'full_name') { av = a.full_name; bv = b.full_name; }
      else if (sortKey === 'chamber') { av = chamberLabel(a.chamber); bv = chamberLabel(b.chamber); }
      else if (sortKey === 'party') { av = partyLabel(a.party); bv = partyLabel(b.party); }
      else if (sortKey === 'state') { av = a.state ?? ''; bv = b.state ?? ''; }
      else if (sortKey === 'first_year') { av = a.first_year; bv = b.first_year; }
      else if (sortKey === 'last_year') { av = a.last_year; bv = b.last_year; }
      else if (sortKey === 'net_worth') { av = a.net_worth; bv = b.net_worth; }

      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number'
        ? av - bv
        : String(av).localeCompare(String(bv));
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return list;
  }, [members, query, partyFilter, chamberFilter, activeFilter, sortKey, sortDir]);

  const thProps = { sortKey, sortDir, onSort: handleSort };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div
        className="text-white"
        style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #7c3aed 100%)', paddingBottom: '32px' }}
      >
        <div className="mx-auto max-w-6xl px-6" style={{ paddingTop: '24px' }}>
          <Link href="/" className="inline-block text-sm text-white/70 hover:text-white mb-5 transition">
            ← Back to home
          </Link>
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Members of Congress</h1>
              <p className="mt-2 text-white/75 text-base max-w-xl">
                Every member of Congress must disclose their stock trades. We make it easy to see who&rsquo;s betting big.
              </p>
              <p className="mt-1 text-white/50 text-sm">
                {loading ? '…' : `${activeCount} currently active · ${members.length} total`}
              </p>
            </div>
          </div>

          {/* Search bar */}
          <div className="mt-6">
            <input
              type="text"
              placeholder="Search members…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full max-w-120 rounded-xl border-none bg-white/15 px-4 py-2.5 text-[14px] text-white outline-none placeholder:text-white/50 focus:bg-white/25 box-border"
            />
          </div>
        </div>
      </div>

      {/* Filters + table */}
      <div className="mx-auto max-w-6xl px-6 py-6">
        <div className="flex flex-wrap gap-3 mb-5 items-center">
          <FilterDropdown
            label="Status"
            value={activeFilter}
            onChange={(v) => setActiveFilter(v as typeof activeFilter)}
            options={[
              { value: 'active', label: 'Active' },
              { value: 'inactive', label: 'Former' },
              { value: 'all', label: 'All' },
            ]}
          />
          <FilterDropdown
            label="Chamber"
            value={chamberFilter}
            onChange={(v) => setChamberFilter(v as typeof chamberFilter)}
            options={[
              { value: 'all', label: 'All Chambers' },
              { value: 'house', label: 'House' },
              { value: 'senate', label: 'Senate' },
            ]}
          />
          <FilterDropdown
            label="Party"
            value={partyFilter}
            onChange={(v) => setPartyFilter(v as typeof partyFilter)}
            options={[
              { value: 'all', label: 'All Parties' },
              { value: 'D', label: 'Democrat' },
              { value: 'R', label: 'Republican' },
              { value: 'I', label: 'Independent' },
            ]}
          />
          <span className="ml-0 self-end pb-1.5 text-xs text-gray-400 sm:ml-auto">
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-gray-400">Loading…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-12 text-center text-sm text-gray-400">
            No results found.
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: '700px' }}>
                <thead>
                  <tr>
                    <Th columnKey="full_name" label="Name" {...thProps} />
                    <Th columnKey="chamber" label="Chamber" align="center" {...thProps} />
                    <Th columnKey="party" label="Party" align="center" {...thProps} />
                    <Th columnKey="state" label="State" align="center" {...thProps} />
                    <Th columnKey="net_worth" label="Net Worth" align="right" {...thProps} />
                    <Th columnKey="first_year" label="First Filing" align="center" {...thProps} />
                    <Th columnKey="last_year" label="Last Filing" align="center" {...thProps} />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((m, index) => {
                    const partyTextColor = partyColor(m.party);
                    return (
                      <tr
                        key={m.bioguide}
                        onClick={() => router.push(`/congressman/${m.bioguide}`)}
                        onMouseEnter={() => { setHoveredBioguide(m.bioguide); router.prefetch(`/congressman/${m.bioguide}`); }}
                        onMouseLeave={() => setHoveredBioguide(null)}
                        className="cursor-pointer transition-colors duration-100"
                        style={{ background: hoveredBioguide === m.bioguide ? '#eff6ff' : index % 2 === 0 ? '#fff' : '#f8fafc' }}
                      >
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-[14px]">
                          <div className="flex items-center gap-2">
                            {m.is_active && (
                              <span className="h-1.75 w-1.75 shrink-0 rounded-full bg-green-600" />
                            )}
                            <span className={`font-semibold ${m.is_active ? 'text-gray-900' : 'text-gray-400'}`}>{m.full_name}</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-center text-[13px]">
                          {m.chamber ? (
                            <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                              m.chamber.toLowerCase() === 'senate'
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-green-100 text-green-700'
                            }`}>{chamberLabel(m.chamber)}</span>
                          ) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-center text-[13px] font-semibold" style={{ color: partyTextColor }}>
                          {m.party ? partyLabel(m.party) : '—'}
                        </td>
                        <td className="px-3.5 py-2.5 text-center text-[13px] font-semibold text-gray-700">
                          {m.state ?? '—'}
                        </td>
                        <td className={`whitespace-nowrap px-3.5 py-2.5 text-right text-[13px] font-bold ${
                          m.net_worth && m.net_worth > 0 ? 'text-green-700' : 'text-gray-400'
                        }`}>
                          {formatNetWorth(m.net_worth)}
                        </td>
                        <td className="px-3.5 py-2.5 text-center text-[13px] text-gray-500">
                          {m.first_year ?? '—'}
                        </td>
                        <td className={`px-3.5 py-2.5 text-center text-[13px] ${
                          m.is_active ? 'font-semibold text-green-700' : 'text-gray-500'
                        }`}>
                          {m.is_active ? 'Active' : (m.last_year ?? '—')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


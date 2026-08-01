'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import FilterDropdown from '@/app/components/FilterDropdown';
import Avatar from '@/app/components/ui/Avatar';
import GradientRule from '@/app/components/ui/GradientRule';
import { partyLabel, partyTokens } from '@/lib/party';

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
  if (sortKey !== columnKey) return <span className="ml-1 text-(--color-text-muted)">↕</span>;
  return <span className="ml-1 text-(--color-accent)">{sortDir === 'asc' ? '↑' : '↓'}</span>;
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
      className={`cursor-pointer select-none whitespace-nowrap border-b border-(--color-border) bg-(--color-bg-subtle) px-3.5 py-2.5 text-[11px] font-bold uppercase tracking-wide ${sortKey === columnKey ? 'text-(--color-accent)' : 'text-(--color-text-muted)'}`}
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
    <div className="min-h-screen bg-white">
      {/* Header */}
      <div className="px-6 pb-6 pt-6">
        <div className="mx-auto max-w-6xl">
          <Link href="/" className="mb-4 inline-block text-sm text-(--color-text-secondary) transition hover:text-foreground">
            ← Back to home
          </Link>
          <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Members of Congress</h1>
          <p className="mt-2 max-w-xl text-sm text-(--color-text-secondary)">
            Every current and former member of Congress, sorted by trading activity and net worth.
          </p>
          <p className="mt-1 text-xs text-(--color-text-muted)">
            {loading ? '…' : `${activeCount} currently active · ${members.length} total`}
          </p>

          {/* Search bar */}
          <div className="mt-5">
            <input
              type="text"
              placeholder="Search members…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full max-w-xs rounded-sm border border-(--color-border) px-3.5 py-2 text-sm text-foreground outline-none placeholder:text-(--color-text-muted) focus:border-(--color-accent)"
            />
          </div>
        </div>
      </div>
      <GradientRule />

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
          <span className="ml-0 self-end pb-1.5 text-xs text-(--color-text-muted) sm:ml-auto">
            {filtered.length} result{filtered.length !== 1 ? 's' : ''}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-(--color-text-muted)">Loading…</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-md border border-(--color-border) bg-white p-12 text-center text-sm text-(--color-text-muted)">
            No results found.
          </div>
        ) : (
          <div className="overflow-hidden rounded-md border border-(--color-border) bg-white">
            <div className="overflow-x-auto">
              <table className="w-full min-w-175 border-collapse">
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
                <tbody className="divide-y divide-(--color-border)">
                  {filtered.map((m) => {
                    const partyTextVar = partyTokens(m.party).text;
                    return (
                      <tr
                        key={m.bioguide}
                        onClick={() => router.push(`/congressman/${m.bioguide}`)}
                        onMouseEnter={() => { setHoveredBioguide(m.bioguide); router.prefetch(`/congressman/${m.bioguide}`); }}
                        onMouseLeave={() => setHoveredBioguide(null)}
                        className={`cursor-pointer transition-colors duration-150 ${hoveredBioguide === m.bioguide ? 'bg-(--color-bg-subtle)' : 'bg-white'}`}
                      >
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-sm">
                          <div className="flex items-center gap-2.5">
                            <Avatar name={m.full_name} party={m.party} size="sm" />
                            <span className={`font-semibold ${m.is_active ? 'text-foreground' : 'text-(--color-text-muted)'}`}>{m.full_name}</span>
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-center text-[13px] text-(--color-text-secondary)">
                          {m.chamber ? chamberLabel(m.chamber) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3.5 py-2.5 text-center text-[13px] font-semibold" style={{ color: `var(${partyTextVar})` }}>
                          {m.party ? partyLabel(m.party) : '—'}
                        </td>
                        <td className="px-3.5 py-2.5 text-center text-[13px] font-semibold text-(--color-text-secondary)">
                          {m.state ?? '—'}
                        </td>
                        <td className={`whitespace-nowrap px-3.5 py-2.5 text-right text-[13px] font-bold ${
                          m.net_worth && m.net_worth > 0 ? 'text-(--color-positive)' : 'text-(--color-text-muted)'
                        }`}>
                          {formatNetWorth(m.net_worth)}
                        </td>
                        <td className="px-3.5 py-2.5 text-center text-[13px] text-(--color-text-secondary)">
                          {m.first_year ?? '—'}
                        </td>
                        <td className={`px-3.5 py-2.5 text-center text-[13px] ${
                          m.is_active ? 'font-semibold text-(--color-positive)' : 'text-(--color-text-secondary)'
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


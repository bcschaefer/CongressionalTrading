'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

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

type DropdownOption = { value: string; label: string };

function FilterDropdown({ label, value, onChange, options }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: DropdownOption[];
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selectedLabel = options.find((o) => o.value === value)?.label ?? value;

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: '2px', position: 'relative' }}>
      <span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#94a3b8' }}>{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '6px 10px',
          borderRadius: '8px',
          border: '1.5px solid #e2e8f0',
          background: open ? '#f1f5f9' : '#f8fafc',
          color: '#374151',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          outline: 'none',
          whiteSpace: 'nowrap',
          minWidth: '110px',
          justifyContent: 'space-between',
        }}
      >
        <span>{selectedLabel}</span>
        <span style={{ fontSize: '10px', color: '#6b7280', marginLeft: '4px' }}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 4px)',
          left: 0,
          zIndex: 50,
          background: '#fff',
          border: '1.5px solid #e2e8f0',
          borderRadius: '10px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
          minWidth: '140px',
          overflow: 'hidden',
        }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '8px 12px',
                fontSize: '13px',
                fontWeight: opt.value === value ? 700 : 500,
                color: opt.value === value ? '#6366f1' : '#374151',
                background: opt.value === value ? '#f5f3ff' : 'transparent',
                border: 'none',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { if (opt.value !== value) (e.currentTarget as HTMLButtonElement).style.background = '#f8fafc'; }}
              onMouseLeave={(e) => { if (opt.value !== value) (e.currentTarget as HTMLButtonElement).style.background = 'transparent'; }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

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

  const isSearching = query.trim().length > 0;

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
  }, [members, query, isSearching, partyFilter, chamberFilter, activeFilter, sortKey, sortDir]);

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span style={{ color: '#cbd5e1', marginLeft: 4 }}>↕</span>;
    return <span style={{ color: '#6366f1', marginLeft: 4 }}>{sortDir === 'asc' ? '↑' : '↓'}</span>;
  }

  function Th({ k, label, align = 'left' }: { k: SortKey; label: string; align?: string }) {
    return (
      <th
        onClick={() => handleSort(k)}
        style={{
          padding: '10px 14px',
          textAlign: align as React.CSSProperties['textAlign'],
          fontSize: '11px',
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: sortKey === k ? '#6366f1' : '#64748b',
          cursor: 'pointer',
          userSelect: 'none',
          whiteSpace: 'nowrap',
          background: '#f8fafc',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        {label}<SortIcon k={k} />
      </th>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
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
              style={{
                width: '100%',
                maxWidth: '480px',
                borderRadius: '10px',
                border: 'none',
                background: 'rgba(255,255,255,0.15)',
                color: '#fff',
                padding: '10px 16px',
                fontSize: '14px',
                outline: 'none',
                boxSizing: 'border-box',
              }}
              className="placeholder:text-white/50 focus:bg-white/25"
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
          <span className="ml-0 text-xs text-gray-400 sm:ml-auto" style={{ alignSelf: 'flex-end', paddingBottom: '6px' }}>
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
                    <Th k="full_name" label="Name" />
                    <Th k="chamber" label="Chamber" align="center" />
                    <Th k="party" label="Party" align="center" />
                    <Th k="state" label="State" align="center" />
                    <Th k="net_worth" label="Net Worth" align="right" />
                    <Th k="first_year" label="First Filing" align="center" />
                    <Th k="last_year" label="Last Filing" align="center" />
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
                        style={{
                          background: hoveredBioguide === m.bioguide ? '#eff6ff' : index % 2 === 0 ? '#fff' : '#f8fafc',
                          cursor: 'pointer',
                          transition: 'background 0.12s',
                        }}
                      >
                        <td style={{ padding: '10px 14px', fontSize: '14px', whiteSpace: 'nowrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {m.is_active && (
                              <span style={{ width: '7px', height: '7px', borderRadius: '9999px', background: '#16a34a', flexShrink: 0 }} />
                            )}
                            <span style={{ fontWeight: 600, color: m.is_active ? '#111827' : '#9ca3af' }}>{m.full_name}</span>
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: '13px', whiteSpace: 'nowrap' }}>
                          {m.chamber ? (
                            <span style={{
                              padding: '2px 8px',
                              borderRadius: '9999px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: m.chamber.toLowerCase() === 'senate' ? '#f3e8ff' : '#dcfce7',
                              color: m.chamber.toLowerCase() === 'senate' ? '#7c3aed' : '#15803d',
                            }}>{chamberLabel(m.chamber)}</span>
                          ) : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: '13px', whiteSpace: 'nowrap', color: partyTextColor, fontWeight: 600 }}>
                          {m.party ? partyLabel(m.party) : '—'}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: '13px', fontWeight: 600, color: '#374151' }}>
                          {m.state ?? '—'}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: '13px', fontWeight: 700, color: m.net_worth && m.net_worth > 0 ? '#15803d' : '#9ca3af', whiteSpace: 'nowrap' }}>
                          {formatNetWorth(m.net_worth)}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: '13px', color: '#6b7280' }}>
                          {m.first_year ?? '—'}
                        </td>
                        <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: '13px', color: m.is_active ? '#15803d' : '#6b7280', fontWeight: m.is_active ? 600 : 400 }}>
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


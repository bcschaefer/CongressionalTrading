'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Member = {
  bioguide: string;
  full_name: string;
  party: string | null;
  chamber: string | null;
  is_active: boolean;
  latestFilingYear: number | null;
};

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

export default function RepresentativesPage() {
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [partyFilter, setPartyFilter] = useState<'all' | 'D' | 'R' | 'I'>('all');
  const [chamberFilter, setChamberFilter] = useState<'all' | 'house' | 'senate'>('all');

  // When searching, show all members (since 2008 via disclosures filter on API).
  // When not searching, default to active members only.
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((m) => {
      // Default view: active only. Searching: all members.
      if (!isSearching && !m.is_active) return false;
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
  }, [members, query, isSearching, partyFilter, chamberFilter]);

  const filterBtnBase: React.CSSProperties = {
    padding: '5px 14px',
    borderRadius: '9999px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    border: '1.5px solid transparent',
    transition: 'all 0.15s',
    lineHeight: '1.4',
  };

  function filterBtn(active: boolean, activeColor: string): React.CSSProperties {
    return active
      ? { ...filterBtnBase, background: activeColor, color: '#fff', borderColor: activeColor }
      : { ...filterBtnBase, background: '#f1f5f9', color: '#475569', borderColor: '#e2e8f0' };
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f8fafc' }}>
      {/* Header */}
      <div
        className="text-white"
        style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 50%, #7c3aed 100%)', paddingBottom: '32px' }}
      >
        <div className="mx-auto max-w-5xl px-6" style={{ paddingTop: '24px' }}>
          <Link href="/" className="inline-block text-sm text-white/70 hover:text-white mb-5 transition">
            ← Back to home
          </Link>
          <div className="flex items-end justify-between flex-wrap gap-4">
            <div>
              <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Representatives</h1>
              <p className="mt-1 text-white/60 text-sm">
                {loading ? '…' : isSearching
                  ? `Searching all ${members.length} members with trade disclosures`
                  : `${activeCount} currently active members`}
              </p>
            </div>
          </div>

          {/* Search bar inside header */}
          <div className="mt-6">
            <input
              type="text"
              placeholder="Search all members since 2008…"
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
            {isSearching && (
              <p style={{ marginTop: '8px', color: 'rgba(255,255,255,0.7)', fontSize: '12px' }}>Showing all eras</p>
            )}
          </div>
        </div>
      </div>

      {/* Filters + list */}
      <div className="mx-auto max-w-5xl px-6 py-6">
        {/* Filter row */}
        <div className="flex flex-wrap gap-2 mb-5 items-center">
          <button style={filterBtn(partyFilter === 'all', '#6b7280')} onClick={() => setPartyFilter('all')}>All Parties</button>
          <button style={filterBtn(partyFilter === 'D', '#1d4ed8')} onClick={() => setPartyFilter('D')}>Democrat</button>
          <button style={filterBtn(partyFilter === 'R', '#b91c1c')} onClick={() => setPartyFilter('R')}>Republican</button>
          <button style={filterBtn(partyFilter === 'I', '#6b7280')} onClick={() => setPartyFilter('I')}>Independent</button>
          <span style={{ width: '1px', height: '20px', background: '#e2e8f0', margin: '0 4px' }} />
          <button style={filterBtn(chamberFilter === 'all', '#6b7280')} onClick={() => setChamberFilter('all')}>All Chambers</button>
          <button style={filterBtn(chamberFilter === 'house', '#0f766e')} onClick={() => setChamberFilter('house')}>House</button>
          <button style={filterBtn(chamberFilter === 'senate', '#7c3aed')} onClick={() => setChamberFilter('senate')}>Senate</button>
          <span className="ml-0 text-xs text-gray-400 sm:ml-auto">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-gray-400">Loading…</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            {filtered.length === 0 ? (
              <p className="text-center text-gray-400 py-12 text-sm">No results found.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {filtered.map((m) => {
                  const color = partyColor(m.party);
                  return (
                    <button
                      key={m.bioguide}
                      onClick={() => router.push(`/congressman/${m.bioguide}`)}
                      className="w-full text-left hover:bg-blue-50 transition-colors cursor-pointer"
                      style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', flexWrap: 'wrap' }}
                    >
                      <span
                        style={{
                          width: '8px',
                          height: '8px',
                          borderRadius: '9999px',
                          background: color,
                          flexShrink: 0,
                        }}
                      />
                      <span style={{ flex: '1 1 100%', minWidth: '0', fontWeight: 600, fontSize: '14px', color: '#111827' }} className="sm:flex-1">
                        {m.full_name}
                      </span>
                      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexShrink: 0, flexWrap: 'wrap', width: '100%' }} className="sm:w-auto">
                        {m.party && (
                          <span style={{ color, fontSize: '12px', fontWeight: 600 }}>
                            {partyLabel(m.party)}
                          </span>
                        )}
                        {m.chamber && (
                          <span style={{ color: '#9ca3af', fontSize: '12px' }}>
                            {chamberLabel(m.chamber)}
                          </span>
                        )}
                        {!m.is_active && isSearching && (
                          <span style={{ color: '#d1d5db', fontSize: '11px' }}>Former</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}


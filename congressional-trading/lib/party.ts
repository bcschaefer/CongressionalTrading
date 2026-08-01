export type PartyKey = 'D' | 'R' | 'I';

function normalize(party: string | null | undefined): PartyKey | null {
  const p = (party ?? '').trim().toUpperCase();
  if (p === 'D' || p.startsWith('DEM')) return 'D';
  if (p === 'R' || p.startsWith('REP')) return 'R';
  if (p === 'I' || p.startsWith('IND')) return 'I';
  return null;
}

export function partyLabel(party: string | null | undefined): string {
  const key = normalize(party);
  if (key === 'D') return 'Democrat';
  if (key === 'R') return 'Republican';
  if (key === 'I') return 'Independent';
  return party?.trim() || 'Unknown';
}

/**
 * CSS custom-property names (from app/globals.css) for this party's avatar colors —
 * a light tint background + saturated text, not a solid fill.
 */
export function partyTokens(party: string | null | undefined): { text: string; bg: string } {
  const key = normalize(party);
  if (key === 'D') return { text: '--color-party-d', bg: '--color-party-d-bg' };
  if (key === 'R') return { text: '--color-party-r', bg: '--color-party-r-bg' };
  if (key === 'I') return { text: '--color-party-i', bg: '--color-party-i-bg' };
  return { text: '--color-party-neutral', bg: '--color-party-neutral-bg' };
}

export function partyInitial(party: string | null | undefined): string {
  const key = normalize(party);
  return key ?? '?';
}

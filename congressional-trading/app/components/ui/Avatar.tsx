'use client';

import { useState } from 'react';
import { partyTokens } from '@/lib/party';

type AvatarProps = {
  name: string;
  party?: string | null;
  photoUrl?: string | null;
  size?: 'sm' | 'md' | 'lg' | 'portrait';
  /** Override the border/ring color (a CSS var name) — defaults to the party color.
   * Useful when the avatar sits on a surface already tinted that same party color. */
  ringVar?: string;
};

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

const SIZE_CLASSES: Record<NonNullable<AvatarProps['size']>, string> = {
  sm: 'h-7 w-7 text-[11px] rounded-full',
  md: 'h-10 w-10 text-sm rounded-full',
  lg: 'h-18 w-18 text-xl rounded-full',
  portrait: 'h-52 w-40 text-4xl rounded-lg',
};

export default function Avatar({ name, party, photoUrl, size = 'sm', ringVar }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const { text, bg } = partyTokens(party);
  const borderVar = ringVar ?? text;

  if (photoUrl && !imgFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt={name}
        onError={() => setImgFailed(true)}
        className={`shrink-0 border-2 object-cover transition-transform duration-150 ${SIZE_CLASSES[size]}`}
        style={{ borderColor: `var(${borderVar})` }}
      />
    );
  }

  return (
    <div
      className={`flex shrink-0 items-center justify-center font-semibold transition-transform duration-150 ${SIZE_CLASSES[size]}`}
      style={{ backgroundColor: `var(${bg})`, color: `var(${text})` }}
      aria-hidden="true"
    >
      {initialsFor(name)}
    </div>
  );
}

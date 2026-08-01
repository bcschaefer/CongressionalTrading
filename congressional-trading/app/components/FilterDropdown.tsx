'use client';

import { useState, useEffect, useRef } from 'react';

export type DropdownOption = { value: string; label: string };

export default function FilterDropdown({
  label,
  value,
  onChange,
  options,
}: {
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
    <div ref={ref} className="relative flex flex-col gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-(--color-text-muted)">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex min-w-27.5 cursor-pointer items-center justify-between gap-1.5 whitespace-nowrap rounded-sm border border-(--color-border) px-2.5 py-1.5 text-[13px] font-semibold text-(--color-text-primary) outline-none transition-colors duration-150 hover:border-(--color-border-strong) ${open ? 'border-(--color-accent) bg-(--color-bg-subtle)' : 'bg-white'}`}
      >
        <span>{selectedLabel}</span>
        <span className="ml-1 text-[10px] text-(--color-text-secondary)">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 min-w-35 overflow-hidden rounded-sm border border-(--color-border) bg-white">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`block w-full cursor-pointer border-none px-3 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-(--color-bg-subtle) ${opt.value === value ? 'bg-(--color-bg-subtle) font-bold text-(--color-accent)' : 'bg-transparent font-medium text-(--color-text-primary)'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

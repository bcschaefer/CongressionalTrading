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
      <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex min-w-27.5 cursor-pointer items-center justify-between gap-1.5 whitespace-nowrap rounded-lg border-[1.5px] border-slate-200 px-2.5 py-1.5 text-[13px] font-semibold text-gray-700 outline-none ${open ? 'bg-slate-100' : 'bg-slate-50'}`}
      >
        <span>{selectedLabel}</span>
        <span className="ml-1 text-[10px] text-gray-500">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="absolute left-0 top-[calc(100%+4px)] z-50 min-w-35 overflow-hidden rounded-xl border-[1.5px] border-slate-200 bg-white shadow-lg">
          {options.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => { onChange(opt.value); setOpen(false); }}
              className={`block w-full cursor-pointer border-none px-3 py-2 text-left text-[13px] hover:bg-slate-50 ${opt.value === value ? 'bg-violet-50 font-bold text-indigo-500' : 'bg-transparent font-medium text-gray-700'}`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

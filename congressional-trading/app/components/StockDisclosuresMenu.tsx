'use client';

import { useState } from 'react';

function isSenateSourceUrl(url: string | null): boolean {
  return !!url && /efdsearch\.senate\.gov\//i.test(url);
}

export type AnnualDisclosureItem = {
  id: number;
  doc_id: string;
  filing_type: string;
  filing_year: number;
  filing_date: string | null;
  source_url: string | null;
};

export default function StockDisclosuresMenu({ disclosures }: { disclosures: AnnualDisclosureItem[] }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="overflow-hidden rounded-md border border-(--color-border) bg-white p-6">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        className={`flex w-full cursor-pointer items-center justify-between border border-(--color-border) bg-white px-3 py-2.5 text-left text-[13px] font-bold text-(--color-text-primary) ${
          isOpen ? 'rounded-t-sm' : 'rounded-sm'
        }`}
      >
        <span>Stock Disclosures</span>
        <span className="inline-flex items-center gap-2 text-(--color-text-secondary)">
          <span className="text-xs font-semibold">{disclosures.length}</span>
          <span className="text-xs leading-none">{isOpen ? '▾' : '▸'}</span>
        </span>
      </button>

      <div
        className="overflow-hidden transition-[max-height,opacity] duration-300 ease-out"
        style={{ maxHeight: isOpen ? '300px' : '0px', opacity: isOpen ? 1 : 0 }}
      >
        <div className="max-h-[300px] overflow-y-auto rounded-b-sm border border-t-0 border-(--color-border) p-1.5">
          {disclosures.length === 0 ? (
            <p className="my-2 text-center text-xs text-(--color-text-secondary)">
              No disclosures available.
            </p>
          ) : (
            disclosures.map((d) => {
              const url = isSenateSourceUrl(d.source_url)
                ? d.source_url!
                : `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${d.filing_year}/${d.doc_id}.pdf`;
              return (
                <a
                  key={d.id}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="mb-1 flex items-center justify-between gap-2.5 rounded-sm border border-(--color-border) bg-white px-2 py-1.5 transition-colors duration-150 hover:border-(--color-accent) hover:bg-(--color-bg-subtle)"
                >
                  <span className="text-xs font-semibold text-(--color-text-primary)">
                    {d.filing_year} {d.filing_date ? `(${d.filing_date})` : ''}
                  </span>
                  <span className="whitespace-nowrap text-[11px] font-bold text-(--color-accent)">
                    View
                  </span>
                </a>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

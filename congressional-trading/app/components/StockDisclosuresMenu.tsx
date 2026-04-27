'use client';

import { useState } from 'react';

export type AnnualDisclosureItem = {
  id: number;
  doc_id: string;
  filing_type: string;
  filing_year: number;
  filing_date: string | null;
};

export default function StockDisclosuresMenu({ disclosures }: { disclosures: AnnualDisclosureItem[] }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="bg-white rounded-xl shadow-xl border border-gray-200 p-6 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          textAlign: 'left',
          padding: '10px 12px',
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          color: '#1f2937',
          fontSize: '13px',
          fontWeight: 700,
          cursor: 'pointer',
          borderRadius: isOpen ? '8px 8px 0 0' : '8px',
        }}
      >
        <span>Stock Disclosures</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', color: '#4b5563' }}>
          <span style={{ fontSize: '12px', fontWeight: 600 }}>{disclosures.length}</span>
          <span style={{ fontSize: '12px', lineHeight: 1 }}>{isOpen ? '▾' : '▸'}</span>
        </span>
      </button>

      <div
        style={{
          maxHeight: isOpen ? '300px' : '0px',
          opacity: isOpen ? 1 : 0,
          transition: 'max-height 280ms ease, opacity 220ms ease',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            maxHeight: '300px',
            overflowY: 'auto',
            padding: '6px',
            border: '1px solid #e5e7eb',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
          }}
        >
          {disclosures.length === 0 ? (
            <p style={{ textAlign: 'center', color: '#6b7280', fontSize: '12px', margin: '8px 0' }}>
              No disclosures available.
            </p>
          ) : (
            disclosures.map((d) => {
              const url = `https://disclosures-clerk.house.gov/public_disc/financial-pdfs/${d.filing_year}/${d.doc_id}.pdf`;
              return (
                <a
                  key={d.id}
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '10px',
                    padding: '7px 8px',
                    borderRadius: '6px',
                    marginBottom: '4px',
                    background: '#ffffff',
                    border: '1px solid #f3f4f6',
                    textDecoration: 'none',
                  }}
                >
                  <span style={{ color: '#111827', fontSize: '12px', fontWeight: 600 }}>
                    {d.filing_year} {d.filing_date ? `(${d.filing_date})` : ''}
                  </span>
                  <span
                    style={{
                      color: '#1d4ed8',
                      fontSize: '11px',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}
                  >
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

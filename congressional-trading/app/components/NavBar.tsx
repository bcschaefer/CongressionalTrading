'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FormEvent, KeyboardEvent, useEffect, useRef, useState } from 'react';

type NavItem = {
  href: string;
  label: string;
  isActive: (pathname: string) => boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home', isActive: (pathname) => pathname === '/' },
  {
    href: '/representatives',
    label: 'Representatives',
    isActive: (pathname) => pathname.startsWith('/representatives') || pathname.startsWith('/congressman'),
  },
  { href: '/stocks', label: 'Stocks', isActive: (pathname) => pathname.startsWith('/stocks') },
];

type SearchResult = {
  type: 'member' | 'stock';
  label: string;
  sublabel: string;
  href: string;
};

export default function NavBar() {
  const pathname = usePathname();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const searchRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!searchRef.current) return;
      if (searchRef.current.contains(event.target as Node)) return;
      setIsOpen(false);
    };

    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setResults([]);
      setIsOpen(false);
      setLoading(false);
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(async () => {
      try {
        setLoading(true);
        const response = await fetch(`/api/search?q=${encodeURIComponent(trimmed)}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          setResults([]);
          setIsOpen(false);
          return;
        }
        const data = (await response.json()) as { results?: SearchResult[] };
        const next = data.results ?? [];
        setResults(next);
        setIsOpen(true);
        setActiveIndex(next.length > 0 ? 0 : -1);
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setIsOpen(false);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }, 180);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [query]);

  const navigateTo = (href: string) => {
    setIsOpen(false);
    setQuery('');
    setResults([]);
    setActiveIndex(-1);
    router.push(href);
  };

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (results.length === 0) return;
    const picked = results[Math.max(0, activeIndex)] ?? results[0];
    if (picked) navigateTo(picked.href);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || results.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((prev) => (prev + 1) % results.length);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((prev) => (prev <= 0 ? results.length - 1 : prev - 1));
      return;
    }

    if (event.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <>
      <header className="site-nav-wrap">
        <nav className="site-nav-inner">
          <div className="site-nav-links">
            {NAV_ITEMS.map((item) => {
              const active = item.isActive(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`site-nav-pill ${active ? 'site-nav-pill-active' : ''}`}
                >
                  {item.label}
                </Link>
              );
            })}
        </div>

          <div className="site-nav-search-wrap" ref={searchRef}>
            <form onSubmit={onSubmit} className="site-nav-search-form" role="search" aria-label="Global search">
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => {
                  if (query.trim().length >= 2) setIsOpen(true);
                }}
                onKeyDown={onKeyDown}
                placeholder="Search stock or representative"
                className="site-nav-search-input"
                aria-label="Search stock or representative"
              />
              <button type="submit" className="site-nav-search-btn">
                Search
              </button>
          </form>

          {isOpen && (
              <div className="site-nav-search-dropdown" role="listbox" aria-label="Search results">
                {loading ? (
                  <div className="site-nav-search-empty">Searching...</div>
                ) : results.length === 0 ? (
                  <div className="site-nav-search-empty">No matches found</div>
                ) : (
                  results.map((result, index) => (
                    <button
                      key={`${result.type}-${result.href}-${index}`}
                      type="button"
                      className={`site-nav-search-item ${index === activeIndex ? 'site-nav-search-item-active' : ''}`}
                      onMouseEnter={() => setActiveIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => navigateTo(result.href)}
                      role="option"
                      aria-selected={index === activeIndex}
                    >
                      <span className="site-nav-search-type">{result.type === 'member' ? 'REP' : 'STOCK'}</span>
                      <span className="site-nav-search-text">
                        <span className="site-nav-search-label">{result.label}</span>
                        <span className="site-nav-search-sublabel">{result.sublabel}</span>
                      </span>
                    </button>
                  ))
                )}
            </div>
          )}
        </div>

          <Link href="/" className="site-nav-brand" aria-label="Go to Home">
          InsideTrader
        </Link>
      </nav>
    </header>

      <style jsx global>{`
        .site-nav-wrap {
          position: sticky;
          top: 0;
          z-index: 50;
          backdrop-filter: blur(10px);
          background: linear-gradient(90deg, #ef4444 0%, #2563eb 100%);
          border-bottom: 1px solid rgba(255, 255, 255, 0.28);
        }

        .site-nav-inner {
          max-width: 80rem;
          margin: 0 auto;
          padding: 20px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .site-nav-links {
          display: flex;
          align-items: center;
          gap: 10px;
          flex-shrink: 0;
        }

        .site-nav-search-wrap {
          position: relative;
          flex: 1;
          min-width: 220px;
          max-width: 520px;
        }

        .site-nav-search-form {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .site-nav-search-input {
          width: 100%;
          border: 1px solid rgba(255, 255, 255, 0.42);
          background: rgba(255, 255, 255, 0.16);
          color: #ffffff;
          border-radius: 9999px;
          padding: 10px 14px;
          font-size: 14px;
          font-weight: 600;
          outline: none;
          transition: border-color 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease;
        }

        .site-nav-search-input::placeholder {
          color: rgba(255, 255, 255, 0.7);
        }

        .site-nav-search-input:focus {
          border-color: rgba(255, 255, 255, 0.75);
          background: rgba(255, 255, 255, 0.22);
          box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.2);
        }

        .site-nav-search-btn {
          border: 1px solid rgba(255, 255, 255, 0.4);
          background: rgba(15, 23, 42, 0.25);
          color: #ffffff;
          border-radius: 9999px;
          padding: 9px 12px;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
          transition: background-color 0.2s ease, border-color 0.2s ease;
        }

        .site-nav-search-btn:hover {
          background: rgba(15, 23, 42, 0.38);
          border-color: rgba(255, 255, 255, 0.6);
        }

        .site-nav-search-dropdown {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          right: 0;
          border-radius: 14px;
          background: rgba(15, 23, 42, 0.92);
          border: 1px solid rgba(255, 255, 255, 0.25);
          box-shadow: 0 12px 28px rgba(15, 23, 42, 0.45);
          overflow: hidden;
          z-index: 70;
          backdrop-filter: blur(8px);
        }

        .site-nav-search-empty {
          padding: 12px 14px;
          color: rgba(255, 255, 255, 0.86);
          font-size: 13px;
          font-weight: 600;
        }

        .site-nav-search-item {
          width: 100%;
          border: 0;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          background: transparent;
          color: #ffffff;
          cursor: pointer;
          text-align: left;
          padding: 10px 12px;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .site-nav-search-item:first-child {
          border-top: 0;
        }

        .site-nav-search-item:hover,
        .site-nav-search-item-active {
          background: rgba(59, 130, 246, 0.24);
        }

        .site-nav-search-type {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 48px;
          padding: 3px 7px;
          border-radius: 9999px;
          background: rgba(255, 255, 255, 0.15);
          border: 1px solid rgba(255, 255, 255, 0.24);
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.05em;
        }

        .site-nav-search-text {
          display: flex;
          flex-direction: column;
          min-width: 0;
          gap: 2px;
        }

        .site-nav-search-label {
          font-size: 13px;
          font-weight: 700;
          line-height: 1.2;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .site-nav-search-sublabel {
          font-size: 11px;
          color: rgba(255, 255, 255, 0.76);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .site-nav-pill {
          font-size: 14px;
          font-weight: 700;
          color: #ffffff;
          text-decoration: none;
          padding: 10px 14px;
          border-radius: 9999px;
          border: 1px solid rgba(255, 255, 255, 0.35);
          background: rgba(255, 255, 255, 0.12);
          box-shadow: 0 2px 10px rgba(15, 23, 42, 0.2);
          transition: transform 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }

        .site-nav-pill:hover {
          transform: translateY(-1px);
          background: rgba(255, 255, 255, 0.24);
          border-color: rgba(255, 255, 255, 0.6);
          box-shadow: 0 6px 16px rgba(15, 23, 42, 0.28);
        }

        .site-nav-pill-active {
          background: rgba(15, 23, 42, 0.28);
          border-color: rgba(255, 255, 255, 0.75);
          box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.25), 0 6px 16px rgba(15, 23, 42, 0.3);
        }

        .site-nav-brand {
          background: linear-gradient(90deg, #3b82f6 0%, #ef4444 100%);
          -webkit-background-clip: text;
          background-clip: text;
          color: transparent;
          text-decoration: none;
          font-weight: 900;
          letter-spacing: 0.02em;
          font-size: 34px;
          line-height: 1;
          text-shadow: 0 3px 12px rgba(15, 23, 42, 0.45);
          transition: transform 0.2s ease, filter 0.2s ease;
        }

        .site-nav-brand:hover {
          transform: translateY(-1px);
          filter: brightness(1.15);
        }

        @media (max-width: 980px) {
          .site-nav-inner {
            flex-wrap: wrap;
          }

          .site-nav-links {
            order: 1;
          }

          .site-nav-brand {
            order: 2;
            margin-left: auto;
          }

          .site-nav-search-wrap {
            order: 3;
            flex-basis: 100%;
            max-width: none;
            min-width: 0;
          }
        }
      `}</style>
    </>
  );
}

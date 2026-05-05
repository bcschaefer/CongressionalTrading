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

const REPORT_HREF = '/report';
const GITHUB_HREF = 'https://github.com/bcschaefer/CongressionalTrading';
const LINKEDIN_HREF = 'https://www.linkedin.com/in/benjamincschaefer/';

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
            <a
              href={REPORT_HREF}
              target="_blank"
              rel="noreferrer"
              className="site-nav-pill site-nav-pill-report"
            >
              Report
            </a>
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
                <svg viewBox="0 0 24 24" aria-hidden="true" className="site-nav-search-btn-icon">
                  <path
                    fill="currentColor"
                    d="M10.5 3a7.5 7.5 0 0 1 5.916 12.112l4.736 4.736a1 1 0 0 1-1.414 1.414l-4.736-4.736A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"
                  />
                </svg>
                <span className="site-nav-sr-only">Search</span>
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

          <div className="site-nav-social">
            <a
              href={LINKEDIN_HREF}
              target="_blank"
              rel="noreferrer"
              className="site-nav-social-btn site-nav-linkedin"
              aria-label="Open Benjamin Schaefer LinkedIn profile"
              title="View on LinkedIn"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="site-nav-social-icon">
                <path
                  fill="currentColor"
                  d="M20.45 20.45h-3.554v-5.57c0-1.328-.026-3.037-1.851-3.037-1.852 0-2.136 1.446-2.136 2.94v5.667H9.346V9h3.414v1.561h.049c.476-.9 1.637-1.85 3.369-1.85 3.601 0 4.266 2.369 4.266 5.455v6.284ZM5.337 7.433a2.064 2.064 0 1 1 0-4.129 2.064 2.064 0 0 1 0 4.129ZM7.114 20.45H3.56V9h3.554v11.45ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.226.792 24 1.771 24h20.454C23.204 24 24 23.226 24 22.271V1.729C24 .774 23.204 0 22.225 0Z"
                />
              </svg>
            </a>

            <a
              href={GITHUB_HREF}
              target="_blank"
              rel="noreferrer"
              className="site-nav-social-btn site-nav-github"
              aria-label="Open project GitHub repository"
              title="View on GitHub"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="site-nav-social-icon">
                <path
                  fill="currentColor"
                  d="M12 .5C5.649.5.5 5.649.5 12c0 5.084 3.292 9.398 7.861 10.92.575.106.785-.25.785-.555 0-.274-.01-1-.016-1.962-3.198.695-3.873-1.541-3.873-1.541-.523-1.328-1.277-1.682-1.277-1.682-1.044-.714.079-.699.079-.699 1.154.081 1.761 1.185 1.761 1.185 1.025 1.757 2.69 1.25 3.345.956.104-.743.401-1.25.729-1.538-2.553-.291-5.238-1.277-5.238-5.683 0-1.255.448-2.281 1.183-3.085-.119-.291-.512-1.462.112-3.048 0 0 .965-.309 3.162 1.179A10.98 10.98 0 0 1 12 6.07c.975.005 1.958.132 2.875.387 2.195-1.488 3.158-1.179 3.158-1.179.626 1.586.233 2.757.114 3.048.737.804 1.181 1.83 1.181 3.085 0 4.417-2.689 5.389-5.251 5.675.413.355.781 1.055.781 2.126 0 1.536-.014 2.775-.014 3.153 0 .308.207.667.79.554C20.21 21.394 23.5 17.082 23.5 12 23.5 5.649 18.351.5 12 .5Z"
                />
              </svg>
            </a>
          </div>
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
          flex-wrap: wrap;
        }

        .site-nav-search-wrap {
          position: relative;
          flex: 1;
          min-width: 220px;
          max-width: 520px;
        }

        .site-nav-social {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }

        .site-nav-social-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 42px;
          height: 42px;
          flex-shrink: 0;
          border-radius: 9999px;
          border: 1px solid rgba(255, 255, 255, 0.35);
          background: rgba(15, 23, 42, 0.22);
          color: #ffffff;
          box-shadow: 0 2px 10px rgba(15, 23, 42, 0.2);
          transition: transform 0.2s ease, background-color 0.2s ease, box-shadow 0.2s ease, border-color 0.2s ease;
        }

        .site-nav-social-btn:hover {
          transform: translateY(-1px);
          background: rgba(15, 23, 42, 0.38);
          border-color: rgba(255, 255, 255, 0.6);
          box-shadow: 0 6px 16px rgba(15, 23, 42, 0.28);
        }

        .site-nav-social-icon {
          width: 19px;
          height: 19px;
        }

        .site-nav-linkedin {
          background: rgba(10, 102, 194, 0.35);
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

        .site-nav-pill-report {
          background: rgba(15, 23, 42, 0.26);
        }

        .site-nav-search-input:focus {
          border-color: rgba(255, 255, 255, 0.75);
          background: rgba(255, 255, 255, 0.22);
          box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.2);
        }

        .site-nav-search-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: 1px solid rgba(255, 255, 255, 0.4);
          background: rgba(15, 23, 42, 0.25);
          color: #ffffff;
          border-radius: 9999px;
          width: 40px;
          height: 40px;
          padding: 0;
          cursor: pointer;
          transition: background-color 0.2s ease, border-color 0.2s ease;
        }

        .site-nav-search-btn-icon {
          width: 18px;
          height: 18px;
        }

        .site-nav-sr-only {
          position: absolute;
          width: 1px;
          height: 1px;
          padding: 0;
          margin: -1px;
          overflow: hidden;
          clip: rect(0, 0, 0, 0);
          white-space: nowrap;
          border: 0;
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
            padding: 14px 16px;
            gap: 10px;
          }

          .site-nav-links {
            order: 1;
            flex-wrap: wrap;
          }

          .site-nav-brand {
            order: 2;
            margin-left: auto;
            font-size: 28px;
          }

          .site-nav-search-wrap {
            order: 3;
            flex-basis: 100%;
            max-width: none;
            min-width: 0;
          }

          .site-nav-social {
            order: 4;
            margin-left: auto;
          }
        }

        @media (max-width: 640px) {
          .site-nav-inner {
            padding: 12px;
            gap: 8px;
          }

          .site-nav-links {
            width: 100%;
            justify-content: center;
            order: 2;
          }

          .site-nav-pill {
            font-size: 12px;
            padding: 7px 10px;
          }

          .site-nav-brand {
            order: 1;
            margin-left: 0;
            width: 100%;
            text-align: center;
            font-size: 24px;
          }

          .site-nav-search-wrap {
            order: 3;
          }

          .site-nav-social {
            order: 3;
            margin-left: 6px;
            margin-right: 0;
            gap: 6px;
          }

          .site-nav-social-btn {
            width: 34px;
            height: 34px;
          }

          .site-nav-social-icon {
            width: 16px;
            height: 16px;
          }

          .site-nav-search-form {
            gap: 4px;
          }

          .site-nav-search-input {
            font-size: 12px;
            padding: 8px 10px;
          }

          .site-nav-search-btn {
            width: 34px;
            height: 34px;
          }

          .site-nav-search-btn-icon {
            width: 15px;
            height: 15px;
          }
        }
      `}</style>
    </>
  );
}

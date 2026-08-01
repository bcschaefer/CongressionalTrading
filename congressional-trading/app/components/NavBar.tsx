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
  { href: '/representatives', label: 'Members', isActive: (pathname) => pathname.startsWith('/representatives') || pathname.startsWith('/congressman') },
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

  const prefetchOnHover = (href: string) => {
    router.prefetch(href);
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
      <div className="h-1 bg-linear-to-r from-(--color-negative) to-(--color-accent)" />
      <header className="sticky top-0 z-50 border-b border-(--color-border) bg-white">
        <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <Link
            href="/"
            className="shrink-0 text-base font-bold text-foreground"
            aria-label="Go to Home"
            onMouseEnter={() => prefetchOnHover('/')}
          >
            InsideTrader
          </Link>

          <div className="flex flex-wrap items-center gap-5">
            {NAV_ITEMS.map((item) => {
              const active = item.isActive(pathname);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onMouseEnter={() => prefetchOnHover(item.href)}
                  className={`border-b-2 py-1 text-sm font-medium transition-all duration-150 ${
                    active
                      ? 'border-(--color-accent) text-(--color-accent)'
                      : 'border-transparent text-(--color-text-secondary) hover:border-(--color-border-strong) hover:text-(--color-accent)'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
            <a
              href={REPORT_HREF}
              target="_blank"
              rel="noreferrer"
              className="border-b-2 border-transparent py-1 text-sm font-medium text-(--color-text-secondary) transition-all duration-150 hover:border-(--color-border-strong) hover:text-(--color-accent)"
            >
              View Report
            </a>
          </div>

          <div className="relative ml-auto min-w-50 max-w-xs flex-1" ref={searchRef}>
            <form onSubmit={onSubmit} className="flex items-center" role="search" aria-label="Global search">
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => {
                  if (query.trim().length >= 2) setIsOpen(true);
                }}
                onKeyDown={onKeyDown}
                placeholder="Search stock or representative"
                className="w-full rounded-sm border border-(--color-border) bg-white px-3 py-1.5 text-sm text-foreground outline-none transition-all duration-150 placeholder:text-(--color-text-muted) focus:border-(--color-accent) focus:ring-2 focus:ring-(--color-accent)/15"
                aria-label="Search stock or representative"
              />
              <button
                type="submit"
                className="ml-1.5 inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-(--color-border) text-(--color-text-secondary) transition-all duration-150 hover:border-(--color-accent) hover:text-(--color-accent)"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                  <path
                    fill="currentColor"
                    d="M10.5 3a7.5 7.5 0 0 1 5.916 12.112l4.736 4.736a1 1 0 0 1-1.414 1.414l-4.736-4.736A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"
                  />
                </svg>
                <span className="sr-only">Search</span>
              </button>
            </form>

            {isOpen && (
              <div
                className="absolute left-0 right-0 top-[calc(100%+6px)] z-[70] overflow-hidden rounded-sm border border-(--color-border) bg-white"
                role="listbox"
                aria-label="Search results"
              >
                {loading ? (
                  <div className="px-3 py-2.5 text-sm text-(--color-text-secondary)">Searching...</div>
                ) : results.length === 0 ? (
                  <div className="px-3 py-2.5 text-sm text-(--color-text-secondary)">No matches found</div>
                ) : (
                  results.map((result, index) => (
                    <button
                      key={`${result.type}-${result.href}-${index}`}
                      type="button"
                      className={`flex w-full cursor-pointer items-center gap-2.5 border-t border-(--color-border) px-3 py-2 text-left transition-colors first:border-t-0 hover:bg-(--color-bg-subtle) ${
                        index === activeIndex ? 'bg-(--color-bg-subtle)' : ''
                      }`}
                      onMouseEnter={() => {
                        setActiveIndex(index);
                        prefetchOnHover(result.href);
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => navigateTo(result.href)}
                      role="option"
                      aria-selected={index === activeIndex}
                    >
                      <span
                        className={`inline-flex min-w-11 shrink-0 items-center justify-center rounded-sm border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${
                          result.type === 'member'
                            ? 'border-(--color-accent) text-(--color-accent)'
                            : 'border-(--color-chip-text)/40 text-(--color-chip-text)'
                        }`}
                      >
                        {result.type === 'member' ? 'REP' : 'STOCK'}
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-sm font-semibold text-foreground">{result.label}</span>
                        <span className="truncate text-xs text-(--color-text-muted)">{result.sublabel}</span>
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <a
              href={LINKEDIN_HREF}
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-(--color-border) text-(--color-text-secondary) transition-all duration-150 hover:-translate-y-0.5 hover:border-(--color-accent) hover:text-(--color-accent)"
              aria-label="Open Benjamin Schaefer LinkedIn profile"
              title="View on LinkedIn"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
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
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-(--color-border) text-(--color-text-secondary) transition-all duration-150 hover:-translate-y-0.5 hover:border-(--color-accent) hover:text-(--color-accent)"
              aria-label="Open project GitHub repository"
              title="View on GitHub"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true" className="h-4 w-4">
                <path
                  fill="currentColor"
                  d="M12 .5C5.649.5.5 5.649.5 12c0 5.084 3.292 9.398 7.861 10.92.575.106.785-.25.785-.555 0-.274-.01-1-.016-1.962-3.198.695-3.873-1.541-3.873-1.541-.523-1.328-1.277-1.682-1.277-1.682-1.044-.714.079-.699.079-.699 1.154.081 1.761 1.185 1.761 1.185 1.025 1.757 2.69 1.25 3.345.956.104-.743.401-1.25.729-1.538-2.553-.291-5.238-1.277-5.238-5.683 0-1.255.448-2.281 1.183-3.085-.119-.291-.512-1.462.112-3.048 0 0 .965-.309 3.162 1.179A10.98 10.98 0 0 1 12 6.07c.975.005 1.958.132 2.875.387 2.195-1.488 3.158-1.179 3.158-1.179.626 1.586.233 2.757.114 3.048.737.804 1.181 1.83 1.181 3.085 0 4.417-2.689 5.389-5.251 5.675.413.355.781 1.055.781 2.126 0 1.536-.014 2.775-.014 3.153 0 .308.207.667.79.554C20.21 21.394 23.5 17.082 23.5 12 23.5 5.649 18.351.5 12 .5Z"
                />
              </svg>
            </a>
          </div>
        </nav>
      </header>
    </>
  );
}

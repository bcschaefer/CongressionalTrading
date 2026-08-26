'use client';

import { useEffect, useState } from 'react';

export default function DatabaseStatusGate({ children }: { children: React.ReactNode }) {
  const [down, setDown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/health', { cache: 'no-store' })
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setDown(data.ok !== true);
      })
      .catch(() => {
        if (!cancelled) setDown(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (down) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-6 py-20 text-center">
        <p className="max-w-md text-base text-(--color-text-secondary)">
          No data available for the rest of this month. This site runs on a free database plan, and I&rsquo;ve hit its usage limit. I apologize for the disruption.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

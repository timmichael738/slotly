import { useEffect, useState, type ReactNode } from 'react';

// ── API client ─────────────────────────────────────────────────────────────
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...init.headers },
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const issues = (body as { issues?: Record<string, string[]> }).issues;
    const detail = issues
      ? Object.entries(issues)
          .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
          .join('; ')
      : '';
    throw new ApiError(
      detail || (body as { error?: string }).error || `HTTP ${res.status}`,
      res.status,
    );
  }
  return body as T;
}

export const post = <T,>(path: string, body: unknown = {}) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });

// ── Router (History API, no dependency) ────────────────────────────────────
export function navigate(to: string): void {
  history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath(): string {
  const [path, setPath] = useState(() => location.pathname);
  useEffect(() => {
    const onPop = () => setPath(location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}

export function Link({
  to,
  children,
  className,
}: {
  to: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <a
      href={to}
      className={className}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
    >
      {children}
    </a>
  );
}

// ── Time zones ─────────────────────────────────────────────────────────────
export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

const SUPPORTED_ZONES: string[] = (() => {
  const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
    .supportedValuesOf;
  // supportedValuesOf omits "UTC" itself, which is a common browser/server setting.
  return ['UTC', ...(supported ? supported('timeZone') : ['Europe/London', 'America/New_York'])];
})();

/** Time zone options, always including the currently selected one. */
export const timeZoneOptions = (selected: string): string[] =>
  SUPPORTED_ZONES.includes(selected) ? SUPPORTED_ZONES : [selected, ...SUPPORTED_ZONES];

/** YYYY-MM-DD of an instant as seen in a time zone. */
export function localDate(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

export const formatTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(
    new Date(iso),
  );

export const formatDateTime = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));

/** Groups UTC slot instants by the viewer's local date. */
export function groupByLocalDate(slots: string[], timeZone: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const slot of slots) {
    const key = localDate(slot, timeZone);
    groups.set(key, [...(groups.get(key) ?? []), slot]);
  }
  return groups;
}

/** Calendar grid (Monday-first) for a month: null for leading blanks, then YYYY-MM-DD strings. */
export function monthGrid(year: number, month: number): (string | null)[] {
  const first = new Date(Date.UTC(year, month, 1));
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: days }, (_, i) => `${year}-${pad(month + 1)}-${pad(i + 1)}`),
  ];
}

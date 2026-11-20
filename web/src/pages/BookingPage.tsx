import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { PublicEvent } from '../../../shared/types';
import {
  api,
  browserTimeZone,
  formatDateTime,
  formatTime,
  groupByLocalDate,
  Link,
  localDate,
  monthGrid,
  post,
  timeZoneOptions,
} from '../lib';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function BookingPage({ host, event }: { host: string; event: string }) {
  const [info, setInfo] = useState<PublicEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [timeZone, setTimeZone] = useState(browserTimeZone);
  const today = localDate(new Date(), timeZone);
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));
  const [slots, setSlots] = useState<string[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState<{ start: string; cancelToken: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const base = `/api/public/${encodeURIComponent(host)}/${encodeURIComponent(event)}`;

  useEffect(() => {
    api<PublicEvent>(base)
      .then(setInfo)
      .catch((e: Error) => setError(e.message));
  }, [base]);

  // Fetch a little either side of the month: the viewer's dates can straddle the host's.
  const range = useMemo(() => {
    const pad = (n: number) => String(n).padStart(2, '0');
    const from = new Date(Date.UTC(cursor.year, cursor.month, 0));
    const to = new Date(Date.UTC(cursor.year, cursor.month + 1, 1));
    const iso = (d: Date) =>
      `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return { from: iso(from), to: iso(to) };
  }, [cursor]);

  useEffect(() => {
    let cancelled = false;
    api<{ slots: string[] }>(`${base}/slots?from=${range.from}&to=${range.to}`)
      .then((r) => !cancelled && setSlots(r.slots))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [base, range]);

  const byDay = useMemo(() => groupByLocalDate(slots ?? [], timeZone), [slots, timeZone]);
  const monthLabel = new Date(Date.UTC(cursor.year, cursor.month, 1)).toLocaleDateString(
    undefined,
    {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    },
  );

  const shiftMonth = (delta: number) => {
    setCursor(({ year, month }) => {
      const d = new Date(Date.UTC(year, month + delta, 1));
      return { year: d.getUTCFullYear(), month: d.getUTCMonth() };
    });
    setDay(null);
    setSlot(null);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!slot) return;
    const form = new FormData(e.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      const { cancelToken } = await post<{ cancelToken: string }>(`${base}/book`, {
        start: slot,
        name: form.get('name'),
        email: form.get('email'),
        notes: form.get('notes') ?? '',
        timezone: timeZone,
      });
      setConfirmed({ start: slot, cancelToken });
    } catch (err) {
      setError((err as Error).message);
      setSlot(null);
      // Refresh availability: someone may have taken the slot.
      api<{ slots: string[] }>(`${base}/slots?from=${range.from}&to=${range.to}`).then((r) =>
        setSlots(r.slots),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (!info) return <p className="center muted">{error ?? 'Loading…'}</p>;

  if (confirmed) {
    return (
      <section className="card narrow confirm" aria-live="polite">
        <p className="big-check" aria-hidden="true">
          ✓
        </p>
        <h1>You're booked!</h1>
        <p>
          <strong>{info.event.title}</strong> with {info.host.name}
        </p>
        <p>{formatDateTime(confirmed.start, timeZone)}</p>
        <p className="muted">{timeZone.replace(/_/g, ' ')}</p>
        <p>
          Need to change plans?{' '}
          <Link to={`/booking/${confirmed.cancelToken}`}>Manage or cancel this booking</Link>. Save
          this link; it's the only way to cancel.
        </p>
      </section>
    );
  }

  return (
    <section className="card booking">
      <aside className="booking-info">
        <p className="muted">{info.host.name}</p>
        <h1>{info.event.title}</h1>
        <p className="muted">◷ {info.event.durationMin} min</p>
        {info.event.description && <p>{info.event.description}</p>}
        <label className="tz">
          Time zone
          <select value={timeZone} onChange={(e) => setTimeZone(e.target.value)}>
            {timeZoneOptions(timeZone).map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </label>
      </aside>

      <div className="booking-picker">
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {slot ? (
          <form className="details-form" onSubmit={submit}>
            <button type="button" className="link-button" onClick={() => setSlot(null)}>
              ← {formatDateTime(slot, timeZone)}
            </button>
            <label>
              Your name
              <input name="name" required autoComplete="name" />
            </label>
            <label>
              Email
              <input name="email" type="email" required autoComplete="email" />
            </label>
            <label>
              Anything to share beforehand? <span className="muted">(optional)</span>
              <textarea name="notes" rows={3} />
            </label>
            <button type="submit" className="primary" disabled={submitting}>
              {submitting ? 'Booking…' : 'Confirm booking'}
            </button>
          </form>
        ) : (
          <>
            <div className="month-nav">
              <button type="button" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
                ‹
              </button>
              <h2>{monthLabel}</h2>
              <button type="button" aria-label="Next month" onClick={() => shiftMonth(1)}>
                ›
              </button>
            </div>
            <div
              className={`calendar ${slots === null ? 'is-loading' : ''}`}
              role="grid"
              aria-label={monthLabel}
            >
              {WEEKDAYS.map((d) => (
                <span key={d} className="weekday" role="columnheader">
                  {d}
                </span>
              ))}
              {monthGrid(cursor.year, cursor.month).map((date, i) =>
                date ? (
                  <button
                    key={date}
                    type="button"
                    role="gridcell"
                    className={`day ${day === date ? 'selected' : ''}`}
                    disabled={!byDay.has(date)}
                    aria-pressed={day === date}
                    aria-label={`${date}${byDay.has(date) ? `, ${byDay.get(date)!.length} times available` : ', unavailable'}`}
                    onClick={() => setDay(date)}
                  >
                    {Number(date.slice(8))}
                  </button>
                ) : (
                  <span key={`blank-${i}`} />
                ),
              )}
            </div>
            {day && (
              <div className="times">
                <h3>
                  {new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                    timeZone: 'UTC',
                  })}
                </h3>
                <ul>
                  {byDay.get(day)?.map((s) => (
                    <li key={s}>
                      <button type="button" onClick={() => setSlot(s)}>
                        {formatTime(s, timeZone)}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {slots && byDay.size === 0 && (
              <p className="muted">No availability this month. Try the next one.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

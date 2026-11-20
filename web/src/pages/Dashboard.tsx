import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { AvailabilityRule, Booking, EventType, User } from '../../../shared/types';
import { api, formatDateTime, post, timeZoneOptions } from '../lib';

type Tab = 'bookings' | 'events' | 'availability';
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function Dashboard({ user }: { user: User }) {
  const [tab, setTab] = useState<Tab>('bookings');
  return (
    <section className="dashboard">
      <div className="tabs" role="tablist">
        {(['bookings', 'events', 'availability'] as Tab[]).map((t) => (
          <button
            key={t}
            role="tab"
            type="button"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t === 'events' ? 'Event types' : t[0]!.toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'bookings' && <Bookings user={user} />}
      {tab === 'events' && <EventTypes user={user} />}
      {tab === 'availability' && <Availability />}
    </section>
  );
}

function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(
    () =>
      api<T>(path)
        .then((d) => (setData(d), setError(null)))
        .catch((e: Error) => setError(e.message)),
    [path],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { data, error, setError, reload };
}

function Bookings({ user }: { user: User }) {
  const [scope, setScope] = useState<'upcoming' | 'past'>('upcoming');
  const { data, error, setError, reload } = useLoad<{ bookings: Booking[] }>(
    `/api/bookings?scope=${scope}`,
  );

  return (
    <div className="card">
      <div className="row">
        <h2>Bookings</h2>
        <span className="spacer" />
        <select
          aria-label="Show"
          value={scope}
          onChange={(e) => setScope(e.target.value as 'upcoming' | 'past')}
        >
          <option value="upcoming">Upcoming</option>
          <option value="past">Past</option>
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      {data?.bookings.length === 0 && (
        <p className="muted">No {scope} bookings yet. Share your booking page to get some!</p>
      )}
      <ul className="booking-list">
        {data?.bookings.map((b) => (
          <li key={b.id} className={b.status === 'cancelled' ? 'cancelled' : ''}>
            <div>
              <strong>{formatDateTime(b.startsAt, user.timezone)}</strong> · {b.eventTitle}
              {b.status === 'cancelled' && <span className="tag">Cancelled</span>}
              <div className="muted">
                {b.inviteeName} &lt;{b.inviteeEmail}&gt; · their time:{' '}
                {formatDateTime(b.startsAt, b.inviteeTz)}
              </div>
              {b.notes && <p className="notes">“{b.notes}”</p>}
            </div>
            {b.status === 'confirmed' && scope === 'upcoming' && (
              <button
                type="button"
                className="danger"
                onClick={() =>
                  confirm(`Cancel the booking with ${b.inviteeName}?`) &&
                  post(`/api/bookings/${b.id}/cancel`).then(reload, (e: Error) =>
                    setError(e.message),
                  )
                }
              >
                Cancel
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EventTypes({ user }: { user: User }) {
  const { data, error, setError, reload } = useLoad<{ eventTypes: EventType[] }>(
    '/api/event-types',
  );

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    try {
      await post('/api/event-types', {
        title: form.get('title'),
        slug: form.get('slug'),
        durationMin: Number(form.get('durationMin')),
        bufferMin: Number(form.get('bufferMin')),
        description: form.get('description') ?? '',
      });
      formEl.reset();
      await reload();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggle = (et: EventType) =>
    api(`/api/event-types/${et.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active: !et.active }),
    }).then(reload, (e: Error) => setError(e.message));

  return (
    <div className="card">
      <h2>Event types</h2>
      {error && <p className="error">{error}</p>}
      <ul className="event-list">
        {data?.eventTypes.map((et) => {
          const url = `${location.origin}/${user.slug}/${et.slug}`;
          return (
            <li key={et.id} className={et.active ? '' : 'inactive'}>
              <div>
                <strong>{et.title}</strong> · {et.durationMin} min
                {et.bufferMin > 0 && ` + ${et.bufferMin} min buffer`}
                <div>
                  <a href={url} target="_blank" rel="noreferrer">
                    {url.replace(/^https?:\/\//, '')}
                  </a>
                </div>
              </div>
              <div className="actions">
                <button type="button" onClick={() => navigator.clipboard?.writeText(url)}>
                  Copy link
                </button>
                <button type="button" onClick={() => void toggle(et)}>
                  {et.active ? 'Turn off' : 'Turn on'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      <form className="grid-form" onSubmit={create}>
        <h3>New event type</h3>
        <label>
          Title
          <input name="title" required placeholder="Intro call" />
        </label>
        <label>
          URL slug
          <input name="slug" required pattern="[a-z0-9][a-z0-9-]*[a-z0-9]" placeholder="intro" />
        </label>
        <label>
          Duration (min)
          <input name="durationMin" type="number" min={5} max={480} defaultValue={30} required />
        </label>
        <label>
          Buffer after (min)
          <input name="bufferMin" type="number" min={0} max={120} defaultValue={0} />
        </label>
        <label className="wide">
          Description
          <textarea name="description" rows={2} />
        </label>
        <button type="submit" className="primary">
          Create
        </button>
      </form>
    </div>
  );
}

function Availability() {
  const { data, error, setError } = useLoad<{ timezone: string; rules: AvailabilityRule[] }>(
    '/api/availability',
  );
  const [draft, setDraft] = useState<{ timezone: string; rules: AvailabilityRule[] } | null>(null);
  const [saved, setSaved] = useState(false);
  const current = draft ?? data;
  if (!current) return <p className="muted">{error ?? 'Loading…'}</p>;

  const update = (rules: AvailabilityRule[]) => {
    setDraft({ ...current, rules });
    setSaved(false);
  };

  const save = async () => {
    try {
      await api('/api/availability', { method: 'PUT', body: JSON.stringify(current) });
      setSaved(true);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="card">
      <h2>Weekly availability</h2>
      {error && <p className="error">{error}</p>}
      <label className="tz">
        Time zone
        <select
          value={current.timezone}
          onChange={(e) => (setDraft({ ...current, timezone: e.target.value }), setSaved(false))}
        >
          {timeZoneOptions(current.timezone).map((tz) => (
            <option key={tz}>{tz}</option>
          ))}
        </select>
      </label>
      <ul className="availability">
        {DAYS.map((name, i) => {
          const weekday = i + 1;
          const rule = current.rules.find((r) => r.weekday === weekday);
          const others = current.rules.filter((r) => r.weekday !== weekday);
          return (
            <li key={name}>
              <label className="day-toggle">
                <input
                  type="checkbox"
                  checked={!!rule}
                  onChange={(e) =>
                    update(
                      e.target.checked
                        ? [...others, { weekday, start: '09:00', end: '17:00' }]
                        : others,
                    )
                  }
                />
                {name}
              </label>
              {rule ? (
                <span className="hours">
                  <input
                    type="time"
                    aria-label={`${name} start`}
                    value={rule.start}
                    onChange={(e) => update([...others, { ...rule, start: e.target.value }])}
                  />
                  –
                  <input
                    type="time"
                    aria-label={`${name} end`}
                    value={rule.end}
                    onChange={(e) => update([...others, { ...rule, end: e.target.value }])}
                  />
                </span>
              ) : (
                <span className="muted">Unavailable</span>
              )}
            </li>
          );
        })}
      </ul>
      <div className="row">
        <button type="button" className="primary" onClick={() => void save()}>
          Save
        </button>
        {saved && <span className="saved">✓ Saved</span>}
      </div>
    </div>
  );
}

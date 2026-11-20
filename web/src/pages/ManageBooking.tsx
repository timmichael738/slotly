import { useEffect, useState } from 'react';
import type { Booking } from '../../../shared/types';
import { api, formatDateTime, post } from '../lib';

/** Reached via the secret link shown after booking; no account needed to cancel. */
export function ManageBooking({ token }: { token: string }) {
  const [booking, setBooking] = useState<(Booking & { hostName: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Booking & { hostName: string }>(`/api/public/bookings/${encodeURIComponent(token)}`)
      .then(setBooking)
      .catch((e: Error) => setError(e.message));
  }, [token]);

  if (!booking) return <p className="center muted">{error ?? 'Loading…'}</p>;

  const cancel = async () => {
    try {
      await post(`/api/public/bookings/${encodeURIComponent(token)}/cancel`);
      setBooking({ ...booking, status: 'cancelled' });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <section className="card narrow">
      <h1>{booking.eventTitle}</h1>
      <p>
        with <strong>{booking.hostName}</strong>
      </p>
      <p>{formatDateTime(booking.startsAt, booking.inviteeTz)}</p>
      <p className="muted">{booking.inviteeTz.replace(/_/g, ' ')}</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {booking.status === 'cancelled' ? (
        <p className="tag">This booking is cancelled.</p>
      ) : (
        <button type="button" className="danger" onClick={() => void cancel()}>
          Cancel booking
        </button>
      )}
    </section>
  );
}

import { DateTime, Interval } from 'luxon';
import type { AvailabilityRule } from '../../shared/types.js';

export interface SlotQuery {
  /** Host's IANA time zone; availability rules are wall-clock times in this zone. */
  hostTz: string;
  rules: AvailabilityRule[];
  durationMin: number;
  bufferMin: number;
  /** Existing blocked ranges (already including their buffers). */
  busy: { start: Date; end: Date }[];
  /** Inclusive range of host-local dates to generate, YYYY-MM-DD. */
  from: string;
  to: string;
  now: Date;
  /** Bookings must be made at least this far ahead. */
  minNoticeMin?: number;
  /** Slot start times are aligned to this step (defaults to the duration, max 30 min). */
  stepMin?: number;
}

/**
 * Computes bookable start times (UTC ISO strings) for a date range.
 *
 * Every rule is resolved per *date* in the host's zone with Luxon, so DST transitions are handled:
 * "09:00–17:00 Europe/London" stays 09:00–17:00 local on both sides of the clock change, even though
 * the UTC offset moves. Nonexistent local times (spring-forward gaps) are skipped by Luxon's
 * forward-shift, and a slot is offered only if it and its buffer fit inside the window without
 * overlapping any busy range.
 */
export function availableSlots(q: SlotQuery): string[] {
  const step = q.stepMin ?? Math.min(q.durationMin, 30);
  const earliest = DateTime.fromJSDate(q.now).plus({ minutes: q.minNoticeMin ?? 120 });
  const busy = q.busy.map((b) => Interval.fromDateTimes(b.start, b.end));
  const slots: string[] = [];

  let day = DateTime.fromISO(q.from, { zone: q.hostTz }).startOf('day');
  const last = DateTime.fromISO(q.to, { zone: q.hostTz }).startOf('day');
  if (!day.isValid || !last.isValid || last.diff(day, 'days').days > 62) return [];

  for (; day <= last; day = day.plus({ days: 1 })) {
    for (const rule of q.rules.filter((r) => r.weekday === day.weekday)) {
      const windowStart = at(day, rule.start);
      const windowEnd = at(day, rule.end);
      for (
        let start = windowStart;
        start.plus({ minutes: q.durationMin }) <= windowEnd;
        start = start.plus({ minutes: step })
      ) {
        if (start < earliest) continue;
        // The buffer must also be free so the host gets a break after the meeting.
        const blocked = Interval.fromDateTimes(
          start,
          start.plus({ minutes: q.durationMin + q.bufferMin }),
        );
        if (busy.some((b) => b.overlaps(blocked))) continue;
        slots.push(start.toUTC().toISO({ suppressMilliseconds: true })!);
      }
    }
  }
  return [...new Set(slots)].sort();
}

function at(day: DateTime, hhmm: string): DateTime {
  const [hour, minute] = hhmm.split(':').map(Number);
  return day.set({ hour, minute, second: 0, millisecond: 0 });
}

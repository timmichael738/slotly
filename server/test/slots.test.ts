import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/auth.js';
import { availableSlots, type SlotQuery } from '../src/slots.js';

const base: SlotQuery = {
  hostTz: 'UTC',
  rules: [{ weekday: 1, start: '09:00', end: '11:00' }], // Mondays
  durationMin: 30,
  bufferMin: 0,
  busy: [],
  from: '2026-12-07', // a Monday
  to: '2026-12-07',
  now: new Date('2026-12-01T00:00:00Z'),
};

describe('availableSlots', () => {
  it('generates slots inside the window', () => {
    expect(availableSlots(base)).toEqual([
      '2026-12-07T09:00:00Z',
      '2026-12-07T09:30:00Z',
      '2026-12-07T10:00:00Z',
      '2026-12-07T10:30:00Z',
    ]);
  });

  it('skips days without rules', () => {
    expect(availableSlots({ ...base, from: '2026-12-08', to: '2026-12-13' })).toEqual([]);
  });

  it('resolves wall-clock rules in the host time zone', () => {
    const slots = availableSlots({ ...base, hostTz: 'America/New_York' });
    expect(slots[0]).toBe('2026-12-07T14:00:00Z'); // 09:00 EST = 14:00 UTC
  });

  it('keeps local hours stable across a DST change', () => {
    const rules = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      start: '09:00',
      end: '09:30',
    }));
    const slots = availableSlots({
      ...base,
      hostTz: 'Europe/London',
      rules,
      from: '2026-03-28', // UK clocks go forward on Sunday 29 March 2026
      to: '2026-03-30',
      now: new Date('2026-03-01T00:00:00Z'),
    });
    expect(slots).toEqual([
      '2026-03-28T09:00:00Z', // GMT
      '2026-03-29T08:00:00Z', // BST: still 09:00 local
      '2026-03-30T08:00:00Z',
    ]);
  });

  it("blocks slots that overlap busy ranges, including the new slot's buffer", () => {
    const slots = availableSlots({
      ...base,
      bufferMin: 15,
      busy: [{ start: new Date('2026-12-07T10:00:00Z'), end: new Date('2026-12-07T10:30:00Z') }],
    });
    // 09:30 + 30 min + 15 min buffer would run into the 10:00 booking.
    expect(slots).toEqual(['2026-12-07T09:00:00Z', '2026-12-07T10:30:00Z']);
  });

  it('enforces minimum notice', () => {
    const slots = availableSlots({
      ...base,
      now: new Date('2026-12-07T08:00:00Z'),
      minNoticeMin: 120,
    });
    expect(slots[0]).toBe('2026-12-07T10:00:00Z');
  });

  it('refuses unreasonably large ranges', () => {
    expect(availableSlots({ ...base, to: '2027-06-01' })).toEqual([]);
  });
});

describe('password hashing', () => {
  it('verifies the right password and rejects others', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^scrypt\$32768\$8\$1\$/);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('wrong password!', hash)).toBe(false);
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password')).not.toBe(await hashPassword('same password'));
  });
});

import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createPool, migrate } from '../src/db.js';

const DATABASE_URL = process.env.DATABASE_URL;
const NOW = new Date('2026-12-01T00:00:00Z');
const MONDAY_9AM_UTC = '2026-12-07T09:00:00Z';

describe.skipIf(!DATABASE_URL)('API (integration)', () => {
  let pool: pg.Pool;
  let app: FastifyInstance;

  beforeAll(async () => {
    pool = createPool(DATABASE_URL!);
    await migrate(pool);
    app = await buildApp({ pool, logger: false, now: () => NOW });
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE users, sessions, event_types, availability_rules, bookings RESTART IDENTITY CASCADE',
    );
  });
  afterAll(async () => {
    await app.close();
    await pool.end();
  });

  const signup = async (overrides: Record<string, string> = {}) => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/signup',
      payload: {
        name: 'Ada Lovelace',
        email: 'ada@example.com',
        password: 'analytical-engine',
        slug: 'ada',
        timezone: 'UTC',
        ...overrides,
      },
    });
    const cookie = res.cookies.find((c) => c.name === 'sid');
    return { res, cookie: cookie ? `sid=${cookie.value}` : '' };
  };

  const book = (start = MONDAY_9AM_UTC, email = 'grace@example.com') =>
    app.inject({
      method: 'POST',
      url: '/api/public/ada/30min/book',
      payload: { start, name: 'Grace Hopper', email, timezone: 'America/New_York', notes: '' },
    });

  describe('auth', () => {
    it('signs up with defaults and a secure session cookie', async () => {
      const { res, cookie } = await signup();
      expect(res.statusCode).toBe(201);
      const setCookie = String(res.headers['set-cookie']);
      expect(setCookie).toMatch(/HttpOnly/);
      expect(setCookie).toMatch(/SameSite=Lax/);
      expect(res.json()).not.toHaveProperty('password_hash');

      const types = await app.inject({ url: '/api/event-types', headers: { cookie } });
      expect(types.json().eventTypes).toMatchObject([{ slug: '30min', durationMin: 30 }]);
      const availability = await app.inject({ url: '/api/availability', headers: { cookie } });
      expect(availability.json().rules).toHaveLength(5);
    });

    it('rejects duplicate emails and weak passwords', async () => {
      await signup();
      expect((await signup({ slug: 'ada2' })).res.statusCode).toBe(409);
      expect(
        (await signup({ email: 'x@example.com', slug: 'x-y', password: 'short' })).res.statusCode,
      ).toBe(400);
    });

    it('logs in, rejects bad passwords, and logs out', async () => {
      await signup();
      const bad = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'ada@example.com', password: 'nope-nope-nope' },
      });
      expect(bad.statusCode).toBe(401);

      const ok = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'ADA@example.com', password: 'analytical-engine' }, // emails are case-insensitive
      });
      expect(ok.statusCode).toBe(200);
      const cookie = `sid=${ok.cookies.find((c) => c.name === 'sid')!.value}`;
      expect((await app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(200);

      await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie } });
      expect((await app.inject({ url: '/api/me', headers: { cookie } })).statusCode).toBe(401);
    });

    it('rejects non-JSON mutations (CSRF defence)', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'content-type': 'text/plain' },
        payload: '{"email":"a@b.co","password":"x"}',
      });
      expect(res.statusCode).toBe(415);
    });
  });

  describe('booking', () => {
    it('lists slots in the host time zone and books one', async () => {
      await signup();
      const slots = await app.inject({
        url: '/api/public/ada/30min/slots?from=2026-12-07&to=2026-12-07',
      });
      expect(slots.json().slots).toHaveLength(16); // 09:00–17:00, every 30 min
      expect(slots.json().slots[0]).toBe(MONDAY_9AM_UTC);

      const res = await book();
      expect(res.statusCode).toBe(201);
      expect(res.json().cancelToken).toBeTruthy();

      const after = await app.inject({
        url: '/api/public/ada/30min/slots?from=2026-12-07&to=2026-12-07',
      });
      expect(after.json().slots).not.toContain(MONDAY_9AM_UTC);
    });

    it('rejects times the host does not offer', async () => {
      await signup();
      expect((await book('2026-12-07T09:10:00Z')).statusCode).toBe(409); // off-grid
      expect((await book('2026-12-06T10:00:00Z')).statusCode).toBe(409); // Sunday
    });

    it('lets exactly one of many concurrent requests win a slot', async () => {
      await signup();
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => book(MONDAY_9AM_UTC, `guest${i}@example.com`)),
      );
      expect(results.filter((r) => r.statusCode === 201)).toHaveLength(1);
      expect(results.filter((r) => r.statusCode === 409)).toHaveLength(7);
    });

    it('cancels via the secret link and frees the slot', async () => {
      await signup();
      const { cancelToken } = (await book()).json();
      const details = await app.inject({ url: `/api/public/bookings/${cancelToken}` });
      expect(details.json()).toMatchObject({
        inviteeName: 'Grace Hopper',
        hostName: 'Ada Lovelace',
        status: 'confirmed',
      });

      const cancel = await app.inject({
        method: 'POST',
        url: `/api/public/bookings/${cancelToken}/cancel`,
      });
      expect(cancel.statusCode).toBe(204);
      expect((await book()).statusCode).toBe(201);
    });

    it('shows bookings only to their host', async () => {
      const { cookie } = await signup();
      const other = await signup({ email: 'bob@example.com', slug: 'bob' });
      await book();
      const mine = await app.inject({ url: '/api/bookings', headers: { cookie } });
      const theirs = await app.inject({ url: '/api/bookings', headers: { cookie: other.cookie } });
      expect(mine.json().bookings).toHaveLength(1);
      expect(theirs.json().bookings).toHaveLength(0);
    });
  });

  describe('host settings', () => {
    it('updates availability and event types', async () => {
      const { cookie } = await signup();
      const put = await app.inject({
        method: 'PUT',
        url: '/api/availability',
        headers: { cookie },
        payload: {
          timezone: 'Europe/Berlin',
          rules: [{ weekday: 1, start: '10:00', end: '11:00' }],
        },
      });
      expect(put.statusCode).toBe(200);

      const created = await app.inject({
        method: 'POST',
        url: '/api/event-types',
        headers: { cookie },
        payload: { title: 'Deep dive', slug: 'deep-dive', durationMin: 60, bufferMin: 15 },
      });
      expect(created.statusCode).toBe(201);

      const slots = await app.inject({
        url: '/api/public/ada/deep-dive/slots?from=2026-12-07&to=2026-12-07',
      });
      expect(slots.json().slots).toEqual(['2026-12-07T09:00:00Z']); // 10:00 CET

      const dup = await app.inject({
        method: 'POST',
        url: '/api/event-types',
        headers: { cookie },
        payload: { title: 'Again', slug: 'deep-dive', durationMin: 30 },
      });
      expect(dup.statusCode).toBe(409);
    });

    it('requires authentication', async () => {
      expect((await app.inject({ url: '/api/event-types' })).statusCode).toBe(401);
    });
  });
});

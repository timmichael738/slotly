import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, {
  type FastifyReply,
  type FastifyRequest,
  type FastifyServerOptions,
} from 'fastify';
import { DateTime } from 'luxon';
import type pg from 'pg';
import { z } from 'zod';
import {
  availabilitySchema,
  bookingSchema,
  eventTypeSchema,
  loginSchema,
  signupSchema,
  type PublicEvent,
  type User,
} from '../../shared/types.js';
import { DUMMY_HASH_PROMISE, hashPassword, hashToken, newToken, verifyPassword } from './auth.js';
import { isExclusionViolation, isUniqueViolation } from './db.js';
import { Repo } from './repo.js';
import { availableSlots } from './slots.js';

const WEB_DIR = fileURLToPath(new URL('../../web/', import.meta.url));
const SESSION_COOKIE = 'sid';
const SESSION_TTL_MS = 30 * 24 * 60 * 60_000;
const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

declare module 'fastify' {
  interface FastifyRequest {
    user: User | null;
  }
}

export interface AppOptions {
  pool: pg.Pool;
  secureCookies?: boolean;
  logger?: FastifyServerOptions['logger'];
  now?: () => Date;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** Tiny fixed-window limiter for login attempts per IP (single-instance; use Redis when scaling out). */
function rateLimiter(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string): boolean => {
    const now = Date.now();
    const entry = hits.get(key);
    if (!entry || entry.resetAt < now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      if (hits.size > 10_000) hits.clear();
      return true;
    }
    return ++entry.count <= limit;
  };
}

export async function buildApp({
  pool,
  secureCookies = false,
  logger = true,
  now = () => new Date(),
}: AppOptions) {
  const app = Fastify({ logger, trustProxy: true });
  const repo = new Repo(pool);
  const allowLogin = rateLimiter(10, 15 * 60_000);

  // CSRF defence: mutations must be JSON. A cross-site <form> can only send urlencoded,
  // multipart or text/plain, and the session cookie is SameSite=Lax on top of that.
  app.removeContentTypeParser('text/plain');
  await app.register(fastifyCookie);
  app.decorateRequest('user', null);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) {
      return reply
        .code(400)
        .send({ error: 'Validation failed', issues: z.flattenError(error).fieldErrors });
    }
    if (error instanceof HttpError)
      return reply.code(error.statusCode).send({ error: error.message });
    if ((error as { statusCode?: number }).statusCode === 415) {
      return reply.code(415).send({ error: 'Requests must be JSON' });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'Internal Server Error' });
  });

  app.addHook('onRequest', async (request) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) request.user = await repo.userBySession(hashToken(token));
  });

  const startSession = async (reply: FastifyReply, userId: string) => {
    const { token, hash } = newToken();
    await repo.createSession(userId, hash, SESSION_TTL_MS);
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: secureCookies,
      path: '/',
      maxAge: SESSION_TTL_MS / 1000,
    });
  };

  const requireUser = (request: FastifyRequest): User => {
    if (!request.user) throw new HttpError(401, 'Sign in required');
    return request.user;
  };

  app.get('/api/health', async () => ({ status: 'ok' }));

  // ── Auth ────────────────────────────────────────────────────────────────
  app.post('/api/auth/signup', async (request, reply) => {
    const input = signupSchema.parse(request.body);
    try {
      const user = await repo.createUser(input, await hashPassword(input.password));
      await startSession(reply, user.id);
      return reply.code(201).send(user);
    } catch (error) {
      if (isUniqueViolation(error))
        throw new HttpError(409, 'That email or page URL is already taken');
      throw error;
    }
  });

  app.post('/api/auth/login', async (request, reply) => {
    if (!allowLogin(request.ip))
      throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
    const { email, password } = loginSchema.parse(request.body);
    const user = await repo.userWithHashByEmail(email);
    // Always run scrypt, even for unknown emails, so response time doesn't reveal which accounts exist.
    const valid = await verifyPassword(password, user?.password_hash ?? (await DUMMY_HASH_PROMISE));
    if (!user || !valid) throw new HttpError(401, 'Incorrect email or password');
    await startSession(reply, user.id);
    const { password_hash: _hash, ...publicUser } = user;
    return publicUser;
  });

  app.post('/api/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await repo.deleteSession(hashToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return reply.code(204).send();
  });

  app.get('/api/me', async (request) => requireUser(request));

  // ── Host: event types, availability, bookings ───────────────────────────
  app.get('/api/event-types', async (request) => ({
    eventTypes: await repo.listEventTypes(requireUser(request).id),
  }));

  app.post('/api/event-types', async (request, reply) => {
    const user = requireUser(request);
    try {
      return reply
        .code(201)
        .send(await repo.createEventType(user.id, eventTypeSchema.parse(request.body)));
    } catch (error) {
      if (isUniqueViolation(error))
        throw new HttpError(409, 'You already have an event with that URL');
      throw error;
    }
  });

  app.patch('/api/event-types/:id', async (request) => {
    const user = requireUser(request);
    const { id } = z.object({ id: z.string().regex(/^\d+$/) }).parse(request.params);
    const updated = await repo.updateEventType(
      user.id,
      id,
      eventTypeSchema.partial().parse(request.body),
    );
    if (!updated) throw new HttpError(404, 'Event type not found');
    return updated;
  });

  app.delete('/api/event-types/:id', async (request, reply) => {
    const user = requireUser(request);
    const { id } = z.object({ id: z.string().regex(/^\d+$/) }).parse(request.params);
    if (!(await repo.deleteEventType(user.id, id)))
      throw new HttpError(404, 'Event type not found');
    return reply.code(204).send();
  });

  app.get('/api/availability', async (request) => {
    const user = requireUser(request);
    return { timezone: user.timezone, rules: await repo.availability(user.id) };
  });

  app.put('/api/availability', async (request) => {
    const user = requireUser(request);
    const { timezone, rules } = availabilitySchema.parse(request.body);
    await repo.replaceAvailability(user.id, timezone, rules);
    return { timezone, rules };
  });

  app.get('/api/bookings', async (request) => {
    const user = requireUser(request);
    const { scope } = z
      .object({ scope: z.enum(['upcoming', 'past']).default('upcoming') })
      .parse(request.query);
    return { bookings: await repo.listBookings(user.id, scope === 'upcoming') };
  });

  app.post('/api/bookings/:id/cancel', async (request, reply) => {
    const user = requireUser(request);
    const { id } = z.object({ id: z.string().regex(/^\d+$/) }).parse(request.params);
    if (!(await repo.cancelBooking({ id, userId: user.id })))
      throw new HttpError(404, 'Booking not found');
    return reply.code(204).send();
  });

  // ── Public booking flow ─────────────────────────────────────────────────
  const loadPublic = async (request: FastifyRequest) => {
    const { host, event } = z.object({ host: z.string(), event: z.string() }).parse(request.params);
    const found = await repo.publicEvent(host, event);
    if (!found) throw new HttpError(404, 'This booking page does not exist');
    return found;
  };

  const computeSlots = async (
    e: Awaited<ReturnType<typeof loadPublic>>,
    from: string,
    to: string,
  ) => {
    const zone = e.timezone;
    const rangeStart = DateTime.fromISO(from, { zone }).startOf('day');
    const rangeEnd = DateTime.fromISO(to, { zone }).endOf('day');
    if (!rangeStart.isValid || !rangeEnd.isValid || rangeEnd < rangeStart) {
      throw new HttpError(400, 'Invalid date range');
    }
    if (rangeEnd.diff(rangeStart, 'days').days > 62)
      throw new HttpError(400, 'Range too large (max 62 days)');
    const busy = await repo.busyRanges(
      e.user_id,
      rangeStart.minus({ hours: 12 }).toJSDate(),
      rangeEnd.plus({ hours: 12 }).toJSDate(),
    );
    return availableSlots({
      hostTz: zone,
      rules: await repo.availability(e.user_id),
      durationMin: e.duration_min,
      bufferMin: e.buffer_min,
      busy,
      from,
      to,
      now: now(),
    });
  };

  app.get('/api/public/:host/:event', async (request): Promise<PublicEvent> => {
    const e = await loadPublic(request);
    return {
      host: { name: e.host_name, slug: e.host_slug, timezone: e.timezone },
      event: {
        title: e.title,
        slug: e.slug,
        description: e.description,
        durationMin: e.duration_min,
      },
    };
  });

  app.get('/api/public/:host/:event/slots', async (request) => {
    const e = await loadPublic(request);
    const { from, to } = z.object({ from: dateParam, to: dateParam }).parse(request.query);
    return { slots: await computeSlots(e, from, to) };
  });

  app.post('/api/public/:host/:event/book', async (request, reply) => {
    const e = await loadPublic(request);
    const input = bookingSchema.parse(request.body);
    const start = DateTime.fromISO(input.start, { setZone: true }).toUTC();

    // Only accept times the host actually offers; clients can't book arbitrary times.
    const hostDay = start.setZone(e.timezone).toISODate()!;
    const offered = await computeSlots(e, hostDay, hostDay);
    if (!offered.includes(start.toISO({ suppressMilliseconds: true })!)) {
      throw new HttpError(409, 'That time is no longer available. Please pick another slot.');
    }

    const { token, hash } = newToken();
    try {
      const id = await repo.createBooking({
        userId: e.user_id,
        eventTypeId: e.event_id,
        start: start.toJSDate(),
        end: start.plus({ minutes: e.duration_min }).toJSDate(),
        blockedEnd: start.plus({ minutes: e.duration_min + e.buffer_min }).toJSDate(),
        name: input.name,
        email: input.email,
        timezone: input.timezone,
        notes: input.notes,
        cancelTokenHash: hash,
      });
      return reply.code(201).send({ id, cancelToken: token });
    } catch (error) {
      // Two people raced for the same slot: the exclusion constraint let exactly one win.
      if (isExclusionViolation(error))
        throw new HttpError(409, 'Someone just booked that time. Please pick another slot.');
      throw error;
    }
  });

  app.get('/api/public/bookings/:token', async (request) => {
    const { token } = z.object({ token: z.string().min(20) }).parse(request.params);
    const booking = await repo.bookingByCancelToken(hashToken(token));
    if (!booking) throw new HttpError(404, 'Booking not found');
    return booking;
  });

  app.post('/api/public/bookings/:token/cancel', async (request, reply) => {
    const { token } = z.object({ token: z.string().min(20) }).parse(request.params);
    if (!(await repo.cancelBooking({ tokenHash: hashToken(token) }))) {
      throw new HttpError(409, 'This booking can no longer be cancelled');
    }
    return reply.code(204).send();
  });

  // ── SPA ─────────────────────────────────────────────────────────────────
  if (existsSync(new URL('../../web/assets/', import.meta.url))) {
    await app.register(fastifyStatic, { root: WEB_DIR });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET' && !request.url.startsWith('/api/'))
        return reply.sendFile('index.html');
      return reply.code(404).send({ error: 'Not Found' });
    });
  }

  return app;
}

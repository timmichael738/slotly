import type pg from 'pg';
import type {
  AvailabilityRule,
  Booking,
  EventType,
  EventTypeInput,
  SignupInput,
  User,
} from '../../shared/types.js';

/** All SQL lives here; route handlers stay focused on HTTP concerns. */
export class Repo {
  constructor(readonly pool: pg.Pool) {}

  async createUser(input: SignupInput, passwordHash: string): Promise<User> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<User>(
        `INSERT INTO users (email, name, slug, password_hash, timezone) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, name, slug, timezone`,
        [input.email, input.name, input.slug, passwordHash, input.timezone],
      );
      const user = rows[0]!;
      // Sensible defaults so a new host has a working booking page immediately.
      await client.query(
        `INSERT INTO availability_rules (user_id, weekday, start_time, end_time)
         SELECT $1, d, '09:00', '17:00' FROM generate_series(1, 5) AS d`,
        [user.id],
      );
      await client.query(
        `INSERT INTO event_types (user_id, slug, title, description, duration_min)
         VALUES ($1, '30min', '30 minute meeting', 'A quick call to connect.', 30)`,
        [user.id],
      );
      await client.query('COMMIT');
      return user;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async userWithHashByEmail(email: string) {
    const { rows } = await this.pool.query<User & { password_hash: string }>(
      'SELECT id, email, name, slug, timezone, password_hash FROM users WHERE email = $1',
      [email],
    );
    return rows[0] ?? null;
  }

  async createSession(userId: string, tokenHash: Buffer, ttlMs: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval)`,
      [tokenHash, userId, ttlMs],
    );
  }

  async userBySession(tokenHash: Buffer): Promise<User | null> {
    const { rows } = await this.pool.query<User>(
      `SELECT u.id, u.email, u.name, u.slug, u.timezone FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async deleteSession(tokenHash: Buffer): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  async listEventTypes(userId: string): Promise<EventType[]> {
    const { rows } = await this.pool.query<EventType>(
      `SELECT id, slug, title, description, duration_min AS "durationMin", buffer_min AS "bufferMin", active
       FROM event_types WHERE user_id = $1 ORDER BY duration_min, title`,
      [userId],
    );
    return rows;
  }

  async createEventType(userId: string, e: EventTypeInput): Promise<EventType> {
    const { rows } = await this.pool.query<EventType>(
      `INSERT INTO event_types (user_id, slug, title, description, duration_min, buffer_min, active)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, slug, title, description, duration_min AS "durationMin", buffer_min AS "bufferMin", active`,
      [userId, e.slug, e.title, e.description, e.durationMin, e.bufferMin, e.active],
    );
    return rows[0]!;
  }

  async updateEventType(
    userId: string,
    id: string,
    e: Partial<EventTypeInput>,
  ): Promise<EventType | null> {
    const { rows } = await this.pool.query<EventType>(
      `UPDATE event_types SET
         slug = COALESCE($3, slug), title = COALESCE($4, title), description = COALESCE($5, description),
         duration_min = COALESCE($6, duration_min), buffer_min = COALESCE($7, buffer_min), active = COALESCE($8, active)
       WHERE id = $1 AND user_id = $2
       RETURNING id, slug, title, description, duration_min AS "durationMin", buffer_min AS "bufferMin", active`,
      [id, userId, e.slug, e.title, e.description, e.durationMin, e.bufferMin, e.active],
    );
    return rows[0] ?? null;
  }

  async deleteEventType(userId: string, id: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      'DELETE FROM event_types WHERE id = $1 AND user_id = $2',
      [id, userId],
    );
    return rowCount === 1;
  }

  async availability(userId: string): Promise<AvailabilityRule[]> {
    const { rows } = await this.pool.query<AvailabilityRule>(
      `SELECT weekday, to_char(start_time, 'HH24:MI') AS start, to_char(end_time, 'HH24:MI') AS "end"
       FROM availability_rules WHERE user_id = $1 ORDER BY weekday, start_time`,
      [userId],
    );
    return rows;
  }

  async replaceAvailability(
    userId: string,
    timezone: string,
    rules: AvailabilityRule[],
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE users SET timezone = $2 WHERE id = $1', [userId, timezone]);
      await client.query('DELETE FROM availability_rules WHERE user_id = $1', [userId]);
      for (const r of rules) {
        await client.query(
          'INSERT INTO availability_rules (user_id, weekday, start_time, end_time) VALUES ($1, $2, $3, $4)',
          [userId, r.weekday, r.start, r.end],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async publicEvent(hostSlug: string, eventSlug: string) {
    const { rows } = await this.pool.query<{
      user_id: string;
      host_name: string;
      host_slug: string;
      timezone: string;
      event_id: string;
      title: string;
      slug: string;
      description: string;
      duration_min: number;
      buffer_min: number;
    }>(
      `SELECT u.id AS user_id, u.name AS host_name, u.slug AS host_slug, u.timezone,
              e.id AS event_id, e.title, e.slug, e.description, e.duration_min, e.buffer_min
       FROM users u JOIN event_types e ON e.user_id = u.id
       WHERE u.slug = $1 AND e.slug = $2 AND e.active`,
      [hostSlug, eventSlug],
    );
    return rows[0] ?? null;
  }

  async busyRanges(userId: string, from: Date, to: Date) {
    const { rows } = await this.pool.query<{ start: Date; end: Date }>(
      `SELECT lower(blocked) AS start, upper(blocked) AS "end" FROM bookings
       WHERE user_id = $1 AND status = 'confirmed' AND blocked && tstzrange($2, $3)`,
      [userId, from, to],
    );
    return rows;
  }

  async createBooking(b: {
    userId: string;
    eventTypeId: string;
    start: Date;
    end: Date;
    blockedEnd: Date;
    name: string;
    email: string;
    timezone: string;
    notes: string;
    cancelTokenHash: Buffer;
  }): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO bookings (user_id, event_type_id, starts_at, ends_at, blocked, invitee_name, invitee_email, invitee_tz, notes, cancel_token_hash)
       VALUES ($1, $2, $3, $4, tstzrange($3, $5), $6, $7, $8, $9, $10) RETURNING id`,
      [
        b.userId,
        b.eventTypeId,
        b.start,
        b.end,
        b.blockedEnd,
        b.name,
        b.email,
        b.timezone,
        b.notes,
        b.cancelTokenHash,
      ],
    );
    return rows[0]!.id;
  }

  private bookingSelect = `SELECT b.id, e.title AS "eventTitle", b.starts_at AS "startsAt", b.ends_at AS "endsAt",
      b.invitee_name AS "inviteeName", b.invitee_email AS "inviteeEmail", b.invitee_tz AS "inviteeTz",
      b.notes, b.status FROM bookings b JOIN event_types e ON e.id = b.event_type_id`;

  async listBookings(userId: string, upcoming: boolean): Promise<Booking[]> {
    const { rows } = await this.pool.query<Booking>(
      `${this.bookingSelect} WHERE b.user_id = $1 AND ${upcoming ? 'b.ends_at >= now()' : 'b.ends_at < now()'}
       ORDER BY b.starts_at ${upcoming ? 'ASC' : 'DESC'} LIMIT 200`,
      [userId],
    );
    return rows;
  }

  async bookingByCancelToken(tokenHash: Buffer) {
    const { rows } = await this.pool.query<Booking & { hostName: string }>(
      `${this.bookingSelect.replace('b.status FROM', 'b.status, u.name AS "hostName" FROM')}
       JOIN users u ON u.id = b.user_id WHERE b.cancel_token_hash = $1`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  async cancelBooking(
    where: { tokenHash: Buffer } | { id: string; userId: string },
  ): Promise<boolean> {
    const { rowCount } =
      'tokenHash' in where
        ? await this.pool.query(
            `UPDATE bookings SET status = 'cancelled' WHERE cancel_token_hash = $1 AND status = 'confirmed' AND starts_at > now()`,
            [where.tokenHash],
          )
        : await this.pool.query(
            `UPDATE bookings SET status = 'cancelled' WHERE id = $1 AND user_id = $2 AND status = 'confirmed'`,
            [where.id, where.userId],
          );
    return rowCount === 1;
  }
}

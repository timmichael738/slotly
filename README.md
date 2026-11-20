# Slotly

[![CI](https://github.com/timmichael738/slotly/actions/workflows/ci.yml/badge.svg)](https://github.com/timmichael738/slotly/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791)
![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)

**Scheduling without the back-and-forth.** Hosts share a link such as `slotly.app/ada/intro-call`,
and guests pick a time in _their_ time zone. The database guarantees nobody gets double-booked.

![Public booking page](docs/screenshot.png)

## Features

- **Public booking pages** with a month calendar, time slots in the guest's own time zone
  (auto-detected, switchable), and confirmation with a private cancel link.
- **Host dashboard**: upcoming and past bookings (shown in both your time and the guest's), multiple
  event types with duration, buffer and on/off toggle, and weekly availability.
- **Time-zone correctness.** Availability is stored as wall-clock hours in the host's zone and
  resolved per date with Luxon, so "9–5 London" stays 9–5 across daylight-saving changes. This is tested
  against the March 2026 UK clock change.
- **No double bookings, guaranteed by the database:**

  ```sql
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (user_id WITH =, blocked WITH &&)
    WHERE (status = 'confirmed')
  ```

  The blocked range includes the meeting's buffer. An integration test fires 8 concurrent
  requests for the same slot and asserts that exactly one succeeds.

- **The server is the source of truth.** A booking is accepted only if its start time is one of the
  slots the server itself would offer (on-grid, inside availability, after minimum notice, not
  overlapping), so a crafted request can't book 3 a.m. on a Sunday.

## Security

| Concern             | Approach                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Passwords           | `scrypt` (N=2¹⁵, r=8, p=1) via `node:crypto`, with self-describing hashes so parameters can be raised later                                |
| Sessions            | 256-bit random tokens in `HttpOnly`, `SameSite=Lax`, `Secure` (production) cookies. Only SHA-256 digests are stored                        |
| CSRF                | SameSite cookies, and mutations must be `application/json` (the `text/plain` parser is removed, so cross-site forms are rejected with 415) |
| Account enumeration | Login runs `scrypt` even for unknown emails, so timing reveals nothing                                                                     |
| Brute force         | Per-IP login rate limiting                                                                                                                 |
| Cancel links        | Bearer tokens stored as digests, single purpose, only valid for future bookings                                                            |
| Multi-tenancy       | Every host query is scoped by `user_id`, and tests assert hosts can't see each other's bookings                                            |

## Architecture

```text
shared/types.ts         Zod schemas + types shared by server and client
server/
  migrations/           SQL (citext, btree_gist, exclusion constraint)
  src/slots.ts          Pure slot generation (DST, buffers, notice, conflicts)
  src/auth.ts           scrypt hashing, token generation
  src/repo.ts           All SQL, parameterised
  src/app.ts            Fastify routes, sessions, validation, error mapping
web/src/
  lib.tsx               API client, ~20-line History API router, time-zone helpers
  pages/                Landing, Auth, Dashboard, BookingPage, ManageBooking
```

## Quick start

```bash
docker compose up --build        # app + Postgres → http://localhost:3000
```

Local development:

```bash
docker compose up -d postgres
cp .env.example .env
npm install
npm run dev                      # API :3000, UI http://localhost:5173
```

## Testing

```bash
DATABASE_URL=postgres://slotly:slotly@localhost:5432/slotly npm test
```

- **Unit tests**: slot generation (time zones, DST, buffers, notice, range limits), password hashing.
- **Integration tests** against real Postgres: signup/login/logout, CSRF content-type rejection,
  booking validation, the concurrent double-booking race, cancellation, and tenant isolation.
- **UI tests**: the full booking flow in a different time zone, and the slot-taken recovery path.

## Roadmap

- Email confirmations and reminders (`.ics` attachments)
- Google/Outlook calendar sync for busy times
- Paid event types via Stripe Checkout

## License

[MIT](LICENSE) © Michael Timothy

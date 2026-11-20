-- btree_gist lets an exclusion constraint mix equality (host) with range overlap (time).
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id            BIGSERIAL PRIMARY KEY,
  email         CITEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  password_hash TEXT NOT NULL,
  timezone      TEXT NOT NULL DEFAULT 'UTC',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only a SHA-256 of the session token is stored, so a database leak can't hijack sessions.
CREATE TABLE sessions (
  token_hash  BYTEA PRIMARY KEY,
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE event_types (
  id           BIGSERIAL PRIMARY KEY,
  user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  slug         TEXT NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,48}[a-z0-9]$'),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  duration_min INTEGER NOT NULL CHECK (duration_min BETWEEN 5 AND 480),
  buffer_min   INTEGER NOT NULL DEFAULT 0 CHECK (buffer_min BETWEEN 0 AND 120),
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (user_id, slug)
);

-- Weekly recurring availability, interpreted in the host's time zone.
CREATE TABLE availability_rules (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  weekday    SMALLINT NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- ISO: 1 = Monday
  start_time TIME NOT NULL,
  end_time   TIME NOT NULL,
  CHECK (end_time > start_time)
);
CREATE INDEX availability_user_idx ON availability_rules (user_id);

CREATE TABLE bookings (
  id             BIGSERIAL PRIMARY KEY,
  user_id        BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type_id  BIGINT NOT NULL REFERENCES event_types(id) ON DELETE CASCADE,
  starts_at      TIMESTAMPTZ NOT NULL,
  ends_at        TIMESTAMPTZ NOT NULL,
  -- The blocked range includes the buffer, so back-to-back meetings keep their breathing room.
  blocked        TSTZRANGE NOT NULL,
  invitee_name   TEXT NOT NULL,
  invitee_email  CITEXT NOT NULL,
  invitee_tz     TEXT NOT NULL,
  notes          TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled')),
  cancel_token_hash BYTEA NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  -- The database itself guarantees no double booking, even under concurrent requests.
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (user_id WITH =, blocked WITH &&)
    WHERE (status = 'confirmed')
);
CREATE INDEX bookings_user_start_idx ON bookings (user_id, starts_at);

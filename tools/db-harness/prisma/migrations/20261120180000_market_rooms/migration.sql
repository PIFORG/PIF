-- Market Rooms — multiplayer pedagogical simulation (apply ONLY on *_test databases).
-- Capital fictif, points d'apprentissage et crédit virtuel sont des soldes distincts.

CREATE TABLE IF NOT EXISTS market_rooms (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code                  VARCHAR(12) NOT NULL UNIQUE,
  title                 TEXT NOT NULL,
  description           TEXT,
  visibility            VARCHAR(16) NOT NULL DEFAULT 'PUBLIC',
  mode                  VARCHAR(24) NOT NULL DEFAULT 'LEARNING',
  status                VARCHAR(24) NOT NULL DEFAULT 'LOBBY',
  host_user_id          UUID NOT NULL REFERENCES users(id),
  rules_json            JSONB NOT NULL DEFAULT '{}'::jsonb,
  market_scope          VARCHAR(16) NOT NULL DEFAULT 'FICTIONAL',
  crisis_episode_id     VARCHAR(40),
  sim_clock_date        DATE,
  sim_started_at        TIMESTAMPTZ,
  sim_ended_at          TIMESTAMPTZ,
  paused_at             TIMESTAMPTZ,
  event_seq             BIGINT NOT NULL DEFAULT 0,
  max_participants      INT NOT NULL DEFAULT 12,
  invite_expires_at     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT market_rooms_visibility_chk CHECK (visibility IN ('PUBLIC', 'PRIVATE')),
  CONSTRAINT market_rooms_mode_chk CHECK (mode IN ('LEARNING', 'COMPETITION', 'CLASSROOM', 'PRACTICE')),
  CONSTRAINT market_rooms_status_chk CHECK (status IN ('LOBBY', 'ACTIVE', 'PAUSED', 'ENDED')),
  CONSTRAINT market_rooms_scope_chk CHECK (market_scope IN ('FICTIONAL', 'TN', 'US', 'MIXED', 'HISTORICAL'))
);

CREATE INDEX IF NOT EXISTS market_rooms_status_idx ON market_rooms (status, visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS market_rooms_host_idx ON market_rooms (host_user_id);

CREATE TABLE IF NOT EXISTS market_room_members (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id                 UUID NOT NULL REFERENCES market_rooms(id) ON DELETE CASCADE,
  user_id                 UUID NOT NULL REFERENCES users(id),
  role                    VARCHAR(16) NOT NULL DEFAULT 'PLAYER',
  display_name            TEXT NOT NULL,
  portfolio_id            UUID REFERENCES trading_portfolios(id),
  learning_points         INT NOT NULL DEFAULT 0,
  credit_debt_millimes    BIGINT NOT NULL DEFAULT 0,
  credit_drawn_millimes   BIGINT NOT NULL DEFAULT 0,
  converted_capital_millimes BIGINT NOT NULL DEFAULT 0,
  trading_locked          BOOLEAN NOT NULL DEFAULT FALSE,
  lock_reason             TEXT,
  pedagogical_level       VARCHAR(24) NOT NULL DEFAULT 'BEGINNER',
  last_conversion_at      TIMESTAMPTZ,
  joined_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at                 TIMESTAMPTZ,
  UNIQUE (room_id, user_id),
  CONSTRAINT market_room_members_role_chk CHECK (role IN ('HOST', 'PLAYER', 'FACILITATOR', 'SPECTATOR'))
);

CREATE INDEX IF NOT EXISTS market_room_members_user_idx ON market_room_members (user_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS market_room_members_room_idx ON market_room_members (room_id) WHERE left_at IS NULL;

CREATE TABLE IF NOT EXISTS market_room_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL REFERENCES market_rooms(id) ON DELETE CASCADE,
  seq             BIGINT NOT NULL,
  type            VARCHAR(48) NOT NULL,
  actor_user_id   UUID REFERENCES users(id),
  payload_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, seq)
);

CREATE INDEX IF NOT EXISTS market_room_events_room_seq_idx ON market_room_events (room_id, seq);

CREATE TABLE IF NOT EXISTS market_room_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL REFERENCES market_rooms(id) ON DELETE CASCADE,
  sender_user_id  UUID NOT NULL REFERENCES users(id),
  body            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS market_room_messages_room_idx ON market_room_messages (room_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market_room_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL REFERENCES market_rooms(id) ON DELETE CASCADE,
  member_id       UUID NOT NULL REFERENCES market_room_members(id) ON DELETE CASCADE,
  kind            VARCHAR(32) NOT NULL,
  amount_millimes BIGINT NOT NULL DEFAULT 0,
  points_delta    INT NOT NULL DEFAULT 0,
  balance_cash_after BIGINT,
  balance_debt_after BIGINT,
  balance_points_after INT,
  idempotency_key VARCHAR(80),
  note            TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS market_room_ledger_member_idx ON market_room_ledger (member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS market_room_rewards (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         UUID NOT NULL REFERENCES market_rooms(id) ON DELETE CASCADE,
  member_id       UUID NOT NULL REFERENCES market_room_members(id) ON DELETE CASCADE,
  source_kind     VARCHAR(40) NOT NULL,
  source_ref      VARCHAR(120) NOT NULL,
  points_awarded  INT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (room_id, member_id, source_kind, source_ref)
);

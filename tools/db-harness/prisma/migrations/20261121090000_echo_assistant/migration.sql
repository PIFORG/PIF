-- ÉCHO — assistant financier contextuel (apply ONLY on isolated *_test databases; never on PIF).
-- Additive only: no existing table is altered. Every row is owned by exactly one user and
-- deleted with that user (ON DELETE CASCADE). Positions, orders and quotes are NOT duplicated:
-- ÉCHO reads them from the trading tables at question time.

-- Per-user consent and preferences. Memory, voice and proactive voice are OFF until the user opts in.
CREATE TABLE IF NOT EXISTS echo_preferences (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  memory_enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  voice_enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  proactive_voice   BOOLEAN NOT NULL DEFAULT FALSE,
  alerts_enabled    BOOLEAN NOT NULL DEFAULT TRUE,
  help_level        VARCHAR(16) NOT NULL DEFAULT 'INTERMEDIAIRE',
  updated_at        TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  CONSTRAINT echo_preferences_help_chk CHECK (help_level IN ('DEBUTANT', 'INTERMEDIAIRE', 'AVANCE'))
);

-- Conversations: bounded working memory lives in `state` (last referenced symbol, portfolio, scenario).
CREATE TABLE IF NOT EXISTS echo_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title       VARCHAR(120) NOT NULL,
  state       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at  TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC')
);
CREATE INDEX IF NOT EXISTS echo_conversations_user_idx ON echo_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS echo_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES echo_conversations(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role             VARCHAR(8) NOT NULL,
  content          TEXT NOT NULL,
  intent           VARCHAR(40),
  payload          JSONB,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  CONSTRAINT echo_messages_role_chk CHECK (role IN ('USER', 'ECHO')),
  CONSTRAINT echo_messages_content_len CHECK (char_length(content) <= 8000)
);
CREATE INDEX IF NOT EXISTS echo_messages_conversation_idx ON echo_messages (conversation_id, created_at);

-- Decision journal: intentions are typed by the user, never inferred from clicks.
CREATE TABLE IF NOT EXISTS echo_decisions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  portfolio_id       UUID REFERENCES trading_portfolios(id) ON DELETE SET NULL,
  symbol             VARCHAR(32),
  side               VARCHAR(4),
  quantity           NUMERIC(20, 6),
  intent             VARCHAR(24) NOT NULL,
  intent_note        VARCHAR(500),
  hypothesis         VARCHAR(500),
  snapshot           JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             VARCHAR(12) NOT NULL DEFAULT 'OPEN',
  observation        VARCHAR(1000),
  review             JSONB,
  created_at         TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  updated_at         TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  CONSTRAINT echo_decisions_side_chk CHECK (side IS NULL OR side IN ('BUY', 'SELL')),
  CONSTRAINT echo_decisions_intent_chk CHECK (intent IN
    ('MOYEN_TERME', 'REDUCTION_RISQUE', 'DIVERSIFICATION', 'HYPOTHESE_HAUSSE', 'PEDAGOGIQUE', 'AUTRE')),
  CONSTRAINT echo_decisions_status_chk CHECK (status IN ('OPEN', 'REVIEWED'))
);
CREATE INDEX IF NOT EXISTS echo_decisions_user_idx ON echo_decisions (user_id, created_at DESC);

-- Alerts: one ACTIVE row per (user, fingerprint) — the partial unique index is the deduplication guarantee.
CREATE TABLE IF NOT EXISTS echo_alerts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  fingerprint   VARCHAR(160) NOT NULL,
  code          VARCHAR(40) NOT NULL,
  severity      VARCHAR(8) NOT NULL,
  title         VARCHAR(160) NOT NULL,
  message       VARCHAR(1000) NOT NULL,
  evidence      JSONB NOT NULL DEFAULT '{}'::jsonb,
  action        JSONB,
  status        VARCHAR(10) NOT NULL DEFAULT 'ACTIVE',
  read_at       TIMESTAMP(3),
  created_at    TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  last_seen_at  TIMESTAMP(3) NOT NULL DEFAULT (NOW() AT TIME ZONE 'UTC'),
  resolved_at   TIMESTAMP(3),
  CONSTRAINT echo_alerts_severity_chk CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL')),
  CONSTRAINT echo_alerts_status_chk CHECK (status IN ('ACTIVE', 'RESOLVED', 'DISMISSED'))
);
CREATE UNIQUE INDEX IF NOT EXISTS echo_alerts_active_uq ON echo_alerts (user_id, fingerprint) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS echo_alerts_user_idx ON echo_alerts (user_id, created_at DESC);

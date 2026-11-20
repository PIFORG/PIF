-- Contenu administrable plateforme. UNIQUEMENT bases isolees (ex. PIF_spring_test).
-- NE PAS appliquer sur PIF sans autorisation explicite.

CREATE TABLE IF NOT EXISTS platform_admin_flags (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_news_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  symbol TEXT,
  sector TEXT,
  published_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS platform_challenges (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  starting_capital DOUBLE PRECISION NOT NULL,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  open BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS platform_challenge_entries (
  challenge_id TEXT NOT NULL REFERENCES platform_challenges(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  score DOUBLE PRECISION,
  final_equity DOUBLE PRECISION,
  joined_at TIMESTAMPTZ NOT NULL,
  submitted_at TIMESTAMPTZ,
  PRIMARY KEY (challenge_id, user_id)
);
-- Market data warehouse (additive). Apply ONLY on isolated *_test databases.
-- Layers: raw metadata → staging → validated bars → derived/events → news → provenance.

CREATE TABLE IF NOT EXISTS market_data_sources (
  id            VARCHAR(40) PRIMARY KEY,
  name          TEXT NOT NULL,
  kind          VARCHAR(40) NOT NULL,
  market        VARCHAR(40),
  license_note  TEXT,
  homepage_url  TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_import_batches (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       VARCHAR(40) NOT NULL REFERENCES market_data_sources(id),
  source_path     TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at     TIMESTAMPTZ,
  status          VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
  rows_read       BIGINT NOT NULL DEFAULT 0,
  rows_inserted   BIGINT NOT NULL DEFAULT 0,
  rows_updated    BIGINT NOT NULL DEFAULT 0,
  rows_rejected   BIGINT NOT NULL DEFAULT 0,
  rows_duplicate  BIGINT NOT NULL DEFAULT 0,
  quality_json    JSONB,
  error_log       TEXT,
  content_hash    VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS market_instruments_ext (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        VARCHAR(40) NOT NULL REFERENCES market_data_sources(id),
  source_symbol    VARCHAR(64) NOT NULL,
  isin             VARCHAR(16),
  name             TEXT NOT NULL,
  exchange         VARCHAR(40),
  currency         CHAR(3) NOT NULL DEFAULT 'TND',
  asset_class      VARCHAR(20) NOT NULL DEFAULT 'EQUITY',
  sector           VARCHAR(80),
  trading_symbol   VARCHAR(16),
  metadata         JSONB,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, source_symbol)
);

CREATE TABLE IF NOT EXISTS market_price_bars (
  id               BIGSERIAL PRIMARY KEY,
  source_id        VARCHAR(40) NOT NULL REFERENCES market_data_sources(id),
  source_symbol    VARCHAR(64) NOT NULL,
  session_date     DATE NOT NULL,
  open_millimes    BIGINT,
  high_millimes    BIGINT,
  low_millimes     BIGINT,
  close_millimes   BIGINT NOT NULL,
  volume           BIGINT,
  turnover_millimes BIGINT,
  trade_count      INT,
  quality_flag     VARCHAR(40) NOT NULL DEFAULT 'OK',
  import_batch_id  UUID REFERENCES market_import_batches(id),
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, source_symbol, session_date)
);

CREATE INDEX IF NOT EXISTS idx_market_price_bars_symbol_date
  ON market_price_bars (source_symbol, session_date DESC);
CREATE INDEX IF NOT EXISTS idx_market_price_bars_date
  ON market_price_bars (session_date);

CREATE TABLE IF NOT EXISTS market_macro_observations (
  id               BIGSERIAL PRIMARY KEY,
  source_id        VARCHAR(40) NOT NULL REFERENCES market_data_sources(id),
  series_id        VARCHAR(64) NOT NULL,
  obs_date         DATE NOT NULL,
  value_numeric    DOUBLE PRECISION NOT NULL,
  realtime_start   DATE,
  realtime_end     DATE,
  import_batch_id  UUID REFERENCES market_import_batches(id),
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, series_id, obs_date, realtime_start)
);

CREATE TABLE IF NOT EXISTS market_crisis_episodes (
  id               VARCHAR(40) PRIMARY KEY,
  title_fr         TEXT NOT NULL,
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  summary_fr       TEXT NOT NULL,
  references_json  JSONB NOT NULL DEFAULT '[]'::jsonb,
  instruments_hint JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS market_news_items_real (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id        VARCHAR(40) NOT NULL REFERENCES market_data_sources(id),
  external_id      VARCHAR(190) NOT NULL,
  title            TEXT NOT NULL,
  summary          TEXT,
  original_url     TEXT,
  published_at     TIMESTAMPTZ NOT NULL,
  collected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  language         VARCHAR(8) DEFAULT 'en',
  market           VARCHAR(40),
  category         VARCHAR(60),
  symbols          TEXT[],
  verification     VARCHAR(40) NOT NULL DEFAULT 'UNVERIFIED',
  UNIQUE (source_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_market_news_published
  ON market_news_items_real (published_at DESC);

INSERT INTO market_data_sources (id, name, kind, market, license_note, homepage_url) VALUES
  ('CMF_BVMT_HIST', 'Historiques de cotation BVMT (livraison WeTransfer / CMF)', 'FILE_BULK', 'TN',
   'Données historiques fournies localement — ne pas redistribuer hors cadre projet pédagogique sans vérification de licence.',
   'https://www.cmf.tn/'),
  ('STOOQ', 'Stooq daily OHLCV (téléchargement public)', 'HTTP_CSV', 'US',
   'Usage selon conditions Stooq; conservation locale pour backtesting pédagogique.',
   'https://stooq.com/'),
  ('FRED', 'Federal Reserve Economic Data', 'API', 'US',
   'Nécessite clé API FRED; conditions https://fred.stlouisfed.org/',
   'https://fred.stlouisfed.org/'),
  ('RSS_FED', 'Federal Reserve press RSS', 'RSS', 'US',
   'Métadonnées et titres — pas de republication intégrale.',
   'https://www.federalreserve.gov/'),
  ('RSS_SEC', 'SEC press releases RSS', 'RSS', 'US',
   'Métadonnées et titres — respecter attribution SEC.',
   'https://www.sec.gov/')
ON CONFLICT (id) DO NOTHING;
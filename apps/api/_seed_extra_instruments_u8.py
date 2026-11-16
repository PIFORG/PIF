from pathlib import Path
import re
import psycopg

env = {}
for line in (Path(__file__).resolve().parent / ".env").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k] = v.strip().strip('"').strip("'")

url = env["DATABASE_URL"]
m = re.match(r"postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+)(?::(\d+))?/([^?]+)", url)
user, password, host, port, db = m.group(1), m.group(2), m.group(3), m.group(4) or "5432", m.group(5)
assert db.endswith("_test"), db
print("target", db)

insert = """
INSERT INTO instruments (
  id, symbol, name, asset_class, sector, quote_currency, status,
  price_decimals, quantity_decimals, lot_size, provider_id, provider_symbol,
  fictional, metadata, created_at, updated_at
)
SELECT gen_random_uuid(), v.symbol, v.name, v.asset_class::"InstrumentAssetClass", v.sector, 'TND', 'ACTIVE',
       3, 0, v.lot_size, 'pif-simulated-v1', v.symbol, true,
       ('{"referencePrice": ' || v.ref_price || '}')::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('TNDB', 'Obligation notionnelle Tunisie 10Y', 'BOND', 'Fixed income', 1, 98.5),
  ('OILX', 'Indice pétrole fictif', 'COMMODITY', 'Energy', 1, 72.4),
  ('EURT', 'EUR/TND synthétique', 'FX', 'Currencies', 1, 3.35)
) AS v(symbol, name, asset_class, sector, lot_size, ref_price)
WHERE NOT EXISTS (SELECT 1 FROM instruments i WHERE i.symbol = v.symbol)
"""

conn = psycopg.connect(host=host, port=port, dbname=db, user=user, password=password)
conn.autocommit = True
with conn.cursor() as cur:
    cur.execute(
        "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid "
        "WHERE t.typname='InstrumentAssetClass' ORDER BY enumsortorder"
    )
    print("enum", [r[0] for r in cur.fetchall()])
    cur.execute(insert)
    cur.execute(
        "SELECT symbol, asset_class::text FROM instruments WHERE symbol IN ('TNDB','OILX','EURT') ORDER BY 1"
    )
    print("rows", cur.fetchall())
conn.close()
print("OK")

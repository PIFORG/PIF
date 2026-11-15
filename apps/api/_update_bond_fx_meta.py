from pathlib import Path
import re
import json
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

updates = [
    (
        "TNDB",
        "Obligation notionnelle Tunisie 10Y",
        {
            "referencePrice": 98.5,
            "couponRate": 0.05,
            "couponsPerYear": 1,
            "yearsToMaturity": 10,
            "yieldToMaturity": 0.052,
            "faceValue": 100,
        },
    ),
    ("OILX", "Indice pétrole fictif", {"referencePrice": 72.4}),
    ("EURT", "EUR/TND synthétique", {"referencePrice": 3.35, "base": "EUR", "quote": "TND"}),
]

conn = psycopg.connect(host=host, port=port, dbname=db, user=user, password=password)
conn.autocommit = True
with conn.cursor() as cur:
    for symbol, name, meta in updates:
        cur.execute(
            "UPDATE instruments SET name=%s, metadata=%s::jsonb, updated_at=CURRENT_TIMESTAMP WHERE symbol=%s",
            (name, json.dumps(meta), symbol),
        )
    cur.execute(
        "SELECT symbol, name, asset_class::text, metadata FROM instruments WHERE symbol IN ('TNDB','OILX','EURT') ORDER BY 1"
    )
    for row in cur.fetchall():
        print(row)
conn.close()
print("OK", db)

from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[2]
env_path = root / ".env"
env = {}
for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
    line = line.strip()
    if not line or line.startswith("#") or "=" not in line:
        continue
    k, v = line.split("=", 1)
    env[k.strip()] = v.strip().strip('"').strip("'")

url = env.get("DATABASE_URL") or env.get("SPRING_DATASOURCE_URL") or ""
# spring style may be separate
if not url and env.get("DB_HOST"):
    url = f"jdbc:postgresql://{env.get('DB_HOST')}:{env.get('DB_PORT', '5432')}/{env.get('DB_NAME', '')}"

name = url.rsplit("/", 1)[-1].split("?")[0] if url else ""
print("db_name", name or "NONE")
if name not in {"PIF_spring_test", "PIF_test"}:
    print("REFUSED: only test databases allowed")
    sys.exit(2)

# Parse jdbc or postgres URL for psycopg/psql
m = re.match(r"jdbc:postgresql://([^:/]+)(?::(\d+))?/([^?]+)", url)
if not m:
    # postgres://user:pass@host:port/db
    m2 = re.match(r"postgres(?:ql)?://([^:]+):([^@]+)@([^:/]+)(?::(\d+))?/([^?]+)", url)
    if not m2:
        print("cannot parse url")
        sys.exit(3)
    user, password, host, port, db = m2.group(1), m2.group(2), m2.group(3), m2.group(4) or "5432", m2.group(5)
else:
    host, port, db = m.group(1), m.group(2) or "5432", m.group(3)
    user = env.get("DATABASE_USER") or env.get("SPRING_DATASOURCE_USERNAME") or env.get("DB_USER") or "postgres"
    password = env.get("DATABASE_PASSWORD") or env.get("SPRING_DATASOURCE_PASSWORD") or env.get("DB_PASSWORD") or ""

sql_path = root / "tools/db-harness/prisma/migrations/20261115160000_asset_classes_extension/migration.sql"
raw = sql_path.read_bytes()
sql = raw.decode("utf-16-le") if len(raw) > 3 and raw[1] == 0 else raw.decode("utf-8")
sql_path.write_text(sql, encoding="utf-8", newline="\n")

try:
    import psycopg
except ImportError:
    print("psycopg missing; writing apply instructions only")
    sys.exit(4)

conn = psycopg.connect(host=host, port=port, dbname=db, user=user, password=password)
conn.autocommit = True
with conn.cursor() as cur:
    cur.execute(sql)
    cur.execute(
        "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid "
        "WHERE t.typname='InstrumentAssetClass' ORDER BY enumsortorder"
    )
    labels = [r[0] for r in cur.fetchall()]
    cur.execute("SELECT symbol, asset_class::text FROM instruments WHERE symbol IN ('TNDB','OILX','EURT') ORDER BY symbol")
    rows = cur.fetchall()
print("enum", labels)
print("seeded", rows)
conn.close()

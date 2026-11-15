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
conn = psycopg.connect(host=host, port=port, dbname=db, user=user, password=password)
with conn.cursor() as cur:
    cur.execute(
        """
        SELECT email, role::text, status::text, email_verified_at IS NOT NULL AS verified
        FROM users
        WHERE email NOT LIKE '%@spring-contract.test'
          AND email NOT LIKE '%@spring-journey.test'
          AND email NOT LIKE '%@spring-account.test'
        ORDER BY role::text, email
        LIMIT 40
        """
    )
    for row in cur.fetchall():
        print(row)
conn.close()

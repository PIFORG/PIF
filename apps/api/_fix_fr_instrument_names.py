import psycopg
URL = "postgresql://nasma:root@localhost:5432/PIF_spring_test"
with psycopg.connect(URL) as conn:
    with conn.cursor() as cur:
        cur.execute("UPDATE instruments SET name = %s WHERE symbol = %s", ("Indice pétrole fictif", "OILX"))
        cur.execute("UPDATE instruments SET name = %s WHERE symbol = %s", ("EUR/TND synthétique", "EURT"))
        conn.commit()
        cur.execute("SELECT symbol, name FROM instruments WHERE symbol IN ('OILX', 'EURT') ORDER BY symbol")
        print(cur.fetchall())

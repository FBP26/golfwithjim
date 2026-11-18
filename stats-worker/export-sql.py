# Turns a Golf Stats SQLite file into SQL INSERT batches for D1. usage: export-sql.py golf.sqlite3 out_dir
import sqlite3, sys, os, json
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
c = sqlite3.connect(src)
tables = {"courses": "name, metadata", "course_holes": "course, tees, hole, par, length, handicap", "rounds": "id, played_on, player, course, round_number, notes, source, revision, created_at, updated_at",
          "hole_scores": "round_id, hole, tees, score, par, length, handicap, fir, green", "revisions": "round_id, revision, saved_at, payload", "hole_conditions": "round_id, hole, note",
          "reference_data": "name, payload", "player_rating_categories": "player, category, updated_at"}
have = {r[0] for r in c.execute("select name from sqlite_master where type='table'")}
def lit(v):
    if v is None: return "NULL"
    if isinstance(v, (int, float)): return str(v)
    return "'" + str(v).replace("'", "''") + "'"
n = 0
for t, cols in tables.items():
    if t not in have: continue
    rows = c.execute(f"select {cols} from {t}").fetchall()
    size = 400 if t != "revisions" else 60
    for i in range(0, len(rows), size):
        chunk = rows[i:i+size]
        sql = f"INSERT INTO {t} ({cols}) VALUES " + ",".join("(" + ",".join(lit(v) for v in r) + ")" for r in chunk) + ";"
        n += 1
        open(f"{out}/{n:04d}-{t}.sql", "w").write(sql)
    print(t, len(rows))
print("files", n)

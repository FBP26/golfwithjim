# Matches USGA NCRDB tee ratings to Golf Stats course/tee names. usage: match-ratings.py golf.sqlite3 ncrdb.txt out.sql
import sqlite3, sys, collections
db, ncr, out = sys.argv[1:4]
IDS = {"Birdwood": 30168, "Birkdale": 8750, "Brickshire": 24333, "Brookwoods": 24321, "Castle Bay": 181, "Colonial Heritage": 8617, "Currituck Club": 249,
  "Devil's Knob": 17685, "Dogwood Trace": 8651, "Duck Woods Country Club": 431, "Fawn Lake": 8630, "Federal Club": 24329, "Ford's Colony Blue Heron": 8607,
  "Ford's Colony Marsh Hawk": 8784, "Golden Horseshoe Gold": 8589, "Golden Horseshoe Green": 8588, "Hanover": 8671, "Hell's Point": 8559,
  "Hermitage (Manakin)": 8576, "Hermitage (Sabot)": 8686, "Heron Ridge": 8665, "Highlands (current)": 24328, "Hunting Hawk": 8663, "Independence": 8662,
  "James River": 8621, "Kilmarlic": 11, "Kiln Creek": 24332, "Kiskiack": 8692, "Lake Chesdin": 8644, "Lakeside Park": 8796, "Lee's Hill": 8777,
  "Magnolia Green": 13806, "Mattaponi Springs": 8642, "Meadowbrook": 8673, "Mill Quarter": 8717, "Nags Head": 62, "Old Trail": 8575, "Olde Point": 14961,
  "Pendleton": 8571, "Potomac Shores": 23706, "Providence": 8590, "Queenfield": 8677, "Red Wing Lake": 8602, "Richmond Country Club": 8710,
  "Royal New Kent": 8666, "Somerset Farms": 23741, "Spring Creek": 8739, "Stonehenge": 24300, "Stonehouse": 8687, "Sycamore Creek": 8613,
  "The Homestead (Cascades)": 8814, "Vineyard White Lake": 395, "Viniterra": 8597, "Virginia Beach National": 8756,
  "Williamsburg National Jamestown": 8668, "Willow Oaks": 17696}
ratings = collections.defaultdict(list)
for line in open(ncr).read().splitlines()[1:]:
    cid, name, tee, g, par, rating, slope, rf, rb, sf, sb, yards = line.split("|")
    if rating and slope: ratings[int(cid)].append((tee.strip(), g, int(par or 0), float(rating), int(slope), int(yards or 0)))
c = sqlite3.connect(db)
layouts = c.execute("select course, tees, sum(par), sum(coalesce(length,0)), count(*) from course_holes group by course, tees").fetchall()
rows, report = [], []
for course, tees, par, yards, n in layouts:
    if course not in IDS or n != 18: continue
    cands = [r for r in ratings[IDS[course]] if r[0].lower() == tees.lower()]
    if not cands: report.append(f"no tee match  {course} / {tees} ({yards} yds)"); continue
    for tee, g, rpar, rating, slope, ryards in cands:
        gap = abs(ryards - yards) / max(yards, 1)
        if gap > 0.06: report.append(f"yardage differs {course} / {tees} {g}: ours {yards}, USGA {ryards}"); continue
        rows.append((course, tees, "M" if g == "M" else "W", rating, slope, rpar, ryards, f"USGA NCRDB course {IDS[course]}"))
seen = set(); uniq = []
for r in rows:
    if (r[0], r[1], r[2]) in seen: continue
    seen.add((r[0], r[1], r[2])); uniq.append(r)
lit = lambda v: "'" + str(v).replace("'", "''") + "'" if isinstance(v, str) else str(v)
open(out, "w").write("DELETE FROM course_ratings;\n" + ("INSERT INTO course_ratings (course, tees, gender, rating, slope, par, yards, source) VALUES " + ",".join("(" + ",".join(lit(v) for v in r) + ")" for r in uniq) + ";\n" if uniq else ""))
print(len(uniq), "ratings matched"); print("\n".join(report))

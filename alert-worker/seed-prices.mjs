import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeTeeTime } from "../src/analyze.js";
import { LOCAL_COURSES } from "../src/dashboard.js";
import { priceObservations, mergePriceDay, qualifyDeals, offerKey, dealPolicy } from "../src/price-history.js";

const root = resolve(import.meta.dirname, "..");
const git = process.env.GIT_EXE || (process.platform === "win32" ? "C:/Program Files/Git/cmd/git.exe" : "git");
const run = args => execFileSync(git, ["--no-pager", ...args], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const revisions = run(["log", "origin/main", "--reverse", "--since=400 days ago", "--format=%H", "--", "fixtures/live-current.json"]).trim().split(/\r?\n/).filter(Boolean);
const days = new Map();
function retain(feed, now) {
  for (const [key, rows] of Map.groupBy(priceObservations(feed, now), row => JSON.stringify([row.course, row.observed]))) days.set(key, mergePriceDay(days.get(key) || [], rows));
}
for (const revision of revisions) {
  const feed = JSON.parse(run(["show", `${revision}:fixtures/live-current.json`]));
  const now = Date.parse(feed.checkedAt);
  if (!Number.isFinite(now)) continue;
  retain({ ...feed, teeTimes: feed.teeTimes.map(normalizeTeeTime) }, now);
}
const response = await fetch("https://fbp26.github.io/golfwithjim/api/tee-times.json", { signal: AbortSignal.timeout(30000), cache: "no-store" });
if (!response.ok) throw new Error(`Current inventory returned ${response.status}`);
const current = await response.json();
retain(current, Date.now());
const observations = [...days.values()].flat();
if (!observations.length) throw new Error("No verified historical observations found.");
const literal = value => `'${String(value).replace(/'/g, "''")}'`;
const statements = ["DROP TABLE IF EXISTS price_history_seed_parts;", "CREATE TABLE price_history_seed_parts(course TEXT, observed_day TEXT, payload TEXT);"];
for (const rows of days.values()) {
  if (Buffer.byteLength(JSON.stringify(rows)) > 1800000) throw new Error("Course-day exceeds D1 value budget.");
  for (let offset = 0; offset < rows.length; offset += 100) statements.push(`INSERT INTO price_history_seed_parts(course,observed_day,payload) VALUES(${literal(rows[0].course)},${literal(rows[0].observed)},${literal(JSON.stringify(rows.slice(offset, offset + 100)))});`);
}
statements.push("INSERT INTO course_price_days(course,observed_day,payload) SELECT parts.course,parts.observed_day,json_group_array(json(quote.value)) FROM price_history_seed_parts AS parts,json_each(parts.payload) AS quote WHERE true GROUP BY parts.course,parts.observed_day ON CONFLICT(course,observed_day) DO NOTHING;", "DROP TABLE price_history_seed_parts;");
const qualified = qualifyDeals(current.teeTimes, observations, Date.now(), current.sourceChecks || []);
const state = { checkedAt: current.checkedAt, computedAt: new Date().toISOString(), policy: dealPolicy, deals: qualified.filter(offer => offer.deal).map(offer => ({ key: offerKey(offer), deal: offer.deal })) };
const replaceCurrent = process.argv.includes("--replace-current");
statements.push(`INSERT INTO price_state(id,payload) VALUES(1,${literal(JSON.stringify(state))}) ON CONFLICT(id) DO ${replaceCurrent ? "UPDATE SET payload=excluded.payload" : "NOTHING"};`);
if (statements.some(statement => Buffer.byteLength(statement) > 90000)) throw new Error("Seed statement exceeds D1 SQL budget.");
const database = new DatabaseSync(":memory:");
try {
  database.exec(await readFile(resolve(import.meta.dirname, "schema.sql"), "utf8"));
  database.exec(statements.join("\n"));
  database.exec(statements.join("\n"));
  const saved = database.prepare("SELECT COUNT(*) AS days, SUM(json_array_length(payload)) AS observations FROM course_price_days").get();
  if (saved.days !== days.size || saved.observations !== observations.length) throw new Error("Seed replay validation failed.");
} finally { database.close(); }
const output = resolve(import.meta.dirname, ".wrangler", "price-history-seed.sql");
await mkdir(resolve(import.meta.dirname, ".wrangler"), { recursive: true });
await writeFile(output, statements.join("\n"));
console.log(JSON.stringify({ revisions: revisions.length, courseDays: days.size, courses: new Set(observations.map(row => row.course)).size, observations: observations.length, firstDay: observations.map(row => row.observed).sort()[0], lastDay: observations.map(row => row.observed).sort().at(-1), currentDeals: state.deals.length, localCurrentDeals: qualified.filter(offer => offer.deal && LOCAL_COURSES.has(offer.course)).length, localDealCourses: [...new Set(qualified.filter(offer => offer.deal && LOCAL_COURSES.has(offer.course)).map(offer => offer.course))], replaceCurrent, output }));
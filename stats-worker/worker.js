// Golf Stats API. Public: GET /data (everything the stats pages need), GET /health.
// Owner only (X-Golf-Key = GOLF_ADMIN_PASSWORD secret): POST /auth, POST /rounds, POST /courses, POST /scan.
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
    const cors = allowed.includes(origin) ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Headers": "Content-Type, X-Golf-Key", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Max-Age": "86400" } : {};
    if (request.method === "OPTIONS") return new Response(null, { status: allowed.includes(origin) ? 204 : 403, headers: cors });
    const url = new URL(request.url);
    try {
      if (request.method === "GET" && url.pathname === "/health") return json({ ok: true }, 200, cors);
      if (request.method === "GET" && url.pathname === "/data") return await data(request, env, cors);
      if (request.method !== "POST") return json({ error: "Not found." }, 404, cors);
      if (origin && !allowed.includes(origin)) return json({ error: "Origin not allowed." }, 403, cors);
      await requireOwner(request, env);
      const body = await readJson(request, url.pathname === "/scan" ? 12_000_000 : 2_000_000);
      if (url.pathname === "/auth") return json({ ok: true }, 200, cors);
      if (url.pathname === "/rounds") return json(await saveRounds(env, body), 200, cors);
      if (url.pathname === "/courses") return json(await saveCourse(env, body), 200, cors);
      if (url.pathname === "/scan") return json(await scanCard(env, body), 200, cors);
      return json({ error: "Not found." }, 404, cors);
    } catch (error) {
      return json({ error: error.message || "Something went wrong.", details: error.details }, error.status || 400, cors);
    }
  },
};

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}
function fail(message, status = 400, details) { const e = new Error(message); e.status = status; e.details = details; return e; }
async function readJson(request, limit) {
  if (!request.headers.get("Content-Type")?.startsWith("application/json")) throw fail("JSON required.");
  const text = await request.text();
  if (text.length > limit) throw fail("Request too large.", 413);
  return JSON.parse(text || "{}");
}

async function requireOwner(request, env) {
  if (!env.GOLF_ADMIN_PASSWORD) throw fail("Score entry is not set up yet (missing GOLF_ADMIN_PASSWORD).", 503);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const bucket = `${ip}:${Math.floor(Date.now() / 3600000)}`;
  const row = await env.DB.prepare("SELECT attempts FROM login_attempts WHERE bucket = ?").bind(bucket).first();
  if (row && row.attempts >= 20) throw fail("Too many wrong passcodes. Try again in an hour.", 429);
  const given = new TextEncoder().encode(request.headers.get("X-Golf-Key") || "");
  const expected = new TextEncoder().encode(env.GOLF_ADMIN_PASSWORD);
  let same = given.length === expected.length ? 0 : 1;
  for (let i = 0; i < expected.length; i++) same |= (given[i] || 0) ^ expected[i];
  if (same !== 0) {
    await env.DB.prepare("INSERT INTO login_attempts (bucket, attempts) VALUES (?, 1) ON CONFLICT(bucket) DO UPDATE SET attempts = attempts + 1").bind(bucket).run();
    throw fail("Wrong passcode.", 401);
  }
}

async function version(env) {
  return (await env.DB.prepare("SELECT value FROM meta WHERE key = 'version'").first())?.value || "0";
}
function bumpVersion(env) {
  return env.DB.prepare("INSERT INTO meta (key, value) VALUES ('version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(String(Date.now()));
}

// Everything in compact arrays: the stats pages compute every chart in the browser.
async function data(request, env, cors) {
  const v = await version(env);
  const etag = `"g${v}"`;
  if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: { ...cors, ETag: etag } });
  const cache = caches.default;
  const key = new Request(`https://golf-stats.cache/data/${v}`);
  let cached = await cache.match(key);
  if (!cached) {
    const [courses, layouts, rounds, holes, conditions, refs, ratings, categories] = await Promise.all([
      env.DB.prepare("SELECT name, metadata FROM courses ORDER BY name").all(),
      env.DB.prepare("SELECT course, tees, hole, par, length, handicap FROM course_holes ORDER BY course, tees, hole").all(),
      env.DB.prepare("SELECT id, played_on, player, course, round_number, notes, revision FROM rounds ORDER BY played_on, player, round_number").all(),
      env.DB.prepare("SELECT round_id, hole, tees, score, par, length, handicap, fir, green FROM hole_scores").all(),
      env.DB.prepare("SELECT round_id, hole, note FROM hole_conditions").all(),
      env.DB.prepare("SELECT name, payload FROM reference_data WHERE name IN ('majors', 'course_rank', 'ideas')").all(),
      env.DB.prepare("SELECT course, tees, gender, rating, slope, par, yards, source FROM course_ratings").all(),
      env.DB.prepare("SELECT player, category FROM player_rating_categories").all(),
    ]);
    const index = new Map(rounds.results.map((r, i) => [r.id, i]));
    const greenCode = { miss: 0, gir: 1, sgir: 2 };
    const body = JSON.stringify({
      version: v,
      courses: courses.results.map(c => ({ name: c.name, ...JSON.parse(c.metadata || "{}") })),
      layouts: layouts.results.map(h => [h.course, h.tees, h.hole, h.par, h.length, h.handicap]),
      rounds: rounds.results.map(r => [r.id, r.played_on, r.player, r.course, r.round_number, r.notes, r.revision]),
      // [round index, hole, tees, score, par, yards, handicap, fir (1/0/null), green (0 miss, 1 gir, 2 sgir, null unknown)]
      holes: holes.results.filter(h => index.has(h.round_id)).map(h => [index.get(h.round_id), h.hole, h.tees, h.score, h.par, h.length, h.handicap, h.fir, h.green == null ? null : greenCode[h.green]]),
      conditions: conditions.results.map(c => [index.get(c.round_id), c.hole, c.note]),
      references: Object.fromEntries(refs.results.map(r => [r.name, JSON.parse(r.payload)])),
      ratings: ratings.results,
      ratingCategories: Object.fromEntries(categories.results.map(c => [c.player, c.category])),
    });
    cached = new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=31536000" } });
    await cache.put(key, cached.clone());
  }
  return new Response(cached.body, { headers: { ...cors, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-cache", ETag: etag } });
}

const int = (value, label, min, max) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw fail(`${label} must be a whole number from ${min} to ${max}.`);
  return n;
};
const text = (value, label, max = 120) => {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) throw fail(`${label} is required (maximum ${max} characters).`);
  return value.trim().replace(/\s+/g, " ");
};
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

async function validateRound(env, payload, layoutCache, playerCache) {
  const playedOn = String(payload.played_on || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(playedOn) || Number.isNaN(Date.parse(playedOn))) throw fail("Date must be YYYY-MM-DD.");
  if (playedOn > today()) throw fail("A scored round cannot have a future date.");
  let player = text(payload.player, "Golfer", 80);
  const existingPlayer = playerCache.get(player.toLowerCase());
  if (existingPlayer) player = existingPlayer;
  const course = text(payload.course, "Course");
  const roundNumber = int(payload.round_number ?? 1, "Round number", 1, 10);
  const notes = typeof payload.notes === "string" ? payload.notes.trim() : "";
  if (notes.length > 2000) throw fail("Notes must be 2,000 characters or fewer.");
  if (!Array.isArray(payload.holes) || payload.holes.length < 1 || payload.holes.length > 18) throw fail(`${player}: enter between 1 and 18 scored holes.`);
  if (!layoutCache.has(course)) {
    const rows = (await env.DB.prepare("SELECT tees, hole, par, length, handicap FROM course_holes WHERE course = ?").bind(course).all()).results;
    if (!rows.length) throw fail(`Unknown course "${course}". Add it under Courses first.`);
    layoutCache.set(course, new Map(rows.map(r => [`${r.tees}|${r.hole}`, r])));
  }
  const layout = layoutCache.get(course);
  const seen = new Set();
  const holes = payload.holes.map(entry => {
    const hole = int(entry.hole, "Hole", 1, 18);
    if (seen.has(hole)) throw fail(`${player}: hole ${hole} appears more than once.`);
    seen.add(hole);
    const tees = text(entry.tees, "Tees", 60);
    const meta = layout.get(`${tees}|${hole}`);
    if (!meta) throw fail(`${course} has no ${tees} tees for hole ${hole}.`);
    const par = int(entry.par ?? meta.par, `Hole ${hole} played par`, 3, 6);
    const length = entry.length === undefined ? meta.length : entry.length === null || entry.length === "" ? null : int(entry.length, `Hole ${hole} yards`, 1, 1000);
    const conditionNote = typeof entry.condition_note === "string" ? entry.condition_note.trim().slice(0, 300) : "";
    if ((par !== meta.par || length !== meta.length) && !conditionNote) throw fail(`${player}, hole ${hole}: explain the temporary par or yardage change.`);
    const score = int(entry.score, `${player}, hole ${hole} score (max triple bogey ${par + 3})`, 1, par + 3);
    if (entry.fir != null && typeof entry.fir !== "boolean") throw fail("Fairway must be yes, no or unknown.");
    if (![undefined, null, "miss", "gir", "sgir"].includes(entry.green)) throw fail("Green must be miss, gir, sgir or unknown.");
    return { hole, tees, score, par, length, handicap: meta.handicap, fir: par === 3 ? null : entry.fir ?? null, green: entry.green ?? null, condition_note: conditionNote };
  }).sort((a, b) => a.hole - b.hole);
  return { id: payload.id, revision: payload.revision, played_on: playedOn, player, course, round_number: roundNumber, notes, holes };
}

async function saveRounds(env, body) {
  const list = Array.isArray(body.rounds) ? body.rounds : [];
  if (!list.length || list.length > 60) throw fail("Send between 1 and 60 rounds.");
  const layoutCache = new Map();
  const playerCache = new Map((await env.DB.prepare("SELECT DISTINCT player FROM rounds").all()).results.map(r => [r.player.toLowerCase(), r.player]));
  const problems = [];
  const valid = [];
  for (const [i, payload] of list.entries()) {
    try {
      if (!/^[0-9a-f-]{36}$/i.test(String(payload.id || ""))) throw fail("Each round needs an id.");
      valid.push(await validateRound(env, payload, layoutCache, playerCache));
    } catch (e) { problems.push({ index: i, player: payload?.player || "", error: e.message }); }
  }
  if (problems.length) throw fail(problems.length === 1 ? problems[0].error : `${problems.length} rounds need fixing before anything is saved.`, 422, problems);
  const stamp = new Date().toISOString();
  const statements = [];
  const results = [];
  for (const round of valid) {
    const existing = await env.DB.prepare("SELECT * FROM rounds WHERE id = ?").bind(round.id).first();
    const clash = await env.DB.prepare("SELECT id FROM rounds WHERE played_on = ? AND lower(player) = lower(?) AND course = ? AND round_number = ? AND id != ?").bind(round.played_on, round.player, round.course, round.round_number, round.id).first();
    if (clash) throw fail(`${round.player} already has round ${round.round_number} at ${round.course} on ${round.played_on}. Use round number ${round.round_number + 1} for a second round, or edit the saved one.`, 409);
    const { revision: _ignored, ...content } = round;
    const snapshot = JSON.stringify(content);
    if (existing) {
      if (round.revision != null && Number(round.revision) !== existing.revision) throw fail(`${round.player}'s round was changed somewhere else. Reload and try again.`, 409);
      const last = await env.DB.prepare("SELECT payload FROM revisions WHERE round_id = ? AND revision = ?").bind(round.id, existing.revision).first();
      if (last && last.payload === snapshot) { results.push({ id: round.id, revision: existing.revision, unchanged: true }); continue; }
      const revision = existing.revision + 1;
      statements.push(env.DB.prepare("UPDATE rounds SET played_on=?, player=?, course=?, round_number=?, notes=?, revision=?, updated_at=? WHERE id=?").bind(round.played_on, round.player, round.course, round.round_number, round.notes, revision, stamp, round.id));
      statements.push(env.DB.prepare("DELETE FROM hole_scores WHERE round_id = ?").bind(round.id));
      statements.push(env.DB.prepare("DELETE FROM hole_conditions WHERE round_id = ?").bind(round.id));
      statements.push(env.DB.prepare("INSERT INTO revisions (round_id, revision, saved_at, payload) VALUES (?, ?, ?, ?)").bind(round.id, revision, stamp, snapshot));
      results.push({ id: round.id, revision });
    } else {
      statements.push(env.DB.prepare("INSERT INTO rounds (id, played_on, player, course, round_number, notes, source, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'web', 1, ?, ?)").bind(round.id, round.played_on, round.player, round.course, round.round_number, round.notes, stamp, stamp));
      statements.push(env.DB.prepare("INSERT INTO revisions (round_id, revision, saved_at, payload) VALUES (?, 1, ?, ?)").bind(round.id, stamp, snapshot));
      results.push({ id: round.id, revision: 1 });
    }
    for (const h of round.holes) {
      statements.push(env.DB.prepare("INSERT INTO hole_scores (round_id, hole, tees, score, par, length, handicap, fir, green) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(round.id, h.hole, h.tees, h.score, h.par, h.length, h.handicap, h.fir == null ? null : h.fir ? 1 : 0, h.green));
      if (h.condition_note) statements.push(env.DB.prepare("INSERT INTO hole_conditions (round_id, hole, note) VALUES (?, ?, ?)").bind(round.id, h.hole, h.condition_note));
    }
  }
  if (statements.length) { statements.push(bumpVersion(env)); await env.DB.batch(statements); }
  return { ok: true, saved: results };
}

async function saveCourse(env, body) {
  const course = text(body.course, "Course");
  const tees = text(body.tees, "Tees", 60);
  if (!Array.isArray(body.holes) || ![9, 18].includes(body.holes.length)) throw fail("Enter 9 or 18 holes.");
  const existing = await env.DB.prepare("SELECT COUNT(*) AS n FROM course_holes WHERE course = ? AND tees = ?").bind(course, tees).first();
  if (existing.n) throw fail(`${course} ${tees} already exists. Use a new tee name for a changed layout so old rounds keep their meaning.`, 409);
  const holes = body.holes.map(h => ({ hole: int(h.hole, "Hole", 1, 18), par: int(h.par, "Par", 3, 6), length: h.length ? int(h.length, "Yards", 1, 1000) : null, handicap: h.handicap ? int(h.handicap, "Handicap", 1, 18) : null }));
  const statements = [env.DB.prepare("INSERT INTO courses (name, metadata) VALUES (?, ?) ON CONFLICT(name) DO NOTHING").bind(course, JSON.stringify(body.metadata || {}))];
  for (const h of holes) statements.push(env.DB.prepare("INSERT INTO course_holes (course, tees, hole, par, length, handicap) VALUES (?, ?, ?, ?, ?, ?)").bind(course, tees, h.hole, h.par, h.length, h.handicap));
  statements.push(bumpVersion(env));
  await env.DB.batch(statements);
  return { ok: true };
}

// Reads a photo of a paper scorecard with Cloudflare's vision model. Always shown to Jim to check before saving.
async function scanCard(env, body) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(body.image || "");
  if (!match) throw fail("Send a JPEG, PNG or WebP photo.");
  const bytes = Uint8Array.from(atob(match[2]), c => c.charCodeAt(0));
  const names = Array.isArray(body.players) ? body.players.slice(0, 200).map(String).join(", ") : "";
  const holes = int(body.holes ?? 18, "Holes", 1, 18);
  const prompt = `This is a photo of a handwritten golf scorecard. Read each golfer's row. Return ONLY JSON like {"rows":[{"name":"Jim","scores":[5,4,6,...]}]} with exactly ${holes} numbers per golfer in hole order (use null for a blank or unreadable box). Do not include totals (OUT, IN, TOT). Known golfer names: ${names}.`;
  const run = () => env.AI.run(VISION_MODEL, { messages: [{ role: "user", content: prompt }], image: [...bytes], max_tokens: 1500 });
  let result;
  try { result = await run(); }
  catch (e) {
    if (!/agree|license|prompt/i.test(e.message || "")) throw fail(`The card reader is unavailable: ${e.message}`, 502);
    await env.AI.run(VISION_MODEL, { prompt: "agree" });
    result = await run();
  }
  const raw = String(result?.response ?? result ?? "");
  const found = raw.match(/\{[\s\S]*\}/);
  let parsed;
  try { parsed = JSON.parse(found ? found[0] : raw); } catch { throw fail("Couldn't read that card. Try a straighter, brighter photo, or type the scores.", 422); }
  const rows = (parsed.rows || []).slice(0, 40).map(r => ({ name: String(r.name || "").slice(0, 80), scores: Array.from({ length: holes }, (_, i) => { const n = Number(r.scores?.[i]); return Number.isInteger(n) && n > 0 && n < 15 ? n : null; }) }));
  return { rows };
}

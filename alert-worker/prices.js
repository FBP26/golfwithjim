import { priceObservations, mergePriceDay, qualifyDeals, offerKey, dealPolicy } from "../src/price-history.js";

export async function recordPrices(env, feed, { now = Date.now(), publish = true } = {}) {
  const grouped = Map.groupBy(priceObservations(feed, now), row => JSON.stringify([row.course, row.observed]));
  const courseOffers = Map.groupBy(feed.teeTimes, offer => offer.course);
  const courses = [...courseOffers.keys()];
  const updates = [];
  const teeTimes = [];
  for (let offset = 0; offset < courses.length; offset += 5) {
    const batch = courses.slice(offset, offset + 5);
    const stored = (await env.DB.prepare("SELECT course, observed_day, payload FROM course_price_days WHERE course IN (SELECT value FROM json_each(?)) AND observed_day >= ?").bind(JSON.stringify(batch), new Date(now - 56 * 86400000).toISOString().slice(0, 10)).all()).results;
    const existing = new Map(stored.map(row => [JSON.stringify([row.course, row.observed_day]), JSON.parse(row.payload)]));
    for (const [key, rows] of grouped) {
      if (!batch.includes(rows[0].course)) continue;
      const before = existing.get(key) || [];
      const merged = mergePriceDay(before, rows);
      if (JSON.stringify(before) !== JSON.stringify(merged)) updates.push({ course: rows[0].course, day: rows[0].observed, payload: JSON.stringify(merged) });
    }
    teeTimes.push(...qualifyDeals(batch.flatMap(course => courseOffers.get(course)), [...existing.values()].flat(), now, feed.sourceChecks || []));
  }
  for (let offset = 0; offset < updates.length; offset += 5) {
    await env.DB.prepare("INSERT INTO course_price_days (course, observed_day, payload) SELECT json_extract(value, '$.course'), json_extract(value, '$.day'), json_extract(value, '$.payload') FROM json_each(?) WHERE true ON CONFLICT(course, observed_day) DO UPDATE SET payload=excluded.payload").bind(JSON.stringify(updates.slice(offset, offset + 5))).run();
  }
  if (publish) {
    const payload = { checkedAt: feed.checkedAt, computedAt: new Date(now).toISOString(), policy: dealPolicy, deals: teeTimes.filter(offer => offer.deal).map(offer => ({ key: offerKey(offer), deal: offer.deal })) };
    await env.DB.prepare("INSERT INTO price_state (id, payload) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload").bind(JSON.stringify(payload)).run();
    await env.DB.prepare("DELETE FROM course_price_days WHERE observed_day < ?").bind(new Date(now - 400 * 86400000).toISOString().slice(0, 10)).run();
  }
  return { ...feed, teeTimes };
}

export async function priceRequest(env, url) {
  if (url.pathname === "/prices/current") {
    const row = await env.DB.prepare("SELECT payload FROM price_state WHERE id=1").first();
    return row ? JSON.parse(row.payload) : { deals: [], checkedAt: null, policy: dealPolicy };
  }
  const course = url.searchParams.get("course");
  if (!course) return { courses: (await env.DB.prepare("SELECT course, MIN(observed_day) AS firstSeen, MAX(observed_day) AS lastSeen FROM course_price_days GROUP BY course ORDER BY course").all()).results, policy: dealPolicy };
  if (course.length > 200) throw new Error("Invalid course.");
  const days = Math.min(400, Math.max(1, Number(url.searchParams.get("days")) || 90));
  const rows = (await env.DB.prepare("SELECT payload FROM course_price_days WHERE course=? AND observed_day>=? ORDER BY observed_day").bind(course, new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)).all()).results;
  return { course, observations: rows.flatMap(row => JSON.parse(row.payload)), policy: dealPolicy };
}
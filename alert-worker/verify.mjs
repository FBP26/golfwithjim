import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { build } from "esbuild";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { defaultAlerts } from "../src/personal-alerts.js";

const bundle = await build({ entryPoints: [new URL("worker.js", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
const messages = [];
let acceptEmail = true;
let onDelivery = () => {};
const future = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const feed = { checkedAt: new Date().toISOString(), courses: defaultAlerts.map(rule => ({ course: rule.course, collector: "golfnow" })), sourceChecks: defaultAlerts.map(rule => ({ course: rule.course, checkedAt: new Date().toISOString() })), teeTimes: [{ course: "Spring Creek Golf Club", date: future, time: "9:00 AM", allInPrice: 119, holes: 18, priceIsExact: true, availablePlayers: 4, availablePartySizes: [2, 4], rateName: "Public", url: "https://example.test/book" }] };
const runtime = new Miniflare(convertV4MiniflareOptions({ workers: [{ modules: true, script: bundle.outputFiles[0].text, compatibilityDate: "2026-09-26", d1Databases: ["DB"], bindings: { ADMIN_SECRET: "test-admin", EMAIL_RELAY_SECRET: "test-relay", EMAIL_RELAY_URL: "https://mail.test/send" }, outboundService: async request => {
  if (request.url.startsWith("https://mail.test/")) { if (!acceptEmail) return Response.json({ ok: false }, { status: 503 }); messages.push(await request.json()); onDelivery(); return Response.json({ ok: true }); }
  if (request.url.startsWith("https://fbp26.github.io/golfwithjim/api/")) return Response.json(feed);
  return new Response("Unexpected request", { status: 500 });
} }] }));

try {
  const database = await runtime.getD1Database("DB");
  const schema = await readFile(new URL("schema.sql", import.meta.url), "utf8");
  for (const statement of schema.split(";").map(value => value.trim()).filter(Boolean)) await database.prepare(statement).run();
  const admin = (path, body = {}) => runtime.dispatchFetch(`https://alerts.test/admin/${path}`, { method: "POST", headers: { Authorization: "Bearer test-admin", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const enrollment = await admin("enroll", { email: "owner@example.test" });
  assert.equal(enrollment.status, 200);
  assert.equal((await enrollment.json()).welcomeDelivered, true);
  assert.equal(messages.length, 1);
  const token = messages[0].body.match(/#token=([a-f0-9]{64})/)[1];
  const preference = (method = "GET", body) => runtime.dispatchFetch("https://alerts.test/preferences", { method, headers: { Authorization: `Bearer ${token}`, Origin: "https://fbp26.github.io", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const original = await (await preference()).json();
  assert.equal(original.rules.length, 2);
  assert.equal(original.email, "owner@example.test");
  assert.equal((await (await admin("check")).json()).sent, 1);
  assert.equal((await (await admin("check")).json()).sent, 0);
  assert.equal(messages.length, 2);
  assert.match(messages[1].body, /Spring Creek Golf Club/);
  assert.match(messages[1].body, /Magnolia Green Golf Club/);
  feed.teeTimes[0].allInPrice = 118;
  acceptEmail = false;
  assert.equal((await (await admin("check")).json()).sent, 0);
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM sent_matches").first()).total, 1);
  acceptEmail = true;
  assert.equal((await (await admin("check")).json()).sent, 1);
  assert.equal((await database.prepare("SELECT COUNT(*) AS total FROM sent_matches").first()).total, 2);
  const saved = await preference("PUT", { ...original, paused: true });
  assert.equal(saved.status, 200);
  assert.equal((await preference("PUT", { ...original, paused: false })).status, 409);
  assert.equal((await (await preference()).json()).paused, true);
  assert.equal((await (await admin("check")).json()).sent, 0);
  assert.equal((await admin("enroll", { email: "owner@example.test" })).status, 200);
  assert.equal(messages.length, 3);
  await database.prepare("UPDATE access_tokens SET expires_at=0").run();
  assert.equal((await preference()).status, 401);
  const stored = await database.prepare("SELECT digest FROM access_tokens LIMIT 1").first();
  assert.notEqual(stored.digest, token);
  for (let attempt = 0; attempt < 4; attempt++) {
    const delivery = Promise.withResolvers();
    onDelivery = delivery.resolve;
    const recovery = await runtime.dispatchFetch("https://alerts.test/request-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@example.test" }) });
    assert.equal(recovery.status, 202);
    if (attempt < 3) await delivery.promise;
  }
  assert.equal(messages.length, 6);
  assert.match(messages.at(-1).body, /all paused/);
  console.log("PASS: D1 enrollment, welcome summary/link, matching delivery, failed-delivery retry, deduplication, preferences, version conflicts, pause, token hashing/expiry and rate-limited recovery. All email was mocked.");
} finally { await runtime.dispose(); }
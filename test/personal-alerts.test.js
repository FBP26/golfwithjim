import assert from "node:assert/strict";
import test from "node:test";
import { defaultAlerts, validateAlerts, matchesAlert, alertSummary } from "../src/personal-alerts.js";
import worker, { selectMatches, formatPersonalEmail, tokenDigest } from "../alert-worker/worker.js";

const now = new Date("2026-09-25T12:00:00Z");
const teeTime = { course: "Magnolia Green Golf Club", date: "2026-09-26", time: "10:00 AM", allInPrice: 130, holes: 18, priceIsExact: true, availablePlayers: 4, availablePartySizes: [2, 4], rateName: "Public 18 Holes" };

test("Magnolia Saturday cutoff includes 10 AM and excludes later or other days", () => {
  assert.equal(matchesAlert(teeTime, defaultAlerts[0], now), true);
  assert.equal(matchesAlert({ ...teeTime, time: "10:01 AM" }, defaultAlerts[0], now), false);
  assert.equal(matchesAlert({ ...teeTime, date: "2026-09-27" }, defaultAlerts[0], now), false);
});

test("Spring Creek is strictly below $120 and matches every day", () => {
  assert.equal(matchesAlert({ ...teeTime, course: "Spring Creek Golf Club", allInPrice: 119.99 }, defaultAlerts[1], now), true);
  assert.equal(matchesAlert({ ...teeTime, course: "Spring Creek Golf Club", allInPrice: 120 }, defaultAlerts[1], now), false);
});

test("personal alerts reject stale, inexact, restricted, past, and incompatible party offers", () => {
  for (const change of [{ stale: true }, { priceIsExact: false }, { rateName: "Senior" }, { holes: 9 }, { availablePlayers: 0 }, { date: "2026-09-19" }]) assert.equal(matchesAlert({ ...teeTime, ...change }, defaultAlerts[0], now), false);
  assert.equal(matchesAlert(teeTime, { ...defaultAlerts[0], players: 3 }, now), false);
  assert.equal(matchesAlert(teeTime, { ...defaultAlerts[0], players: 2 }, now), true);
  assert.equal(matchesAlert(teeTime, defaultAlerts[0], new Date("2026-09-26T14:01:00Z")), false);
});

test("rules validate editable fields and summaries include paused rules and limits", () => {
  const courses = defaultAlerts.map(rule => rule.course);
  assert.deepEqual(validateAlerts(defaultAlerts, courses), defaultAlerts);
  for (const change of [{ days: [] }, { from: "25:00" }, { until: "00:00", from: "10:00" }, { maxPrice: -1 }, { players: 5 }, { startDate: "2026-02-30" }, { course: "Unknown" }]) assert.throws(() => validateAlerts([{ ...defaultAlerts[0], ...change }], courses));
  assert.match(alertSummary({ ...defaultAlerts[0], enabled: false }), /Paused:.*Sat.*10:00.*Eastern.*18 holes/);
});

test("feed checks reject stale observations and suppress already delivered matching starts", () => {
  const feed = { checkedAt: now.toISOString(), sourceChecks: [{ course: teeTime.course, checkedAt: now.toISOString() }], teeTimes: [teeTime, { ...teeTime, source: "Other provider" }] };
  const matches = selectMatches(feed, defaultAlerts, new Set(), now);
  assert.equal(matches.length, 1);
  assert.equal(selectMatches(feed, defaultAlerts, new Set([matches[0].key]), now).length, 0);
  assert.equal(selectMatches({ ...feed, checkedAt: "2026-09-01T00:00:00Z" }, defaultAlerts, new Set(), now).length, 0);
  assert.equal(selectMatches({ ...feed, sourceChecks: [{ ...feed.sourceChecks[0], error: "Failed" }] }, defaultAlerts, new Set(), now).length, 0);
});

test("emails include all saved rules and a private management link", () => {
  const message = formatPersonalEmail(defaultAlerts, [{ teeTime }], "https://example.test/alerts#token=secret", now.toISOString());
  assert.match(message.body, /Magnolia Green.*Sat/);
  assert.match(message.body, /Spring Creek.*119\.99/);
  assert.match(message.body, /Manage, pause, or remove/);
  assert.match(message.htmlBody, /#token=secret/);
});

test("private endpoints reject missing tokens and cross-origin writes; preflight has no body", async () => {
  assert.equal((await worker.fetch(new Request("https://alerts.test/preferences"), {})).status, 401);
  assert.equal((await worker.fetch(new Request("https://alerts.test/preferences", { method: "PUT", headers: { Origin: "https://evil.test" } }), {})).status, 403);
  const preflight = await worker.fetch(new Request("https://alerts.test/preferences", { method: "OPTIONS" }), {});
  assert.equal(preflight.status, 204);
  assert.equal(await preflight.text(), "");
  assert.equal((await tokenDigest("example")).length, 64);
});
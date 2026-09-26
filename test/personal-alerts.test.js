import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { defaultAlerts, validateAlerts, matchesAlert, alertSummary, alertCourseGroups } from "../src/personal-alerts.js";
import worker, { selectMatches, formatPersonalEmail, tokenDigest } from "../alert-worker/worker.js";
import { validateSubscription } from "../alert-worker/push.js";
import { shortCourseName } from "../src/dashboard.js";

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
  assert.match(message.htmlBody, /display:inline-block[^>]+>Manage alerts<\/a>/);
  assert.match(message.htmlBody, /display:inline-block[^>]+>Book tee time<\/a>/);
});

test("private endpoints reject missing tokens and cross-origin writes; preflight has no body", async () => {
  assert.equal((await worker.fetch(new Request("https://alerts.test/preferences"), {})).status, 401);
  assert.equal((await worker.fetch(new Request("https://alerts.test/preferences", { method: "PUT", headers: { Origin: "https://evil.test" } }), {})).status, 403);
  const preflight = await worker.fetch(new Request("https://alerts.test/preferences", { method: "OPTIONS" }), {});
  assert.equal(preflight.status, 204);
  assert.equal(await preflight.text(), "");
  assert.equal((await tokenDigest("example")).length, 64);
});

test("push subscriptions accept known providers and reject arbitrary outbound destinations", () => {
  const subscription = { endpoint: "https://web.push.apple.com/example", keys: { p256dh: "A".repeat(87), auth: "A".repeat(22) } };
  assert.equal(validateSubscription(subscription).endpoint, subscription.endpoint);
  for (const endpoint of ["http://web.push.apple.com/test", "https://localhost/test", "https://web.push.apple.com.evil.test/test", "https://web.push.apple.com:444/test", "https://user:pass@web.push.apple.com/test"]) assert.throws(() => validateSubscription({ ...subscription, endpoint }));
  assert.throws(() => validateSubscription({ ...subscription, keys: {} }));
});

test("service worker displays push notifications and restricts click destinations to the app", async () => {
  const handlers = {};
  const displayed = [];
  const opened = [];
  let pending;
  const scope = "https://fbp26.github.io/golfwithjim/";
  const self = {
    addEventListener: (name, handler) => { handlers[name] = handler; },
    registration: { scope, showNotification: async (title, options) => { displayed.push({ title, ...options }); } },
    clients: { matchAll: async () => [], openWindow: async url => { opened.push(url); } },
  };
  runInNewContext(readFileSync(new URL("../public/sw.js", import.meta.url), "utf8"), { self, URL });
  const waitUntil = promise => { pending = promise; };
  const notificationUrl = "./?notification=11111111-1111-4111-8111-111111111111";
  handlers.push({ data: { json: () => ({ title: "Matching tee time", body: "Highlands $60", url: notificationUrl }) }, waitUntil });
  await pending;
  assert.equal(displayed[0].title, "Matching tee time");
  assert.equal(displayed[0].icon, `${scope}golf-icon.png`);
  handlers.push({ data: { json: () => { throw new Error("Invalid JSON"); } }, waitUntil });
  await pending;
  assert.equal(displayed[1].title, "Golf With Jim");
  for (const url of [notificationUrl, "https://evil.test/"]) {
    handlers.notificationclick({ notification: { close() {}, data: { url } }, waitUntil });
    await pending;
  }
  assert.deepEqual(opened, [`${scope}?notification=11111111-1111-4111-8111-111111111111`, scope]);
  const navigated = [];
  let focused = false;
  self.clients.matchAll = async () => [{ url: `${scope}alerts.html`, navigate: async url => { navigated.push(url); }, focus: async () => { focused = true; } }];
  handlers.notificationclick({ notification: { close() {}, data: displayed[0].data }, waitUntil });
  await pending;
  assert.deepEqual(navigated, [opened[0]]);
  assert.equal(focused, true);
  assert.equal(handlers.fetch, undefined);
});

test("All, Local and Regional alert groups validate and preserve other alert limits", () => {
  assert.deepEqual(alertCourseGroups.map(group => group.label), ["All courses", "Local courses", "Regional courses"]);
  for (const group of alertCourseGroups) assert.equal(validateAlerts([{ ...defaultAlerts[0], course: group.value }], [])[0].course, group.value);
  const local = { ...teeTime, course: "Stonehouse Golf Club" };
  const regional = { ...teeTime, course: "Regional Test Course" };
  const rule = { ...defaultAlerts[0], course: "group:local" };
  assert.equal(matchesAlert(local, rule, now), true);
  assert.equal(matchesAlert(regional, rule, now), false);
  assert.equal(matchesAlert(local, { ...rule, course: "group:regional" }, now), false);
  assert.equal(matchesAlert(regional, { ...rule, course: "group:regional" }, now), true);
  for (const offer of [local, regional]) assert.equal(matchesAlert(offer, { ...rule, course: "group:all" }, now), true);
  assert.equal(matchesAlert({ ...local, allInPrice: 61 }, { ...rule, maxPrice: 60 }, now), false);
  assert.equal(matchesAlert({ ...local, time: "10:01 AM" }, rule, now), false);
  assert.throws(() => validateAlerts([{ ...rule, course: "group:unknown" }], []));
  assert.match(alertSummary(rule), /Local courses/);
});

test("group matching excludes link-only courses and keeps per-course deduplication", () => {
  const rules = [{ ...defaultAlerts[0], course: "group:all" }];
  const feed = { checkedAt: now.toISOString(), courses: [{ course: teeTime.course, collector: "golfnow" }, { course: "Link only" }], sourceChecks: [{ course: teeTime.course, checkedAt: now.toISOString() }, { course: "Link only", checkedAt: now.toISOString() }], teeTimes: [teeTime, { ...teeTime, course: "Link only" }] };
  const matches = selectMatches(feed, rules, new Set(), now);
  assert.equal(matches.length, 1);
  assert.equal(selectMatches(feed, rules, new Set(matches.map(match => match.key)), now).length, 0);
});

test("alert dropdown labels use established short names while retaining canonical values", () => {
  const courses = ["The Club at Viniterra", "Mill Quarter Plantation Golf Club", "The Golf Club at The Highlands", "Hanover Golf Club", "Independence Championship Course"];
  const options = courses.map(value => ({ value, label: shortCourseName(value) })).sort((left, right) => left.label.localeCompare(right.label));
  assert.deepEqual(options.map(option => option.label), ["Hanover", "Highlands", "Independence", "Mill Quarter", "Viniterra"]);
  assert.equal(options[1].value, "The Golf Club at The Highlands");
});
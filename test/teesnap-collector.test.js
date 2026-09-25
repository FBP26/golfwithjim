import assert from "node:assert/strict";
import test from "node:test";
import { collectLiveInventory, mergeCollectedInventory } from "../src/collect.js";
import { extractTeeSnapInventory } from "../src/collectors/teesnap.js";

const price = (roundType, priceWithAddOn) => ({ roundType, priceWithAddOn, rackRateName: "Public with cart" });
const section = (bookings = [], isHeld = false) => ({ teeOff: "FRONT_NINE", bookings, isHeld });
const teeTime = (time, options = {}) => ({
  teeTime: `2026-09-17T${time}:00`,
  prices: options.prices || [price("NINE_HOLE", 27), price("EIGHTEEN_HOLE", 50)],
  teeOffSections: [section(options.bookings, options.isHeld)],
});

test("extracts every Queenfield 18-hole start including single openings", () => {
  const result = extractTeeSnapInventory({ teeTimes: {
    bookings: [
      { bookingId: 10, golfers: [101] },
      { bookingId: 20, golfers: [201, 202, 203] },
    ],
    teeTimes: [
      teeTime("08:40", { bookings: [10] }),
      teeTime("08:50"),
      teeTime("09:00", { bookings: [20] }),
      teeTime("09:10", { isHeld: true }),
      teeTime("09:20", { prices: [price("NINE_HOLE", 27)] }),
      teeTime("09:30", { bookings: [999] }),
    ],
  } }, {
    courseId: "1512",
    course: "Queenfield Golf Club",
    distanceMiles: 29,
    url: "https://queenfieldgc.teesnap.net/?date=2026-09-17",
  });

  assert.deepEqual(result.map(item => ({ time: item.time, players: item.availablePlayers, price: item.allInPrice })), [
    { time: "8:40 AM", players: 3, price: 50 },
    { time: "8:50 AM", players: 4, price: 50 },
    { time: "9:00 AM", players: 1, price: 50 },
  ]);
  assert.equal(result[0].holes, 18);
  assert.equal(result[0].rateName, "Public with cart");
  assert.equal(JSON.stringify(result).includes("bookingId"), false);
  assert.equal(JSON.stringify(result).includes("101"), false);
});

test("collects every configured live source for every requested date", async () => {
  const requested = [];
  const result = await collectLiveInventory({
    registry: { interactiveOnly: [{
      collector: "teesnap",
      providerCourseId: "1512",
      source: "TeeSnap",
      course: "Queenfield Golf Club",
      distanceMiles: 29,
      url: "https://queenfieldgc.teesnap.net/",
    }] },
    dates: ["2026-09-17", "2026-09-18"],
    fetchImpl: async url => {
      requested.push(String(url));
      const date = new URL(url).searchParams.get("date");
      return { ok: true, json: async () => ({ teeTimes: { bookings: [], teeTimes: [teeTime("08:40")].map(item => ({ ...item, teeTime: `${date}T08:40:00` })) } }) };
    },
  });

  assert.equal(result.teeTimes.length, 2);
  assert.deepEqual(result.teeTimes.map(item => item.date), ["2026-09-17", "2026-09-18"]);
  assert.ok(requested.every(url => url.includes("players=1") && url.includes("holes=18") && url.includes("addons=on")));
});

test("honors a shorter per-source collection window", async () => {
  let requests = 0;
  await collectLiveInventory({
    registry: { interactiveOnly: [{
      collector: "teesnap",
      collectionDays: 2,
      providerCourseId: "1512",
      source: "TeeSnap",
      course: "Queenfield Golf Club",
      distanceMiles: 29,
      url: "https://queenfieldgc.teesnap.net/",
    }] },
    dates: ["2026-09-17", "2026-09-18", "2026-09-19"],
    fetchImpl: async () => {
      requests += 1;
      return { ok: true, json: async () => ({ teeTimes: { bookings: [], teeTimes: [] } }) };
    },
  });

  assert.equal(requests, 2);
});

test("replaces collector-owned minima while preserving other saved coverage", () => {
  const result = mergeCollectedInventory({ teeTimes: [
    { id: "old-queenfield", course: "Queenfield Golf Club" },
    { id: "other", course: "Other Course" },
  ] }, {
    checkedAt: "2026-09-16T12:00:00Z",
    sources: ["Queenfield Golf Club"],
    teeTimes: [{ id: "new-one", course: "Queenfield Golf Club" }, { id: "new-two", course: "Queenfield Golf Club" }],
  });

  assert.deepEqual(result.teeTimes.map(item => item.id), ["other", "new-one", "new-two"]);
  assert.deepEqual(result.completeSources, ["Queenfield Golf Club"]);
});

test("preserves a previous source feed when that collector fails", () => {
  const result = mergeCollectedInventory({ teeTimes: [
    { id: "old-sycamore", course: "Sycamore Creek Golf Course" },
  ] }, {
    checkedAt: "2026-09-19T18:00:00Z",
    sources: [],
    teeTimes: [],
  });

  assert.deepEqual(result.teeTimes.map(item => item.id), ["old-sycamore"]);
  assert.equal(result.teeTimes[0].stale, true);
});

test("targeted refresh preserves untouched inventory and source status", () => {
  const untouched = { id: "other", course: "Other Course", stale: false };
  const otherCheck = { course: "Other Course", checkedAt: "2026-09-25T10:00:00Z" };
  const result = mergeCollectedInventory({
    teeTimes: [untouched, { id: "old", course: "Sycamore Creek Golf Course" }],
    completeSources: ["Other Course", "Sycamore Creek Golf Course"],
    sourceChecks: [otherCheck, { course: "Sycamore Creek Golf Course", error: "HTTP 403" }],
  }, {
    checkedAt: "2026-09-25T11:00:00Z", sources: ["Sycamore Creek Golf Course"],
    sourceChecks: [{ course: "Sycamore Creek Golf Course", teeTimeCount: 1 }],
    teeTimes: [{ id: "new", course: "Sycamore Creek Golf Course" }],
  }, { partial: true });
  assert.deepEqual(result.teeTimes, [untouched, { id: "new", course: "Sycamore Creek Golf Course" }]);
  assert.deepEqual(result.sourceChecks, [otherCheck, { course: "Sycamore Creek Golf Course", teeTimeCount: 1 }]);
  assert.deepEqual(result.completeSources, ["Other Course", "Sycamore Creek Golf Course"]);
});

test("failed targeted refresh flags only that course as stale", () => {
  const result = mergeCollectedInventory({
    teeTimes: [{ course: "Other Course" }, { course: "Sycamore Creek Golf Course" }],
    completeSources: ["Other Course", "Sycamore Creek Golf Course"],
    sourceChecks: [{ course: "Other Course" }],
  }, {
    sources: [], teeTimes: [],
    sourceChecks: [{ course: "Sycamore Creek Golf Course", error: "HTTP 403" }],
  }, { partial: true });
  assert.equal(result.teeTimes[0].stale, undefined);
  assert.equal(result.teeTimes[1].stale, true);
  assert.deepEqual(result.completeSources, ["Other Course"]);
  assert.equal(result.sourceChecks.length, 2);
});
import assert from "node:assert/strict";
import test from "node:test";
import { isEligible, isUpcoming, normalizeTeeTime, nowMinutes, parseTimeMinutes, todayIso } from "../src/analyze.js";
import { adaptChronogolfTeeTime } from "../src/adapters/chronogolf.js";
import { adaptClubCaddieTeeTime } from "../src/adapters/clubcaddie.js";
import { adaptForeUpTeeTime } from "../src/adapters/foreup.js";
import { adaptPlay18TeeTime } from "../src/adapters/play18.js";
import { adaptTeeSnapTeeTime } from "../src/adapters/teesnap.js";
import { adaptTeeItUpTeeTime } from "../src/adapters/teeitup.js";
import { adaptWhooshTeeTime } from "../src/adapters/whoosh.js";

const config = {
  minimumPlayers: 2,
  maximumDistanceMiles: 50,
  minimumDropDollars: 10,
  minimumDropPercent: 0.15,
};

const teeTime = overrides => normalizeTeeTime({
  id: "one",
  source: "Approved feed",
  course: "Providence Golf Club",
  date: "2026-09-19",
  time: "12:10 PM",
  availablePlayers: 4,
  holes: 18,
  allInPrice: 75,
  distanceMiles: 7,
  url: "https://example.com/book",
  ...overrides,
});

test("preserves a provider's observed daily availability count", () => {
  assert.equal(teeTime({ dailyAvailableCount: 23 }).dailyAvailableCount, 23);
});

test("requires two players, stays within 50 miles, and rejects restricted rates", () => {
  assert.equal(isEligible(teeTime({}), config), true);
  assert.equal(isEligible(teeTime({ stale: true }), config), false);
  assert.equal(isEligible(teeTime({ availablePlayers: 1 }), config), false);
  assert.equal(isEligible(teeTime({ distanceMiles: 51 }), config), false);
  assert.equal(isEligible(teeTime({ rateName: "Military special" }), config), false);
  assert.equal(isEligible(teeTime({ rateName: "Junior walking" }), config), false);
  assert.equal(isEligible(teeTime({ rateName: "Club member" }), config), false);
  assert.equal(isEligible(teeTime({ rateName: "GolfPass member", golfPassEligible: true }), config), true);
});

test("uses an explicit GolfPass all-in price as the effective price", () => {
  const result = teeTime({ standardAllInPrice: 75, golfPassAllInPrice: 69, golfPassEligible: true });
  assert.equal(result.allInPrice, 69);
  assert.equal(result.standardAllInPrice, 75);
});

test("categorizes provider Hot Deals and verified GolfPass prices as hot deals", () => {
  assert.equal(normalizeTeeTime(teeTime({ providerHotDeal: true })).hotDeal, true);
  assert.equal(normalizeTeeTime(teeTime({
    standardAllInPrice: 75,
    golfPassAllInPrice: 69,
    golfPassEligible: true,
  })).hotDeal, true);
});

test("todayIso returns the current date in the requested time zone", () => {
  const expected = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  assert.equal(todayIso(), expected);
});

test("parseTimeMinutes converts 12-hour clock times to minutes since midnight", () => {
  assert.equal(parseTimeMinutes("12:00 AM"), 0);
  assert.equal(parseTimeMinutes("12:30 PM"), 750);
  assert.equal(parseTimeMinutes("11:59 PM"), 1439);
  assert.equal(parseTimeMinutes("garbage"), Number.POSITIVE_INFINITY);
});

test("isUpcoming always keeps future dates and drops past dates regardless of time", () => {
  const today = todayIso();
  const yesterday = new Date(`${today}T12:00:00Z`);
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);

  assert.equal(isUpcoming({ date: tomorrow.toISOString().slice(0, 10), time: "12:01 AM" }), true);
  assert.equal(isUpcoming({ date: yesterday.toISOString().slice(0, 10), time: "11:59 PM" }), false);
});

test("isUpcoming drops same-day times that have already passed and keeps ones still ahead", () => {
  const today = todayIso();
  const currentMinutes = nowMinutes();
  const minutesToTime = minutes => {
    const wrapped = ((minutes % 1440) + 1440) % 1440;
    const hour24 = Math.floor(wrapped / 60);
    const minute = wrapped % 60;
    const period = hour24 >= 12 ? "PM" : "AM";
    return `${hour24 % 12 || 12}:${String(minute).padStart(2, "0")} ${period}`;
  };

  assert.equal(isUpcoming({ date: today, time: minutesToTime(currentMinutes + 10) }), true);
  assert.equal(isUpcoming({ date: today, time: minutesToTime(currentMinutes - 10) }), false);
});

test("adapts Chronogolf player ranges but rejects unconfirmed from-prices", () => {
  const estimated = normalizeTeeTime(adaptChronogolfTeeTime({
    time: "8:24 AM", price: 37, players: "1 - 2", holes: [3, 9, 18],
  }, { course: "Sycamore Creek", date: "2026-09-16", distanceMiles: 20 }));
  const exact = normalizeTeeTime(adaptChronogolfTeeTime({
    time: "10:48 AM", exactPrice: 59, players: "1 - 4", holes: [3, 9, 18],
  }, { course: "Sycamore Creek", date: "2026-09-16", distanceMiles: 20 }));

  assert.equal(estimated.availablePlayers, 2);
  assert.equal(estimated.holes, 18);
  assert.equal(isEligible(estimated, config), false);
  assert.equal(isEligible(exact, config), true);
});

test("accepts public member-for-a-day offers but rejects member-only rates", () => {
  const publicOffer = normalizeTeeTime(teeTime({ rateName: "Member for a Day - Meal Included" }));
  const memberOnly = normalizeTeeTime(teeTime({ rateName: "Member Rate" }));

  assert.equal(isEligible(publicOffer, config), true);
  assert.equal(isEligible(memberOnly, config), false);
});

test("adapts exact ForeUp rates and prefers 18 holes when both are offered", () => {
  const result = normalizeTeeTime(adaptForeUpTeeTime({
    time: "2:00 PM", price: 65, players: "4 Players", holes: [9, 18], rateName: "PG",
  }, { course: "Pendleton Golf Club", date: "2026-09-16", distanceMiles: 45 }));

  assert.equal(result.availablePlayers, 4);
  assert.equal(result.holes, 18);
  assert.equal(result.allInPrice, 65);
  assert.equal(isEligible(result, config), true);
});

test("adapts Hunting Hawk Play18 player ranges and exact rates", () => {
  const result = normalizeTeeTime(adaptPlay18TeeTime({
    time: "4:36 PM", price: 49, players: "2 to 4 players", holes: 18,
  }, { course: "Hunting Hawk Golf Club", date: "2026-09-16", distanceMiles: 24 }));

  assert.equal(result.availablePlayers, 4);
  assert.equal(result.allInPrice, 49);
  assert.equal(isEligible(result, config), true);
});

test("adapts Queenfield TeeSnap slots and cart-inclusive rates", () => {
  const result = normalizeTeeTime(adaptTeeSnapTeeTime({
    time: "3:00 PM", price: 38, slotsAvailable: 4, holes: 18,
  }, { course: "Queenfield Golf Club", date: "2026-09-16", distanceMiles: 29 }));

  assert.equal(result.availablePlayers, 4);
  assert.equal(result.allInPrice, 38);
  assert.equal(result.rateName, "Standard with cart");
  assert.equal(isEligible(result, config), true);
});

test("keeps Whoosh price ranges out of alerts until an exact rate is selected", () => {
  const estimated = normalizeTeeTime(adaptWhooshTeeTime({
    time: "7:20 AM", maximumPrice: 50, players: "Up to 4", holes: [9, 18],
  }, { course: "Windy Hill Lake Course", date: "2026-09-16", distanceMiles: 23 }));
  const exact = normalizeTeeTime(adaptWhooshTeeTime({
    time: "8:00 AM", exactPrice: 50, players: "Up to 4", holes: [9, 18],
  }, { course: "Windy Hill Lake Course", date: "2026-09-16", distanceMiles: 23 }));

  assert.equal(isEligible(estimated, config), false);
  assert.equal(isEligible(exact, config), true);
});

test("requires an exact selected TeeItUp rate and preserves explicit benefits", () => {
  const estimated = normalizeTeeTime(adaptTeeItUpTeeTime({
    time: "9:10 AM", price: 74, players: "1-4 golfers", holes: [9, 18],
  }, { course: "Magnolia Green Golf Club", date: "2026-09-17", distanceMiles: 26 }));
  const exact = normalizeTeeTime(adaptTeeItUpTeeTime({
    time: "9:20 AM", exactPrice: 69, players: "1-4 golfers", holes: [9, 18], hotDeal: true,
  }, { course: "Magnolia Green Golf Club", date: "2026-09-17", distanceMiles: 26 }));

  assert.equal(isEligible(estimated, config), false);
  assert.equal(exact.hotDeal, true);
  assert.equal(isEligible(exact, config), true);
});

test("requires an exact selected Club Caddie rate", () => {
  const estimated = normalizeTeeTime(adaptClubCaddieTeeTime({
    time: "10:00 AM", price: 145, players: "1-4", holes: 18,
  }, { course: "Independence Championship Course", date: "2026-09-17", distanceMiles: 20 }));
  const exact = normalizeTeeTime(adaptClubCaddieTeeTime({
    time: "10:10 AM", exactPrice: 145, players: "1-4", holes: 18,
  }, { course: "Independence Championship Course", date: "2026-09-17", distanceMiles: 20 }));

  assert.equal(isEligible(estimated, config), false);
  assert.equal(isEligible(exact, config), true);
});

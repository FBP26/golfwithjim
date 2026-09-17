import assert from "node:assert/strict";
import test from "node:test";
import { findPriceBreaks, isEligible, newestAvailableDate, normalizeTeeTime, todayIso } from "../src/analyze.js";
import { adaptChronogolfTeeTime } from "../src/adapters/chronogolf.js";
import { adaptClubCaddieTeeTime } from "../src/adapters/clubcaddie.js";
import { adaptForeUpTeeTime } from "../src/adapters/foreup.js";
import { adaptPlay18TeeTime } from "../src/adapters/play18.js";
import { adaptTeeSnapTeeTime } from "../src/adapters/teesnap.js";
import { adaptTeeItUpTeeTime } from "../src/adapters/teeitup.js";
import { adaptWhooshTeeTime } from "../src/adapters/whoosh.js";
import { formatDailyDigest } from "../src/email.js";
import { findChangedDeals, nextState } from "../src/state.js";

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

test("finds hot deals and material drops against adjacent 18-hole times", () => {
  const times = [
    teeTime({ id: "early", time: "10:00 AM", allInPrice: 90 }),
    teeTime({ id: "drop", time: "10:10 AM", allInPrice: 70 }),
    teeTime({ id: "later", time: "10:20 AM", allInPrice: 95 }),
    teeTime({ id: "hot", time: "12:00 PM", allInPrice: 89, hotDeal: true }),
    teeTime({ id: "nine", time: "3:00 PM", allInPrice: 40, holes: 9 }),
  ];

  assert.deepEqual(findPriceBreaks(times, config).map(result => result.id), ["drop", "hot"]);
});

test("todayIso returns the current date in the requested time zone", () => {
  const expected = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
  assert.equal(todayIso(), expected);
});

test("reports the farthest date currently posted", () => {
  assert.equal(newestAvailableDate([
    teeTime({ date: "2026-09-17" }),
    teeTime({ date: "2026-09-25" }),
    teeTime({ date: "2026-09-21" }),
  ]), "2026-09-25");
});

test("alerts on a material observed price drop even without an adjacent-time break", () => {
  const original = teeTime({ id: "drop", allInPrice: 100, time: "8:00 AM" });
  const current = teeTime({ id: "drop", allInPrice: 80, time: "8:00 AM" });
  const previous = nextState([original], original.date, "2026-09-16T08:00:00Z");
  const changes = findChangedDeals([current], [], previous, config);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "price-drop");
  assert.equal(changes[0].previousPrice, 100);
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

test("daily email reports total coverage separately from available courses", () => {
  const message = formatDailyDigest(
    [
      teeTime({ id: "early-one", course: "Providence Golf Club", time: "8:00 AM", allInPrice: 55 }),
      teeTime({ id: "early-two", course: "Providence Golf Club", time: "8:10 AM", allInPrice: 52 }),
      teeTime({ id: "early-three", course: "Providence Golf Club", time: "8:20 AM", allInPrice: 52 }),
      teeTime({ id: "early-four", course: "Providence Golf Club", time: "8:30 AM", allInPrice: 52 }),
      teeTime({ id: "later", course: "Providence Golf Club", time: "11:00 AM", allInPrice: 60, hotDeal: true }),
      teeTime({ id: "two", course: "The Hollows Golf Club" }),
    ],
    "2026-09-19",
    { ...config, preferredHoles: 18, detailedDays: 7 },
    "2026-09-16T08:00:00Z",
    true,
    {
      interactiveOnly: [{ course: "Providence Golf Club", source: "GolfNow Marketplace", url: "https://example.com/search#old" }, { course: "The Hollows Golf Club" }, { course: "Link Only", source: "Chronogolf", url: "https://example.com/link", showInventory: false }, { course: "Elson Redmond Memorial Driving Range", source: "First Tee", url: "https://firsttee.example.com", showInventory: false }, { course: "Spring Creek Golf Club", source: "Private club", url: "https://springcreek.example.com", showInventory: false }],
      dealSources: [{ course: "Stonehouse Golf Club", price: 124, players: 2, holes: 18, cartIncluded: true, url: "https://example.com/deal" }],
      manualOnly: [{ course: "Brookwoods Golf Club", phone: "804-932-3737" }, { course: "Glenwood Golf Club", closed: true, reason: "Closed" }],
    },
  );

  assert.match(message.htmlBody, /Daily availability/);
  assert.match(message.htmlBody, /<th>Regular<\/th><th>Hot Deals<\/th>/);
  assert.match(message.htmlBody, /<small>Every 10 min<\/small>/);
  assert.doesNotMatch(message.htmlBody, /Starts mostly/);
  assert.doesNotMatch(message.htmlBody, /8:10a-8:30a every/);
  assert.match(message.htmlBody, /\$55\.00<\/b><br>8a<br><b>\$52\.00<\/b><br>8:10a-8:30a/);
  assert.doesNotMatch(message.htmlBody, />8a<\/a>/);
  assert.match(message.htmlBody, /<a href="https:\/\/example\.com\/search#date=2026-09-19">Providence Golf Club<\/a>/);
  assert.match(message.htmlBody, /<td><b>\$60\.00<\/b><br>11a<\/td>/);
  assert.match(message.htmlBody, /Other courses/);
  assert.match(message.htmlBody, /<a href="https:\/\/example\.com\/link">Link Only<\/a>/);
  assert.match(message.htmlBody, /<a href="https:\/\/firsttee\.example\.com">Elson Redmond Memorial Driving Range<\/a>/);
  assert.match(message.htmlBody, /<a href="https:\/\/springcreek\.example\.com">Spring Creek Golf Club<\/a>/);
  assert.match(message.htmlBody, /804-932-3737/);
  assert.doesNotMatch(message.htmlBody, /Glenwood Golf Club/);
  assert.doesNotMatch(message.htmlBody, /Check tee times/);
  assert.match(message.subject, /2 priced courses through 2026-09-19/);
});
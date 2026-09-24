import assert from "node:assert/strict";
import test from "node:test";
import { extractGolfNowInventory, collectGolfNowDay } from "../src/collectors/golfnow.js";

const money = value => ({ value });

test("serializes course requests and honors a rate-limit retry", async () => {
  let active = 0;
  let peak = 0;
  let calls = 0;
  const fetchImpl = async () => {
    active++;
    peak = Math.max(peak, active);
    await Promise.resolve();
    active--;
    calls++;
    if (calls === 1) return { ok: false, status: 429, headers: new Headers({ "retry-after": "0.001" }) };
    return { ok: true, json: async () => ({ ttResults: { teeTimes: [] } }) };
  };
  await Promise.all([1, 2].map(facilityId => collectGolfNowDay({ facilityId, date: "2026-09-26", course: "Test", distanceMiles: 20, fetchImpl })));
  assert.equal(peak, 1);
  assert.equal(calls, 9);
});

test("verifies party sizes instead of converting Any to four and retains public alternatives", async () => {
  const requested = [];
  const result = await collectGolfNowDay({ facilityId: 2473, date: "2026-09-26", course: "Hollows", fetchImpl: async (_url, options) => {
    const players = JSON.parse(options.body).players;
    requested.push(players);
    return new Response(JSON.stringify({ ttResults: { teeTimes: players > 2 ? [] : [{
      time: { formatted: "9:12", formattedTimeMeridian: "AM" }, playerRule: "Any",
      teeTimeRates: [rate({ playerRule: "Any", rateName: "Senior" }), rate({ playerRule: "Any", teeTimeRateId: 456, rateName: "Prepaid" })],
    }] } }));
  } });
  assert.deepEqual(requested, [1, 2, 3, 4]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].availablePartySizes, [1, 2]);
  assert.equal(result[0].availablePlayers, 2);
  assert.equal(result[0].rateName, "Prepaid");
});
const rate = (overrides = {}) => ({
  holeCount: 18,
  teeTimeRateId: 123,
  playerRule: "OneTwoThreeFour",
  isEighteen: true,
  isHotDeal: false,
  rateName: "18 Holes",
  detailUrl: "/tee-times/facility/16391/tee-time/123",
  singlePlayerPrice: {
    feeMessagingDisplayRates: {
      totalPrice: money(62.39),
    },
  },
  ...overrides,
});

test("extracts exact GolfNow 18-hole inventory for two or more players", () => {
  const result = extractGolfNowInventory({ ttResults: { teeTimes: [
    {
      time: { formatted: "11:20", formattedTimeMeridian: "AM" },
      playerRule: "OneTwoThreeFour",
      teeTimeRates: [rate()],
    },
    {
      time: { formatted: "11:30", formattedTimeMeridian: "AM" },
      playerRule: "One",
      teeTimeRates: [rate({ teeTimeRateId: 124, playerRule: "One" })],
    },
    {
      time: { formatted: "11:40", formattedTimeMeridian: "AM" },
      playerRule: "OneTwo",
      teeTimeRates: [rate({ teeTimeRateId: 125, isEighteen: false })],
    },
  ] } }, {
    course: "Birkdale Golf Club",
    date: "2026-09-16",
    distanceMiles: 17,
  });

  assert.deepEqual(result.map(item => ({ time: item.time, players: item.availablePlayers, price: item.allInPrice })), [
    { time: "11:20 AM", players: 4, price: 62.39 },
    { time: "11:30 AM", players: 1, price: 62.39 },
  ]);
  assert.equal(result[0].url, "https://www.golfnow.com/tee-times/facility/16391/tee-time/123");
});

test("accepts GolfNow Any player rules returned by a two-player search", () => {
  const result = extractGolfNowInventory({ ttResults: { teeTimes: [{
    time: { formatted: "8:10", formattedTimeMeridian: "AM" },
    playerRule: "Any",
    teeTimeRates: [rate({ playerRule: "Any" })],
  }] } }, {
    course: "Birkdale Golf Club",
    date: "2026-09-25",
    distanceMiles: 17,
    requestedPlayers: 2,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].availablePlayers, 2);
});

test("retains GolfNow one-player inventory for the optional one-player filter", () => {
  const result = extractGolfNowInventory({ ttResults: { teeTimes: [{
    time: { formatted: "7:10", formattedTimeMeridian: "AM" },
    playerRule: "One",
    teeTimeRates: [rate({ playerRule: "One", allInPrice: undefined, singlePlayerPrice: {
      feeMessagingDisplayRates: { totalPrice: money(39.99) },
    } })],
  }] } }, {
    course: "Birkdale Golf Club",
    date: "2026-09-25",
    distanceMiles: 17,
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].availablePlayers, 1);
  assert.equal(result[0].allInPrice, 39.99);
});
import assert from "node:assert/strict";
import test from "node:test";
import { extractGolfNowInventory } from "../src/collectors/golfnow.js";

const money = value => ({ value });
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
  });

  assert.equal(result.length, 1);
  assert.equal(result[0].availablePlayers, 4);
});
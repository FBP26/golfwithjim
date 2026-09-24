import assert from "node:assert/strict";
import test from "node:test";
import { collectTeeItUpDay, extractTeeItUpInventory } from "../src/collectors/teeitup.js";
import { filterTeeTimes } from "../src/dashboard.js";

const rate = (overrides = {}) => ({
  _id: 274086381,
  name: "18 Holes",
  holes: 18,
  greenFeeCart: 7000,
  transactionFees: 2.49,
  showTransactionFees: true,
  showAsHotDeal: false,
  ...overrides,
});

test("extracts the cheapest exact 18-hole rate for each tee time", () => {
  const payload = [{
    teetimes: [
      {
        teetime: "2026-09-19T15:54:00.000Z",
        maxPlayers: 4,
        rates: [
          rate({ _id: 8, name: "Senior", greenFeeCart: 1000 }),
          rate({ _id: 9, name: "Military", greenFeeCart: 1500 }),
          rate({ _id: 10, name: "Member", greenFeeCart: 2000 }),
          rate({ _id: 1, promotion: { greenFeeCart: 6900 } }),
          rate({ _id: 2, name: "9 Holes", holes: 9, greenFeeCart: 3700 }),
        ],
      },
      {
        teetime: "2026-09-19T12:48:00.000Z",
        maxPlayers: 1,
        rates: [rate({ _id: 3, greenFeeCart: 7000 })],
      },
    ],
  }];

  const result = extractTeeItUpInventory(payload, { course: "The Hollows Golf Club", date: "2026-09-19", distanceMiles: 29, url: "https://example.com" });

  assert.deepEqual(result.map(item => ({ time: item.time, players: item.availablePlayers, price: item.allInPrice })), [
    { time: "11:54 AM", players: 4, price: 71.49 },
    { time: "8:48 AM", players: 1, price: 72.49 },
  ]);
  assert.equal(result[0].holes, 18);
  assert.equal(result[0].priceIsExact, true);
  assert.equal(result[0].source, "GolfNow/TeeItUp");
});

test("keeps regular alternatives and applies each rate's allowed party sizes", () => {
  const payload = [{ teetimes: [{ teetime: "2026-09-26T14:00:00.000Z", maxPlayers: 4, rates: [
    rate({ _id: 11, name: "4 Player Promotion", allowedPlayers: [4], greenFeeCart: 4400 }),
    rate({ _id: 12, name: "18 Holes", allowedPlayers: [1, 2, 3, 4], greenFeeCart: 5400 }),
  ] }] }];
  const defaults = { course: "Highlands", date: "2026-09-26", distanceMiles: 24, url: "https://example.com" };
  const offers = extractTeeItUpInventory(payload, defaults);
  assert.equal(offers.length, 2);
  assert.deepEqual(offers[0].availablePartySizes, [4]);
  assert.deepEqual(filterTeeTimes(offers, { players: 2 }).map(offer => offer.rateName), ["18 Holes"]);
  assert.equal(filterTeeTimes(offers, { players: 4 }).length, 2);
  payload[0].teetimes[0].maxPlayers = 2;
  assert.deepEqual(extractTeeItUpInventory(payload, defaults).map(offer => offer.rateName), ["18 Holes"]);
});

test("skips tee times with no 18-hole rate and filters to the requested date", () => {
  const payload = [{
    teetimes: [
      { teetime: "2026-09-19T14:50:00.000Z", maxPlayers: 2, rates: [rate({ _id: 4, name: "9 Holes", holes: 9 })] },
      { teetime: "2026-09-20T14:00:00.000Z", maxPlayers: 4, rates: [rate({ _id: 5 })] },
    ],
  }];

  const result = extractTeeItUpInventory(payload, { course: "The Hollows Golf Club", date: "2026-09-19", distanceMiles: 29, url: "https://example.com" });
  assert.equal(result.length, 0);
});

test("marks hot deals reported by the provider", () => {
  const payload = [{ teetimes: [{ teetime: "2026-09-19T15:54:00.000Z", maxPlayers: 2, rates: [rate({ _id: 6, showAsHotDeal: true })] }] }];
  const result = extractTeeItUpInventory(payload, { course: "The Hollows Golf Club", date: "2026-09-19", distanceMiles: 29, url: "https://example.com" });
  assert.equal(result[0].hotDeal, true);
});

test("retries after a 429 response instead of failing the whole course", async () => {
  const payload = [{ teetimes: [{ teetime: "2026-09-19T15:54:00.000Z", maxPlayers: 4, rates: [rate({ _id: 7 })] }] }];
  let calls = 0;
  const fetchImpl = async () => {
    calls++;
    if (calls < 3) return { ok: false, status: 429, headers: { get: () => null } };
    return { ok: true, status: 200, json: async () => payload };
  };

  const result = await collectTeeItUpDay({ url: "https://the-hollows-golf-club.book.teeitup.golf/", date: "2026-09-19", course: "The Hollows Golf Club", distanceMiles: 29, fetchImpl });
  assert.equal(calls, 3);
  assert.equal(result.length, 1);
});

test("routes requests through the proxy with the alias and target when configured", async () => {
  process.env.TEEITUP_PROXY_URL = "https://golfwithjim-refresh.fbp-api-worker.workers.dev/teeitup";
  process.env.TEEITUP_PROXY_TOKEN = "test-token";
  const payload = [{ teetimes: [] }];
  let requestedUrl;
  let requestedHeaders;
  const fetchImpl = async (url, options) => {
    requestedUrl = new URL(url);
    requestedHeaders = options.headers;
    return { ok: true, status: 200, json: async () => payload };
  };
  try {
    await collectTeeItUpDay({ url: "https://the-hollows-golf-club.book.teeitup.golf/", date: "2026-09-19", course: "The Hollows Golf Club", distanceMiles: 29, fetchImpl });
  } finally {
    delete process.env.TEEITUP_PROXY_URL;
    delete process.env.TEEITUP_PROXY_TOKEN;
  }
  assert.equal(requestedUrl.origin, "https://golfwithjim-refresh.fbp-api-worker.workers.dev");
  assert.equal(requestedUrl.searchParams.get("alias"), "the-hollows-golf-club");
  assert.match(requestedUrl.searchParams.get("target"), /^https:\/\/phx-api-be-east-1b\.kenna\.io\/v2\/tee-times\?date=2026-09-19/);
  assert.equal(requestedHeaders.Authorization, "Bearer test-token");
});

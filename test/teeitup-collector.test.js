import assert from "node:assert/strict";
import test from "node:test";
import { collectTeeItUpDay, extractTeeItUpInventory } from "../src/collectors/teeitup.js";

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

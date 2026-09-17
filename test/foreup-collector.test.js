import assert from "node:assert/strict";
import test from "node:test";
import { collectForeUpDay, extractForeUpInventory } from "../src/collectors/foreup.js";

const row = (overrides = {}) => ({
  time: "2026-09-19 09:40",
  holes: "9/18",
  available_spots_18: 4,
  green_fee_18: 95,
  ...overrides,
});

test("keeps only rows where 18 holes has a real rate and converts to 12-hour time", () => {
  const rows = [
    row(),
    row({ time: "2026-09-19 14:40", holes: 9, available_spots_18: 0, green_fee_18: 0 }),
  ];
  const result = extractForeUpInventory(rows, { course: "Pendleton Golf Club", date: "2026-09-19", distanceMiles: 45, url: "https://example.com" });
  assert.equal(result.length, 1);
  assert.equal(result[0].time, "9:40 AM");
  assert.equal(result[0].availablePlayers, 4);
  assert.equal(result[0].allInPrice, 95);
  assert.equal(result[0].holes, 18);
  assert.equal(result[0].priceIsExact, true);
});

test("collects a day of ForeUp rows via the schedule id embedded in the course URL", async () => {
  let requestedUrl;
  const fetchImpl = async (url) => {
    requestedUrl = new URL(url);
    return { ok: true, json: async () => [row()] };
  };

  const result = await collectForeUpDay({
    url: "https://foreupsoftware.com/index.php/booking/22537/11103#/teetimes",
    date: "2026-09-19",
    course: "Pendleton Golf Club",
    distanceMiles: 45,
    fetchImpl,
  });

  assert.equal(requestedUrl.searchParams.get("schedule_id"), "11103");
  assert.equal(requestedUrl.searchParams.get("date"), "09-19-2026");
  assert.equal(result.length, 1);
  assert.equal(result[0].course, "Pendleton Golf Club");
});

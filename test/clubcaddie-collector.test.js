import assert from "node:assert/strict";
import test from "node:test";
import { collectClubCaddieDay, extractClubCaddieInventory } from "../src/collectors/clubcaddie.js";

const slot = (overrides = {}) => ({
  StartTime: "15:00:00",
  PlayersAvailable: 4,
  PricingPlan: [{ TitleType: "Championship+Adult+18+Holes+2026", HoleRate_18: 145 }],
  ...overrides,
});

test("picks the cheapest 18-hole pricing plan and converts the start time", () => {
  const result = extractClubCaddieInventory([slot()], { course: "Independence Championship Course", date: "2026-09-19", distanceMiles: 20, url: "https://example.com" });
  assert.equal(result.length, 1);
  assert.equal(result[0].time, "3:00 PM");
  assert.equal(result[0].allInPrice, 145);
  assert.equal(result[0].availablePlayers, 4);
  assert.equal(result[0].rateName, "Championship Adult 18 Holes 2026");
  assert.equal(result[0].priceIsExact, true);
});

test("skips slots with no 18-hole rate", () => {
  const result = extractClubCaddieInventory([slot({ PricingPlan: [{ TitleType: "9 Holes", HoleRate_18: null }] })], { course: "Independence Championship Course", date: "2026-09-19", distanceMiles: 20, url: "https://example.com" });
  assert.equal(result.length, 0);
});

test("collects a day by first resolving the course id from the booking widget page", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), method: options?.method });
    if (!options?.method) {
      return { ok: true, text: async () => '<input type="hidden" name="CourseId" value="103464">' };
    }
    const encoded = encodeURIComponent(JSON.stringify(slot()));
    return { ok: true, text: async () => `<input type="hidden" name="slot" value="${encoded}">` };
  };

  const result = await collectClubCaddieDay({
    url: "https://apimanager-cc12.clubcaddie.com/webapi/view/dgfdabab",
    date: "2026-09-19",
    course: "Independence Championship Course",
    distanceMiles: 20,
    fetchImpl,
  });

  assert.match(calls[0].url, /\/webapi\/view\/dgfdabab\/slots\?/);
  assert.equal(calls[1].method, "POST");
  assert.match(calls[1].url, /\/webapi\/TeeTimes$/);
  assert.equal(result.length, 1);
  assert.equal(result[0].course, "Independence Championship Course");
});

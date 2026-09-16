import assert from "node:assert/strict";
import test from "node:test";
import { filterTeeTimes, summarizeResults } from "../src/dashboard.js";

const teeTimes = [
  { course: "Later", date: "2026-09-19", time: "1:00 PM", availablePlayers: 4, holes: 18, allInPrice: 55, distanceMiles: 20, hotDeal: true },
  { course: "Early", date: "2026-09-19", time: "9:00 AM", availablePlayers: 2, holes: 18, allInPrice: 45, distanceMiles: 30, hotDeal: false },
  { course: "Far", date: "2026-09-19", time: "10:00 AM", availablePlayers: 4, holes: 18, allInPrice: 40, distanceMiles: 55, hotDeal: true },
  { course: "Nine", date: "2026-09-19", time: "11:00 AM", availablePlayers: 4, holes: 9, allInPrice: 30, distanceMiles: 10, hotDeal: true },
];

test("filters tee times across the dashboard controls and orders them chronologically", () => {
  const result = filterTeeTimes(teeTimes, {
    date: "2026-09-19",
    players: 2,
    earliest: "8:00 AM",
    latest: "2:00 PM",
    maximumDistance: 50,
    maximumPrice: 60,
  });

  assert.deepEqual(result.map(teeTime => teeTime.course), ["Early", "Later"]);
  assert.deepEqual(summarizeResults(result), { starts: 2, courses: 2, hotDeals: 1, lowestPrice: 45 });
  assert.deepEqual(filterTeeTimes(teeTimes, { hotDealsOnly: true, maximumDistance: 50 }).map(teeTime => teeTime.course), ["Later"]);
});
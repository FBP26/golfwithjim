import assert from "node:assert/strict";
import test from "node:test";
import { filterTeeTimes, summarizeResults, groupTeeTimes, shortCourseName } from "../src/dashboard.js";

const teeTimes = [
  { course: "Later", date: "2026-09-19", time: "1:00 PM", availablePlayers: 4, holes: 18, allInPrice: 55, distanceMiles: 20, hotDeal: true },
  { course: "Early", date: "2026-09-19", time: "9:00 AM", availablePlayers: 2, holes: 18, allInPrice: 45, distanceMiles: 30, hotDeal: false },
  { course: "Solo", date: "2026-09-19", time: "8:00 AM", availablePlayers: 1, holes: 18, allInPrice: 35, distanceMiles: 10, hotDeal: true },
  { course: "Far", date: "2026-09-19", time: "10:00 AM", availablePlayers: 4, holes: 18, allInPrice: 40, distanceMiles: 55, hotDeal: true },
  { course: "Nine", date: "2026-09-19", time: "11:00 AM", availablePlayers: 4, holes: 9, allInPrice: 30, distanceMiles: 10, hotDeal: true },
];

test("counts one start across providers while retaining offers and verified party sizes", () => {
  const offers = [{ ...teeTimes[1], source: "Direct" }, { ...teeTimes[1], source: "GolfNow", allInPrice: 40, availablePlayers: 4, availablePartySizes: [1, 2, 4] }];
  assert.equal(summarizeResults(offers).starts, 1);
  assert.equal(groupTeeTimes(offers)[0].offers.length, 2);
  assert.equal(filterTeeTimes(offers, { players: 3 }).length, 0);
  assert.equal(filterTeeTimes(offers, { hiddenCourses: new Set(["Early"]) }).length, 0);
  assert.equal(shortCourseName("The Hollows Golf Club"), "Hollows");
  assert.equal(shortCourseName("The Golf Club at The Highlands"), "Highlands");
  assert.equal(shortCourseName("The Club at Viniterra"), "Viniterra");
  const groupOnly = [{ ...offers[1], availablePartySizes: [2, 4] }];
  assert.equal(filterTeeTimes(groupOnly).length, 1);
  assert.equal(filterTeeTimes(groupOnly, { players: 1 }).length, 0);
  assert.equal(shortCourseName("Mill Quarter Plantation Golf Club"), "Mill Quarter");
  assert.equal(shortCourseName("Mill Quarter Plantation"), "Mill Quarter");
  assert.equal(shortCourseName("Independence Championship Course"), "Independence");
  assert.equal(shortCourseName("Independence Bear Course"), "Independence Bear Course");
});

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
  assert.deepEqual(filterTeeTimes(teeTimes, { players: 2, hotDealsOnly: true, maximumDistance: 50 }).map(teeTime => teeTime.course), ["Later"]);
  assert.deepEqual(filterTeeTimes(teeTimes, { players: 1, maximumDistance: 50 }).map(teeTime => teeTime.course), ["Solo", "Early", "Later"]);
});

test("keeps Sycamore Creek on the normal 18-hole pricing path", () => {
  const sycamoreTimes = [
    { course: "Sycamore Creek Golf Course", date: "2026-09-19", time: "8:30 AM", availablePlayers: 2, holes: 18, allInPrice: 53, distanceMiles: 20, hotDeal: false },
    { course: "Sycamore Creek Golf Course", date: "2026-09-19", time: "9:30 AM", availablePlayers: 2, holes: 18, allInPrice: 53, distanceMiles: 20, hotDeal: false },
  ];

  const result = filterTeeTimes([...teeTimes, ...sycamoreTimes], {
    date: "2026-09-19",
    players: 2,
    earliest: "8:00 AM",
    latest: "2:00 PM",
    maximumDistance: 50,
    maximumPrice: 60,
  });

  assert.deepEqual(result.filter(teeTime => teeTime.course === "Sycamore Creek Golf Course").map(teeTime => teeTime.time), ["8:30 AM", "9:30 AM"]);
  assert.equal(summarizeResults(result).courses, 3);
  assert.ok(result.every(teeTime => teeTime.course !== "Sycamore Creek Golf Course" || teeTime.holes === 18));
});
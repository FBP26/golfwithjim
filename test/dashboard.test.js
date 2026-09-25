import assert from "node:assert/strict";
import test from "node:test";
import { config, sourceRegistry } from "../src/config.js";
import { filterTeeTimes, summarizeResults, groupTeeTimes, shortCourseName, isMainCourse, haversineMiles, RICHMOND_CENTER, isInventoryUsable } from "../src/dashboard.js";

test("cached inventory expires strictly and never becomes eligible for alerts by default", () => {
  const teeTime = { stale: true, verifiedAt: "2026-09-25T10:00:00Z", cacheExpiresAt: "2026-09-26T10:00:00Z" };
  const now = Date.parse("2026-09-25T12:00:00Z");
  assert.equal(isInventoryUsable(teeTime, { now }), false);
  assert.equal(isInventoryUsable(teeTime, { allowCached: true, now }), true);
  assert.equal(isInventoryUsable(teeTime, { allowCached: true, now: Date.parse(teeTime.cacheExpiresAt) }), false);
  assert.equal(isInventoryUsable({ ...teeTime, stale: false }, { now: Date.parse(teeTime.cacheExpiresAt) }), false);
  assert.equal(isInventoryUsable({ ...teeTime, cacheExpiresAt: "2026-09-27T10:00:00Z" }, { allowCached: true, now }), false);
  assert.equal(isInventoryUsable({ ...teeTime, verifiedAt: null }, { allowCached: true, now }), false);
  assert.equal(isInventoryUsable(teeTime, { allowCached: true, now: Date.parse("2026-09-24T12:00:00Z") }), false);
});

test("uses Richmond-centered straight-line miles consistently", () => {
  assert.equal(haversineMiles(...RICHMOND_CENTER, ...RICHMOND_CENTER), 0);
  assert.ok(Math.abs(haversineMiles(37, -77, 38, -77) - 69.094) < 0.01);
  for (const course of sourceRegistry.interactiveOnly.filter(course => Number.isFinite(course.latitude))) {
    const distance = haversineMiles(...RICHMOND_CENTER, course.latitude, course.longitude);
    assert.equal(course.distanceMiles, Math.ceil(distance * 10) / 10);
    assert.ok(distance <= config.maximumDistanceMiles, course.course);
  }
});

test("main-list placement can include booking links without enabling live inventory", () => {
  assert.equal(isMainCourse({ collector: "golfnow" }), true);
  assert.equal(isMainCourse({ collector: "golfnow", showInventory: false }), false);
  assert.equal(isMainCourse({ course: "Hobbs Hole Golf Course", mainList: true }), true);
  assert.equal(isMainCourse({ course: "Williamsburg National Golf Club", mainList: true, showInventory: false }), true);
  assert.equal(isMainCourse({ course: "Belmont Golf Course", showInventory: false }), false);
  assert.equal(isMainCourse({ course: "Other booking link" }), false);
});

test("expanded catalog preserves verified links and separates restricted facilities", () => {
  const courses = sourceRegistry.interactiveOnly;
  assert.ok(new Set(courses.map(course => course.course)).size > 100);
  for (const name of ["Piankatank River Golf Club", "Forest Greens Golf Club", "Wicomico Shores Golf Course", "Old Trail Golf Club", "Valley Pine Country Club"]) {
    assert.ok(courses.some(course => course.course === name), name);
  }
  for (const course of courses.filter(course => course.collector === "golfnow")) {
    assert.ok(new URL(course.url).pathname.startsWith(`/tee-times/facility/${course.providerCourseId}-`), course.course);
    assert.ok(!new URL(course.url).pathname.includes(`/${course.providerCourseId}-${course.providerCourseId}-`), course.course);
    assert.ok(!["Private", "Military"].includes(course.access), course.course);
  }
  for (const name of ["Hobbs Hole Golf Course", "Williamsburg National Golf Club"]) {
    assert.ok(isMainCourse(courses.find(course => course.course === name)), name);
  }
});

const teeTimes = [
  { course: "Later", date: "2026-09-19", time: "1:00 PM", availablePlayers: 4, holes: 18, allInPrice: 55, distanceMiles: 20, hotDeal: true },
  { course: "Early", date: "2026-09-19", time: "9:00 AM", availablePlayers: 2, holes: 18, allInPrice: 45, distanceMiles: 30, hotDeal: false },
  { course: "Solo", date: "2026-09-19", time: "8:00 AM", availablePlayers: 1, holes: 18, allInPrice: 35, distanceMiles: 10, hotDeal: true },
  { course: "Far", date: "2026-09-19", time: "10:00 AM", availablePlayers: 4, holes: 18, allInPrice: 40, distanceMiles: 55, hotDeal: true },
  { course: "Nine", date: "2026-09-19", time: "11:00 AM", availablePlayers: 4, holes: 9, allInPrice: 30, distanceMiles: 10, hotDeal: true },
];

test("includes the 100-mile boundary and rejects courses beyond it", () => {
  assert.equal(config.maximumDistanceMiles, 100);
  const offers = [75, 99.9, 100, 100.1].map(distanceMiles => ({ ...teeTimes[0], distanceMiles }));
  assert.deepEqual(filterTeeTimes(offers, { maximumDistance: config.maximumDistanceMiles }).map(offer => offer.distanceMiles), [75, 99.9, 100]);
});

test("counts one start across providers while retaining offers and verified party sizes", () => {
  const offers = [{ ...teeTimes[1], source: "Direct" }, { ...teeTimes[1], source: "GolfNow", allInPrice: 40, availablePlayers: 4, availablePartySizes: [1, 2, 4] }];
  assert.equal(summarizeResults(offers).starts, 1);
  assert.equal(groupTeeTimes(offers)[0].offers.length, 2);
  assert.equal(filterTeeTimes(offers, { players: 3 }).length, 0);
  assert.equal(filterTeeTimes(offers, { hiddenCourses: new Set(["Early"]) }).length, 0);
  assert.equal(shortCourseName("The Hollows Golf Club"), "Hollows");
  assert.equal(shortCourseName("The Golf Club at The Highlands"), "Highlands");
  assert.equal(shortCourseName("The Club at Viniterra"), "Viniterra");
  assert.equal(shortCourseName("Amelia Golf & Country Club"), "Amelia");
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
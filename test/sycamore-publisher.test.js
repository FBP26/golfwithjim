import assert from "node:assert/strict";
import test from "node:test";
import { hasNewerCollection, validateCollection } from "../scripts/publish-sycamore.mjs";

const course = "Sycamore Creek Golf Course";
const collected = {
  checkedAt: "2026-09-25T11:00:00Z", sources: [course],
  sourceChecks: [{ course, teeTimeCount: 1 }],
  teeTimes: [{ course, holes: 18, priceIsExact: true, allInPrice: 58 }],
};

test("publisher accepts verified inventory and legitimate sold-out results", () => {
  assert.doesNotThrow(() => validateCollection(collected));
  assert.doesNotThrow(() => validateCollection({ ...collected, teeTimes: [] }));
});

test("publisher refuses failed or inexact source results", () => {
  assert.throws(() => validateCollection({ ...collected, sourceChecks: [{ course, error: "403" }] }), /failed/);
  assert.throws(() => validateCollection({ ...collected, sources: [] }), /failed/);
  assert.throws(() => validateCollection({ ...collected, teeTimes: [{ course, holes: 9 }] }), /unverified/);
});

test("publisher cannot overwrite a newer successful collection even after a cloud failure", () => {
  assert.equal(hasNewerCollection({ sourceChecks: [{ course, checkedAt: "2026-09-25T12:00:00Z" }] }, collected), true);
  assert.equal(hasNewerCollection({ sourceChecks: [{ course, error: "403", lastSuccessfulAt: "2026-09-25T12:00:00Z" }] }, collected), true);
  assert.equal(hasNewerCollection({ sourceChecks: [{ course, error: "403", checkedAt: "2026-09-25T12:00:00Z" }] }, collected), false);
});
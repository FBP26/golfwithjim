import assert from "node:assert/strict";
import test from "node:test";
import { qualifyDeals, priceObservations, mergePriceDay, applyPriceSnapshot, offerKey } from "../src/price-history.js";

const now = Date.parse("2026-09-28T12:00:00Z");
const offer = (time, price, extra = {}) => ({ course: "Test Course", source: "Test", rateName: "Public cart", date: "2026-10-01", time, allInPrice: price, priceIsExact: true, holes: 18, availablePlayers: 4, availablePartySizes: [1, 2, 3, 4], ...extra });
test("deal snapshots require matching fresh inventory and exact offer terms", () => {
  const candidate = offer("9:00 AM", 75);
  const checkedAt = new Date(now).toISOString();
  const deal = { referencePrice: 100, savings: 25, percent: 25, basis: "History", samples: 3 };
  const snapshot = { checkedAt, computedAt: checkedAt, deals: [{ key: offerKey(candidate), deal }] };
  assert.deepEqual(applyPriceSnapshot([candidate], snapshot, checkedAt, now)[0].deal, deal);
  assert.equal(applyPriceSnapshot([{ ...candidate, allInPrice: 80 }], snapshot, checkedAt, now)[0].hotDeal, false);
  assert.equal(applyPriceSnapshot([candidate], snapshot, checkedAt, now + 31 * 3600000)[0].hotDeal, false);
  assert.equal(applyPriceSnapshot([candidate], { ...snapshot, checkedAt: "old" }, checkedAt, now)[0].hotDeal, false);
  assert.equal(applyPriceSnapshot([candidate], {}, checkedAt, now)[0].hotDeal, false);
  const checks = [{ course: candidate.course, source: candidate.source, checkedAt, error: "Provider unavailable" }];
  assert.equal(applyPriceSnapshot([candidate], snapshot, checkedAt, now, checks)[0].hotDeal, false);
  assert.equal(qualifyDeals([{ ...candidate, standardAllInPrice: 100 }], [], now, checks)[0].hotDeal, false);
});
test("genuine deals require both 20 percent and ten dollars, not a provider label", () => {
  assert.equal(qualifyDeals([offer("9:00 AM", 95, { hotDeal: true, standardAllInPrice: 100 })])[0].hotDeal, false);
  assert.equal(qualifyDeals([offer("9:00 AM", 75, { standardAllInPrice: 100 })])[0].deal.percent, 25);
  assert.equal(qualifyDeals([offer("9:00 AM", 16, { standardAllInPrice: 20 })])[0].hotDeal, false);
  assert.equal(qualifyDeals([offer("9:00 AM", 75, { hotDeal: true })])[0].hotDeal, false);
});
test("isolated discounts qualify but AM-PM and twilight transitions do not", () => {
  const rows = qualifyDeals([offer("9:30 AM", 100), offer("9:45 AM", 75), offer("10:00 AM", 100)]);
  assert.equal(rows[1].hotDeal, true);
  for (const times of [["11:45 AM", "12:00 PM", "12:15 PM"], ["2:45 PM", "3:00 PM", "3:15 PM"]]) {
    assert.equal(qualifyDeals([offer(times[0], 100), offer(times[1], 50), offer(times[2], 50)])[1].hotDeal, false);
  }
  assert.equal(qualifyDeals([offer("9:30 AM", 100, { rateName: "Public walking" }), offer("9:45 AM", 75), offer("10:00 AM", 100)])[1].hotDeal, false);
});
test("history retains real source dates, ignores failed/cached data and is replay-safe", () => {
  const feed = { sourceChecks: [{ course: "Test Course", source: "Test", checkedAt: new Date(now).toISOString() }], teeTimes: [offer("9:00 AM", 100)] };
  const rows = priceObservations(feed, now);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].observed, "2026-09-28");
  assert.deepEqual(mergePriceDay(rows, rows), rows);
  assert.equal(priceObservations({ ...feed, teeTimes: [offer("9:00 AM", 100, { stale: true })] }, now).length, 0);
  assert.equal(priceObservations({ ...feed, sourceChecks: [{ ...feed.sourceChecks[0], error: "blocked" }] }, now).length, 0);
});
test("historical discounts need independent dates and comparable booking windows", () => {
  const sample = priceObservations({ sourceChecks: [{ course: "Test Course", source: "Test", checkedAt: new Date(now).toISOString() }], teeTimes: [offer("9:00 AM", 100)] }, now)[0];
  const history = [7, 14, 21].map(offset => ({ ...sample, observed: new Date(now - offset * 86400000).toISOString().slice(0, 10), date: new Date(Date.parse(sample.date) - offset * 86400000).toISOString().slice(0, 10), seenAt: new Date(now - offset * 86400000).toISOString() }));
  assert.equal(qualifyDeals([offer("9:00 AM", 75)], history, now)[0].hotDeal, true);
  assert.equal(qualifyDeals([offer("9:00 AM", 75)], history.slice(0, 2), now)[0].hotDeal, false);
  assert.equal(qualifyDeals([offer("3:00 PM", 75)], history, now)[0].hotDeal, false);
});
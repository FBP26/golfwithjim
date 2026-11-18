import assert from "node:assert/strict";
import test from "node:test";
import { trackPriceDrops } from "../src/collect.js";
import { compactTeeTime } from "../src/compact.js";

const base = { course: "Hollows", date: "2026-11-21", time: "9:00 AM", source: "GolfNow", rateName: "Online Rate", allInPrice: 60 };

test("marks a tee time that got at least $1 cheaper and keeps the mark for 48 hours", () => {
  const [dropped] = trackPriceDrops([base], [{ ...base, allInPrice: 45 }], "2026-11-18T12:00:00Z");
  assert.equal(dropped.previousPrice, 60);
  assert.equal(dropped.priceDroppedAt, "2026-11-18T12:00:00Z");
  const [kept] = trackPriceDrops([dropped], [{ ...base, allInPrice: 45 }], "2026-11-19T12:00:00Z");
  assert.equal(kept.previousPrice, 60);
  const [expired] = trackPriceDrops([kept], [{ ...base, allInPrice: 45 }], "2026-11-20T13:00:00Z");
  assert.equal(expired.previousPrice, undefined);
  const [raised] = trackPriceDrops([dropped], [{ ...base, allInPrice: 50 }], "2026-11-18T13:00:00Z");
  assert.equal(raised.previousPrice, undefined);
  assert.equal(trackPriceDrops([base], [{ ...base, allInPrice: 59.5 }], "2026-11-18T12:00:00Z")[0].previousPrice, undefined);
});

test("compacts default fields without changing how readers see the tee time", () => {
  const full = { ...base, id: "x", dailyAvailableCount: 3, verifiedAt: "t", stale: false, feesWaived: false, golfPassEligible: false,
    golfPassAllInPrice: null, deal: null, availablePartySizes: null, standardAllInPrice: 60, providerHotDeal: false, hotDeal: false, holes: 18, priceIsExact: true };
  const compact = compactTeeTime(full);
  for (const field of ["id", "dailyAvailableCount", "verifiedAt", "stale", "feesWaived", "golfPassEligible", "golfPassAllInPrice", "deal", "availablePartySizes", "standardAllInPrice", "providerHotDeal", "hotDeal"]) assert.equal(field in compact, false, field);
  assert.equal(compact.priceIsExact, true);
  const promo = compactTeeTime({ ...full, hotDeal: true, providerHotDeal: false });
  assert.equal(promo.providerHotDeal, false);
  assert.equal(promo.hotDeal, true);
  assert.equal(compactTeeTime({ ...full, cacheExpiresAt: "e", verifiedAt: "v" }).verifiedAt, "v");
});

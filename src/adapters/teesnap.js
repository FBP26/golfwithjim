export function adaptTeeSnapTeeTime(raw, defaults = {}) {
  const date = String(raw.date || defaults.date);
  const time = String(raw.time);
  const course = String(raw.course || defaults.course);
  const stableTime = time.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const stableCourse = course.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    id: String(raw.id || `teesnap-${stableCourse}-${date}-${stableTime}`),
    source: "TeeSnap",
    course,
    date,
    time,
    availablePlayers: Number(raw.slotsAvailable ?? raw.availablePlayers),
    holes: Number(raw.holes || 18),
    allInPrice: Number(raw.price),
    priceIsExact: true,
    hotDeal: false,
    golfPassEligible: false,
    feesWaived: false,
    rateName: String(raw.rateName || "Standard with cart"),
    distanceMiles: Number(raw.distanceMiles ?? defaults.distanceMiles),
    url: String(raw.url || defaults.url || ""),
  };
}

export function adaptTeeSnapPayload(payload) {
  const defaults = payload.defaults || {};
  return payload.teeTimes.map((teeTime, index) => adaptTeeSnapTeeTime({
    id: teeTime.id || `${defaults.course}-${defaults.date}-${teeTime.time}-${index}`,
    ...teeTime,
  }, defaults));
}
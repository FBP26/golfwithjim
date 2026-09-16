function maximumPlayers(value) {
  const numbers = String(value).match(/\d+/g)?.map(Number) || [];
  return numbers.length ? Math.max(...numbers) : 0;
}

function preferredHoles(value) {
  const holes = Array.isArray(value) ? value.map(Number) : String(value).match(/\d+/g)?.map(Number) || [];
  return holes.includes(18) ? 18 : Math.max(...holes, 0);
}

export function adaptTeeItUpTeeTime(raw, defaults = {}) {
  const date = String(raw.date || defaults.date);
  const time = String(raw.time);
  const course = String(raw.course || defaults.course);
  const stableTime = time.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const stableCourse = course.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    id: String(raw.id || `teeitup-${stableCourse}-${date}-${stableTime}`),
    source: "GolfNow/TeeItUp",
    course,
    date,
    time,
    availablePlayers: maximumPlayers(raw.players ?? raw.availablePlayers),
    holes: preferredHoles(raw.holes),
    allInPrice: Number(raw.exactPrice ?? raw.price),
    priceIsExact: raw.exactPrice != null || raw.priceIsExact === true,
    hotDeal: raw.hotDeal === true,
    golfPassEligible: raw.golfPassEligible === true,
    feesWaived: raw.feesWaived === true,
    rateName: String(raw.rateName || "Standard"),
    distanceMiles: Number(raw.distanceMiles ?? defaults.distanceMiles),
    url: String(raw.url || defaults.url || ""),
  };
}

export function adaptTeeItUpPayload(payload) {
  const defaults = payload.defaults || {};
  return payload.teeTimes.map((teeTime, index) => adaptTeeItUpTeeTime({
    id: teeTime.id || `${defaults.course}-${defaults.date}-${teeTime.time}-${index}`,
    ...teeTime,
  }, defaults));
}
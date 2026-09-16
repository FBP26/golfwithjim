function maximumPlayers(value) {
  const numbers = String(value).match(/\d+/g)?.map(Number) || [];
  return numbers.length ? Math.max(...numbers) : 0;
}

export function adaptPlay18TeeTime(raw, defaults = {}) {
  const date = String(raw.date || defaults.date);
  const time = String(raw.time);
  const course = String(raw.course || defaults.course);
  const stableTime = time.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const stableCourse = course.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    id: String(raw.id || `play18-${stableCourse}-${date}-${stableTime}`),
    source: "Sagacity/Play18",
    course,
    date,
    time,
    availablePlayers: maximumPlayers(raw.players ?? raw.availablePlayers),
    holes: Number(raw.holes || 18),
    allInPrice: Number(raw.price),
    priceIsExact: true,
    hotDeal: false,
    golfPassEligible: false,
    feesWaived: false,
    rateName: String(raw.rateName || "Regular"),
    distanceMiles: Number(raw.distanceMiles ?? defaults.distanceMiles),
    url: String(raw.url || defaults.url || ""),
  };
}

export function adaptPlay18Payload(payload) {
  const defaults = payload.defaults || {};
  return payload.teeTimes.map((teeTime, index) => adaptPlay18TeeTime({
    id: teeTime.id || `${defaults.course}-${defaults.date}-${teeTime.time}-${index}`,
    ...teeTime,
  }, defaults));
}
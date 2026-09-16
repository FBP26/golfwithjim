function maximumPlayers(value) {
  const numbers = String(value).match(/\d+/g)?.map(Number) || [];
  return numbers.length ? Math.max(...numbers) : 0;
}

function preferredHoles(value) {
  const holes = Array.isArray(value) ? value.map(Number) : String(value).match(/\d+/g)?.map(Number) || [];
  return holes.includes(18) ? 18 : Math.max(...holes, 0);
}

export function adaptForeUpTeeTime(raw, defaults = {}) {
  const date = String(raw.date || defaults.date);
  const time = String(raw.time);
  const course = String(raw.course || defaults.course);
  const stableTime = time.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const stableCourse = course.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    id: String(raw.id || `foreup-${stableCourse}-${date}-${stableTime}`),
    source: "ForeUp",
    course,
    date,
    time,
    availablePlayers: maximumPlayers(raw.players ?? raw.availablePlayers),
    holes: preferredHoles(raw.holes),
    allInPrice: Number(raw.price),
    priceIsExact: true,
    hotDeal: false,
    golfPassEligible: false,
    feesWaived: false,
    rateName: String(raw.rateName || "Standard"),
    distanceMiles: Number(raw.distanceMiles ?? defaults.distanceMiles),
    url: String(raw.url || defaults.url || ""),
  };
}

export function adaptForeUpPayload(payload) {
  const defaults = payload.defaults || {};
  return payload.teeTimes.map((teeTime, index) => adaptForeUpTeeTime({
    id: teeTime.id || `${defaults.course}-${defaults.date}-${teeTime.time}-${index}`,
    ...teeTime,
  }, defaults));
}
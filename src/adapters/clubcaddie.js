function maximumPlayers(value) {
  const numbers = String(value).match(/\d+/g)?.map(Number) || [];
  return numbers.length ? Math.max(...numbers) : 0;
}

export function adaptClubCaddieTeeTime(raw, defaults = {}) {
  const date = String(raw.date || defaults.date);
  const time = String(raw.time);
  const course = String(raw.course || defaults.course);
  const stableTime = time.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const stableCourse = course.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return {
    id: String(raw.id || `clubcaddie-${stableCourse}-${date}-${stableTime}`),
    source: "Club Caddie",
    course,
    date,
    time,
    availablePlayers: maximumPlayers(raw.players ?? raw.availablePlayers),
    holes: Number(raw.holes || 18),
    allInPrice: Number(raw.exactPrice ?? raw.price),
    priceIsExact: raw.exactPrice != null || raw.priceIsExact === true,
    hotDeal: false,
    golfPassEligible: false,
    feesWaived: false,
    rateName: String(raw.rateName || "Standard"),
    distanceMiles: Number(raw.distanceMiles ?? defaults.distanceMiles),
    url: String(raw.url || defaults.url || ""),
  };
}

export function adaptClubCaddiePayload(payload) {
  const defaults = payload.defaults || {};
  return payload.teeTimes.map((teeTime, index) => adaptClubCaddieTeeTime({
    id: teeTime.id || `${defaults.course}-${defaults.date}-${teeTime.time}-${index}`,
    ...teeTime,
  }, defaults));
}
const RESTRICTED_RATE_PATTERN = /\b(junior|military|veteran|senior|resident)\b/i;
const MEMBER_RATE_PATTERN = /\bmember\b/i;
const PUBLIC_MEMBER_FOR_DAY_PATTERN = /\bmember for (?:a|the) day\b/i;

export function normalizeTeeTime(raw) {
  const standardAllInPrice = Number(raw.standardAllInPrice ?? raw.allInPrice);
  const golfPassAllInPrice = raw.golfPassAllInPrice == null ? null : Number(raw.golfPassAllInPrice);
  const golfPassEligible = Boolean(raw.golfPassEligible || golfPassAllInPrice != null);
  return {
    id: String(raw.id),
    source: String(raw.source || "Unknown"),
    course: String(raw.course),
    date: String(raw.date),
    time: String(raw.time),
    availablePlayers: Number(raw.availablePlayers),
    dailyAvailableCount: raw.dailyAvailableCount == null ? null : Number(raw.dailyAvailableCount),
    holes: Number(raw.holes || 18),
    allInPrice: golfPassAllInPrice ?? standardAllInPrice,
    standardAllInPrice,
    golfPassAllInPrice,
    golfPassEligible,
    feesWaived: Boolean(raw.feesWaived),
    priceIsExact: raw.priceIsExact !== false,
    hotDeal: Boolean(raw.hotDeal),
    rateName: String(raw.rateName || "Standard"),
    distanceMiles: Number(raw.distanceMiles),
    url: String(raw.url || ""),
  };
}

export function isEligible(teeTime, config) {
  return teeTime.availablePlayers >= config.minimumPlayers
    && teeTime.distanceMiles <= config.maximumDistanceMiles
    && teeTime.allInPrice > 0
    && teeTime.priceIsExact
    && !RESTRICTED_RATE_PATTERN.test(teeTime.rateName)
    && (!MEMBER_RATE_PATTERN.test(teeTime.rateName)
      || PUBLIC_MEMBER_FOR_DAY_PATTERN.test(teeTime.rateName)
      || teeTime.golfPassEligible);
}

function minutes(time) {
  const match = time.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return Number.POSITIVE_INFINITY;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

export function findPriceBreaks(teeTimes, config) {
  const comparable = teeTimes
    .filter(teeTime => teeTime.holes === 18)
    .toSorted((left, right) => minutes(left.time) - minutes(right.time));

  return comparable.filter((teeTime, index) => {
    if (teeTime.hotDeal) return true;
    const neighbors = [comparable[index - 1], comparable[index + 1]].filter(Boolean);
    if (!neighbors.length) return false;
    const referencePrice = Math.min(...neighbors.map(neighbor => neighbor.allInPrice));
    const savings = referencePrice - teeTime.allInPrice;
    return savings >= config.minimumDropDollars
      && savings / referencePrice >= config.minimumDropPercent;
  });
}

export function newestAvailableDate(teeTimes) {
  return teeTimes.map(teeTime => teeTime.date).sort().at(-1) || null;
}
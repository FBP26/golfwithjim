const RESTRICTED_RATE_PATTERN = /\b(junior|military|veteran|senior|resident)\b/i;
const PUBLIC_MEMBER_FOR_DAY_PATTERN = /\bmember for (?:a|the) day\b/i;

export function isPublicRate(rateName) {
  const name = String(rateName || "Standard");
  return !RESTRICTED_RATE_PATTERN.test(name)
    && (!/\b(member|members|guest of|member guest)\b/i.test(name) || PUBLIC_MEMBER_FOR_DAY_PATTERN.test(name));
}

export function todayIso(timeZone = "America/New_York") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(new Date())
      .map(part => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function nowMinutes(timeZone = "America/New_York") {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date())
      .map(part => [part.type, part.value]),
  );
  return Number(parts.hour) * 60 + Number(parts.minute);
}

export function parseTimeMinutes(time) {
  const match = String(time).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return Number.POSITIVE_INFINITY;
  const hour = Number(match[1]) % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0);
  return hour * 60 + Number(match[2]);
}

export function isUpcoming(teeTime, timeZone = "America/New_York") {
  const today = todayIso(timeZone);
  if (teeTime.date > today) return true;
  return teeTime.date === today && parseTimeMinutes(teeTime.time) >= nowMinutes(timeZone);
}

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
    availablePartySizes: Array.isArray(raw.availablePartySizes) ? raw.availablePartySizes.map(Number) : null,
    dailyAvailableCount: raw.dailyAvailableCount == null ? null : Number(raw.dailyAvailableCount),
    holes: Number(raw.holes || 18),
    allInPrice: golfPassAllInPrice ?? standardAllInPrice,
    standardAllInPrice,
    golfPassAllInPrice,
    golfPassEligible,
    feesWaived: Boolean(raw.feesWaived),
    priceIsExact: raw.priceIsExact !== false,
    stale: raw.stale === true,
    hotDeal: Boolean(raw.hotDeal),
    rateName: String(raw.rateName || "Standard"),
    distanceMiles: Number(raw.distanceMiles),
    url: String(raw.url || ""),
  };
}

export function isSycamoreNineHoleException(teeTime) {
  return String(teeTime.course).trim().toLowerCase() === "sycamore creek golf course" && Number(teeTime.holes) === 9;
}

export function isAllowedHoleCount(teeTime) {
  return Number(teeTime.holes) === 18;
}

export function isEligible(teeTime, config) {
  return teeTime.availablePlayers >= config.minimumPlayers
    && !teeTime.stale
    && teeTime.distanceMiles <= config.maximumDistanceMiles
    && teeTime.allInPrice > 0
    && teeTime.priceIsExact
    && (isPublicRate(teeTime.rateName) || (teeTime.golfPassEligible && /\bgolfpass\b/i.test(teeTime.rateName)
      && !RESTRICTED_RATE_PATTERN.test(teeTime.rateName)));
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
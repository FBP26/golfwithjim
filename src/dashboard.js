export const RICHMOND_CENTER = [37.5407, -77.436];

export function haversineMiles(latitudeFrom, longitudeFrom, latitudeTo, longitudeTo) {
  const toRadians = degrees => degrees * Math.PI / 180;
  const latitudeDelta = toRadians(latitudeTo - latitudeFrom);
  const longitudeDelta = toRadians(longitudeTo - longitudeFrom);
  const arc = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(latitudeFrom)) * Math.cos(toRadians(latitudeTo)) * Math.sin(longitudeDelta / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(Math.min(1, arc)));
}

function timeMinutes(time) {
  const match = String(time).match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
  if (!match) return Number.POSITIVE_INFINITY;
  const hour = match[3]
    ? Number(match[1]) % 12 + (match[3].toUpperCase() === "PM" ? 12 : 0)
    : Number(match[1]);
  return hour * 60 + Number(match[2]);
}

export function isMainCourse(course) {
  return course.mainList === true || Boolean(course.collector && course.showInventory !== false);
}

export function filterTeeTimes(teeTimes, filters = {}) {
  const players = Number(filters.players ?? 0);
  const maximumDistance = Number(filters.maximumDistance ?? Number.POSITIVE_INFINITY);
  const maximumPrice = Number(filters.maximumPrice ?? Number.POSITIVE_INFINITY);
  const earliest = filters.earliest ? timeMinutes(filters.earliest) : 0;
  const latest = filters.latest ? timeMinutes(filters.latest) : 24 * 60;

  return teeTimes.filter(teeTime => teeTime.holes === 18
    && teeTime.availablePlayers > 0
    && (!players || (teeTime.availablePartySizes?.length ? teeTime.availablePartySizes.includes(players) : teeTime.availablePlayers >= players))
    && !filters.hiddenCourses?.has(teeTime.course)
    && teeTime.distanceMiles <= maximumDistance
    && teeTime.allInPrice <= maximumPrice
    && (!filters.date || teeTime.date === filters.date)
    && (!filters.hotDealsOnly || teeTime.hotDeal)
    && timeMinutes(teeTime.time) >= earliest
    && timeMinutes(teeTime.time) <= latest)
    .toSorted((left, right) => left.date.localeCompare(right.date)
      || timeMinutes(left.time) - timeMinutes(right.time)
      || left.allInPrice - right.allInPrice
      || left.course.localeCompare(right.course));
}

export function summarizeResults(teeTimes) {
  const starts = groupTeeTimes(teeTimes);
  return {
    starts: starts.length,
    courses: new Set(teeTimes.map(teeTime => teeTime.course)).size,
    hotDeals: starts.filter(start => start.offers.some(offer => offer.hotDeal)).length,
    lowestPrice: teeTimes.length ? Math.min(...teeTimes.map(teeTime => teeTime.allInPrice)) : null,
  };
}

export function groupTeeTimes(teeTimes) {
  return [...Map.groupBy(teeTimes, teeTime => JSON.stringify([teeTime.course, teeTime.date, timeMinutes(teeTime.time), teeTime.holes]))]
    .map(([key, offers]) => ({ key, time: offers[0].time, offers }));
}

export function shortCourseName(name) {
  const shortened = String(name).replace(/^(?:The\s+)?(?:Golf\s+)?Club at\s+(?:The\s+)?/i, "").replace(/^The\s+/i, "").replace(/\s+(?:Golf\s+(?:Club|Course)|(?:Golf\s*&\s*)?Country Club)\b/gi, "").trim();
  if (shortened === "Mill Quarter Plantation") return "Mill Quarter";
  if (shortened === "Independence Championship Course") return "Independence";
  return shortened;
}
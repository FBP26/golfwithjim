const endpoint = "https://www.golfnow.com/api/tee-times/tee-time-search-results";

function availablePlayers(rule) {
  const value = String(rule || "");
  if (/Any/i.test(value)) return 4;
  if (/Four/i.test(value)) return 4;
  if (/Three/i.test(value)) return 3;
  if (/Two/i.test(value)) return 2;
  if (/One/i.test(value)) return 1;
  return 0;
}

function allInPrice(rate) {
  return Number(rate.singlePlayerPrice?.feeMessagingDisplayRates?.totalPrice?.value);
}

export function extractGolfNowInventory(payload, defaults = {}) {
  return (payload.ttResults?.teeTimes || []).flatMap(teeTime => {
    const rates = (teeTime.teeTimeRates || [])
      .filter(rate => rate.isEighteen && !teeTime.isReservationRestricted && availablePlayers(rate.playerRule || teeTime.playerRule) >= 2)
      .filter(rate => allInPrice(rate) > 0)
      .toSorted((left, right) => allInPrice(left) - allInPrice(right));
    const rate = rates[0];
    if (!rate) return [];
    const time = `${teeTime.time.formatted} ${teeTime.time.formattedTimeMeridian}`;
    return [{
      id: `golfnow-${rate.teeTimeRateId}`,
      source: "GolfNow",
      course: defaults.course,
      date: defaults.date,
      time,
      availablePlayers: availablePlayers(rate.playerRule || teeTime.playerRule),
      holes: 18,
      allInPrice: allInPrice(rate),
      priceIsExact: true,
      hotDeal: rate.isHotDeal === true,
      rateName: String(rate.rateName || "Standard"),
      distanceMiles: defaults.distanceMiles,
      url: new URL(rate.detailUrl, "https://www.golfnow.com").href,
    }];
  });
}

export async function collectGolfNowDay({ facilityId, date, course, distanceMiles, latitude, longitude, fetchImpl = fetch }) {
  const displayDate = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
  const body = {
    pageSize: 100,
    teeTimeCount: 100,
    pageNumber: 0,
    date: displayDate,
    sortBy: "Date",
    sortByRollup: "Date.MinDate",
    sortDirection: "Asc",
    hotDealsOnly: false,
    golfPassPerksOnly: false,
    bestDealsOnly: false,
    promotedCampaignsOnly: false,
    priceMin: 0,
    priceMax: 10000,
    players: 2,
    timePeriod: "Any",
    timeMin: 10,
    timeMax: 42,
    holes: "18",
    facilityType: "GolfCourse",
    latitude,
    longitude,
    radius: 75,
    facilityId: Number(facilityId),
    facilityIds: [],
    searchType: "Facility",
    view: "Grouping",
    excludeFeaturedFacilities: false,
    excludePrivateFacilities: false,
    rateType: "all",
    currentClientDate: new Date().toISOString(),
    trackmanOnly: false,
    teeTimeId: 0,
    offPlatformCourse: false,
    isTeeTimeSearchResultsPage: true,
    disableCourseView: true,
    disableMapView: true,
  };
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Referer: `https://www.golfnow.com/tee-times/facility/${facilityId}/search`,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`GolfNow feed returned HTTP ${response.status}.`);
  return extractGolfNowInventory(await response.json(), { course, date, distanceMiles });
}
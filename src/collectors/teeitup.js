const endpoint = "https://phx-api-be-east-1b.kenna.io/v2/tee-times";

function ratePrice(rate) {
  const cents = rate.promotion?.greenFeeCart ?? rate.greenFeeCart;
  return Number(cents) / 100 + (rate.showTransactionFees ? Number(rate.transactionFees) || 0 : 0);
}

function localDateTime(iso) {
  const dateFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const timeFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  const parts = Object.fromEntries(dateFormatter.formatToParts(new Date(iso)).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: timeFormatter.format(new Date(iso)) };
}

export function extractTeeItUpInventory(payload, defaults = {}) {
  const teetimes = payload?.[0]?.teetimes || [];
  const stableCourse = String(defaults.course).toLowerCase().replace(/[^a-z0-9]+/g, "-");
  return teetimes.flatMap(teetime => {
    const eighteenHoleRates = (teetime.rates || []).filter(rate => rate.holes === 18);
    if (!eighteenHoleRates.length) return [];
    const best = eighteenHoleRates.toSorted((left, right) => ratePrice(left) - ratePrice(right))[0];
    const price = ratePrice(best);
    if (!(price > 0)) return [];
    const { date, time } = localDateTime(teetime.teetime);
    if (defaults.date && date !== defaults.date) return [];
    const stableTime = time.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    return [{
      id: `teeitup-${stableCourse}-${date}-${stableTime}`,
      source: "GolfNow/TeeItUp",
      course: defaults.course,
      date,
      time,
      availablePlayers: Number(teetime.maxPlayers) || 0,
      holes: 18,
      allInPrice: Math.round(price * 100) / 100,
      priceIsExact: true,
      hotDeal: best.showAsHotDeal === true,
      rateName: String(best.name || "Standard"),
      distanceMiles: defaults.distanceMiles,
      url: defaults.url,
    }];
  });
}

export async function collectTeeItUpDay({ url, date, course, distanceMiles, fetchImpl = fetch }) {
  const alias = new URL(url).hostname.split(".")[0];
  const requestUrl = new URL(endpoint);
  requestUrl.searchParams.set("date", date);
  requestUrl.searchParams.set("returnPromotedRates", "true");
  const response = await fetchImpl(requestUrl, { headers: { Accept: "application/json", "x-be-alias": alias }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`TeeItUp returned HTTP ${response.status} for ${alias}.`);
  return extractTeeItUpInventory(await response.json(), {
    course, date, distanceMiles,
    url: `${url}${url.includes("?") ? "&" : "?"}date=${date}`,
  });
}

import { adaptTeeSnapTeeTime } from "../adapters/teesnap.js";

function localDateTime(value) {
  const match = String(value).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const hour = Number(match[2]);
  return {
    date: match[1],
    time: `${hour % 12 || 12}:${match[3]} ${hour >= 12 ? "PM" : "AM"}`,
  };
}

function bookingSizes(bookings) {
  return new Map(bookings.map(booking => [
    String(booking.bookingId),
    Array.isArray(booking.golfers) ? booking.golfers.length : 0,
  ]));
}

function availablePlayers(section, sizes) {
  if (!section || section.isHeld) return 0;
  if ((section.bookings || []).some(bookingId => !sizes.get(String(bookingId)))) return 0;
  const bookedPlayers = (section.bookings || [])
    .reduce((total, bookingId) => total + (sizes.get(String(bookingId)) || 0), 0);
  return Math.max(0, 4 - bookedPlayers);
}

export function extractTeeSnapInventory(payload, defaults = {}) {
  const inventory = payload?.teeTimes || payload;
  const sizes = bookingSizes(inventory?.bookings || []);

  return (inventory?.teeTimes || []).flatMap(raw => {
    const dateTime = localDateTime(raw.teeTime);
    const section = (raw.teeOffSections || []).find(item => item.teeOff === "FRONT_NINE");
    const rate = (raw.prices || []).find(item => item.roundType === "EIGHTEEN_HOLE");
    const openPlayers = availablePlayers(section, sizes);
    const price = Number(rate?.priceWithAddOn);
    if (!dateTime || openPlayers < 1 || !Number.isFinite(price) || price <= 0) return [];

    return [adaptTeeSnapTeeTime({
      id: `teesnap-${defaults.courseId || "course"}-${dateTime.date}-${dateTime.time.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      date: dateTime.date,
      time: dateTime.time,
      slotsAvailable: openPlayers,
      holes: 18,
      price,
      rateName: rate.rackRateName || "Standard with cart",
    }, defaults)];
  });
}

export async function collectTeeSnapDay({ baseUrl, courseId, date, course, distanceMiles, fetchImpl = fetch }) {
  const url = new URL("/customer-api/teetimes-day", baseUrl);
  url.search = new URLSearchParams({ course: courseId, date, players: "1", holes: "18", addons: "on" });
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      Referer: baseUrl,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`TeeSnap feed returned HTTP ${response.status}.`);
  return extractTeeSnapInventory(await response.json(), { courseId, course, date, distanceMiles, url: `${baseUrl}?date=${date}` });
}
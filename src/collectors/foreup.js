import { adaptForeUpTeeTime } from "../adapters/foreup.js";

function scheduleIdFromUrl(url) {
  return new URL(url).pathname.match(/\/booking\/\d+\/(\d+)/)?.[1];
}

function requestDate(date) {
  const [year, month, day] = date.split("-");
  return `${month}-${day}-${year}`;
}

function to12Hour(time) {
  const [, hour24, minute] = time.match(/(\d{2}):(\d{2})$/) || [];
  const hour = Number(hour24);
  const period = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minute} ${period}`;
}

export function extractForeUpInventory(rows, defaults = {}) {
  return rows
    .filter(row => Number(row.green_fee_18) > 0)
    .map(row => adaptForeUpTeeTime({
      time: to12Hour(row.time),
      players: row.available_spots_18,
      holes: row.holes,
      price: row.green_fee_18,
    }, defaults));
}

export async function collectForeUpDay({ url, date, course, distanceMiles, fetchImpl = fetch }) {
  const scheduleId = scheduleIdFromUrl(url);
  const endpoint = new URL("https://foreupsoftware.com/index.php/api/booking/times");
  endpoint.searchParams.set("time", "all");
  endpoint.searchParams.set("date", requestDate(date));
  endpoint.searchParams.set("holes", "all");
  endpoint.searchParams.set("players", "0");
  endpoint.searchParams.set("schedule_id", scheduleId);
  endpoint.searchParams.set("specials_only", "0");
  endpoint.searchParams.set("api_key", "");
  const response = await fetchImpl(endpoint, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`ForeUp returned HTTP ${response.status}.`);
  const rows = await response.json();
  return extractForeUpInventory(rows, { course, date, distanceMiles, url });
}

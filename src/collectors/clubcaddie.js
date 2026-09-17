import { adaptClubCaddieTeeTime } from "../adapters/clubcaddie.js";

const endpoint = "https://apimanager-cc12.clubcaddie.com/webapi/TeeTimes";

function toSlashDate(date) {
  const [year, month, day] = date.split("-");
  return `${month}/${day}/${year}`;
}

function to12Hour(startTime) {
  const [, hour24, minute] = startTime.match(/(\d{2}):(\d{2})/) || [];
  const hour = Number(hour24);
  const period = hour >= 12 ? "PM" : "AM";
  return `${hour % 12 || 12}:${minute} ${period}`;
}

// The booking widget only renders course details once a (any) "Interaction" token is present in the URL.
async function fetchCourseId(apikey, slashDate, fetchImpl) {
  const url = new URL(`https://apimanager-cc12.clubcaddie.com/webapi/view/${apikey}/slots`);
  url.searchParams.set("date", slashDate);
  url.searchParams.set("player", "1");
  url.searchParams.set("ratetype", "any");
  url.searchParams.set("Interaction", Math.random().toString(36).slice(2));
  const response = await fetchImpl(url, { headers: { Accept: "text/html" }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Club Caddie returned HTTP ${response.status}.`);
  const html = await response.text();
  const courseId = html.match(/name="CourseId" value="(\d+)"/)?.[1];
  if (!courseId) throw new Error("Club Caddie course id not found.");
  return courseId;
}

export function extractClubCaddieInventory(slots, defaults = {}) {
  return slots.flatMap(slot => {
    const plans = (slot.PricingPlan || []).filter(plan => Number(plan.HoleRate_18) > 0);
    if (!plans.length) return [];
    const best = plans.toSorted((left, right) => Number(left.HoleRate_18) - Number(right.HoleRate_18))[0];
    return [adaptClubCaddieTeeTime({
      time: to12Hour(slot.StartTime),
      players: slot.PlayersAvailable,
      holes: 18,
      exactPrice: Number(best.HoleRate_18),
      rateName: String(best.TitleType || "Standard").replace(/\+/g, " "),
    }, defaults)];
  });
}

export async function collectClubCaddieDay({ url, date, course, distanceMiles, fetchImpl = fetch }) {
  const apikey = new URL(url).pathname.split("/").filter(Boolean).at(-1);
  const slashDate = toSlashDate(date);
  const courseId = await fetchCourseId(apikey, slashDate, fetchImpl);
  const body = new URLSearchParams({
    date: slashDate, player: "2", holes: "18", fromtime: "4", totime: "23",
    minprice: "0", maxprice: "9999", ratetype: "any", HoleGroup: "front", CourseId: courseId, apikey,
  });
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "*/*", "X-Requested-With": "XMLHttpRequest" },
    body: body.toString(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Club Caddie returned HTTP ${response.status}.`);
  const html = await response.text();
  const slots = [...html.matchAll(/name="slot" value="([^"]+)"/g)].map(match => JSON.parse(decodeURIComponent(match[1])));
  return extractClubCaddieInventory(slots, { course, date, distanceMiles, url });
}

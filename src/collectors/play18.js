import { adaptPlay18TeeTime } from "../adapters/play18.js";

function decodeHtml(value) {
  return value.replaceAll("&amp;", "&").replaceAll("&quot;", "\"").replaceAll("&#39;", "'");
}

export function extractPlay18Inventory(html, defaults = {}) {
  const rowPattern = /<tr>[\s\S]*?<td class="mtrxTeeTimes">\s*(\d{1,2}:\d{2})<div class="be_tee_time_ampm">(AM|PM)<\/div>[\s\S]*?<td class="matrixPlayers">\s*(\d+) to (\d+) players<\/td>[\s\S]*?<div class="mtrxPrice">\$(\d+(?:\.\d+)?)<\/div>[\s\S]*?<a class="sexybutton teebutton" href="([^"]+)"/gi;
  return [...String(html).matchAll(rowPattern)].map(match => adaptPlay18TeeTime({
    time: `${match[1]} ${match[2].toUpperCase()}`,
    players: `${match[3]} to ${match[4]} players`,
    holes: 18,
    price: Number(match[5]),
    url: new URL(decodeHtml(match[6]), defaults.baseUrl).href,
  }, defaults));
}

export async function collectPlay18Day({ url, date, course, distanceMiles, fetchImpl = fetch }) {
  const endpoint = new URL(url);
  endpoint.searchParams.set("teedate", date.replaceAll("-", ""));
  const displayDate = new Intl.DateTimeFormat("en-US", { month: "numeric", day: "numeric", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${date}T12:00:00Z`));
  const body = new URLSearchParams({
    "SearchForm.Date": displayDate,
    "SearchForm.TimeOfDay": "Any",
    "SearchForm.Players": "2",
    "SearchForm.CourseId": "0",
  });
  const response = await fetchImpl(endpoint, {
    method: "POST",
    body,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: url,
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Play18 feed returned HTTP ${response.status}.`);
  return extractPlay18Inventory(await response.text(), {
    baseUrl: new URL(url).origin,
    course,
    date,
    distanceMiles,
    url,
  });
}
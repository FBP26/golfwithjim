import { execFile } from "node:child_process";
import { promisify } from "node:util";

const baseUrl = "https://www.chronogolf.com/marketplace";
const execFileAsync = promisify(execFile);

async function curlJson(url, options = {}) {
  const args = ["--silent", "--show-error", "--fail", "--retry", "5", "--retry-all-errors", "--retry-delay", "2", "--header", "Accept: application/json"];
  if (options.method === "POST") args.push("--request", "POST", "--header", "Content-Type: application/json", "--data", options.body);
  args.push(String(url));
  const { stdout } = await execFileAsync("curl.exe", args, { maxBuffer: 10 * 1024 * 1024 });
  return { payload: JSON.parse(stdout), headers: new Headers() };
}

async function jsonRequest(url, options, fetchImpl) {
  if (fetchImpl === fetch && process.platform === "win32") return curlJson(url, options);
  const response = await fetchImpl(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...options?.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Chronogolf feed returned HTTP ${response.status}.`);
  return { payload: await response.json(), headers: response.headers };
}

async function listTeeTimes({ courseUuid, date, fetchImpl }) {
  const teeTimes = [];
  for (let page = 1; ; page += 1) {
    const url = new URL(`${baseUrl}/v2/teetimes`);
    url.searchParams.set("start_date", date);
    url.searchParams.set("course_ids", courseUuid);
    url.searchParams.set("holes", "18");
    url.searchParams.set("page", page);
    const { payload, headers } = await jsonRequest(url, {}, fetchImpl);
    const pageTimes = payload.teetimes || [];
    teeTimes.push(...pageTimes);
    const total = Number(headers.get("total") || 0);
    if (!pageTimes.length || (total > 0 ? teeTimes.length >= total : pageTimes.length < 24)) return teeTimes;
  }
}

function publicAffiliation(teeTime) {
  return teeTime.affiliation_types_availability
    ?.flatMap(availability => availability.bookable_holes || [])
    .find(option => Number(option.hole) === 18)
    ?.affiliation_types?.find(affiliation => affiliation.affiliation_type?.toLowerCase() === "public");
}

async function quoteTeeTime(teeTime, affiliationTypeId, fetchImpl) {
  let detail = teeTime;
  let publicAffiliationTypeId = affiliationTypeId;
  if (!publicAffiliationTypeId) {
    ({ payload: detail } = await jsonRequest(`${baseUrl}/v2/teetimes/${teeTime.uuid}`, {}, fetchImpl));
    publicAffiliationTypeId = publicAffiliation(detail)?.affiliation_type_id;
  }
  if (!publicAffiliationTypeId || Number(detail.max_player_size) < 2) return null;
  const round = { affiliation_type_id: String(publicAffiliationTypeId), extras: [], discounts: [] };
  const { payload: options } = await jsonRequest(`${baseUrl}/reservations/options`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nb_holes: "18",
      rounds_attributes: [round, round],
      source: "chronogolf",
      medium: "profile",
      teetime_id: String(detail.id),
    }),
  }, fetchImpl);
  const option = options.find(item => Number(item.holes) === 18 && Number(item.invoice?.total) > 0);
  if (!option) return null;
  return { detail, price: Number(option.invoice.total) / 2 };
}

function displayTime(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

export async function collectChronogolfDay({ courseUuid, affiliationTypeId, date, course, distanceMiles, url, fetchImpl = fetch }) {
  const listed = (await listTeeTimes({ courseUuid, date, fetchImpl }))
    .filter(teeTime => Number(teeTime.max_player_size) >= 2 && teeTime.course?.bookable_holes?.includes(18));
  const quoted = [];
  for (let index = 0; index < listed.length; index += 2) {
    quoted.push(...await Promise.all(listed.slice(index, index + 2).map(async teeTime => ({
      teeTime,
      quote: await quoteTeeTime(teeTime, affiliationTypeId, fetchImpl).catch(() => null),
    }))));
  }
  return quoted.filter(item => item.quote).map(({ teeTime, quote }) => ({
    id: `chronogolf-${teeTime.id}`,
    source: "Chronogolf",
    course,
    date,
    time: displayTime(teeTime.start_time),
    availablePlayers: Number(quote.detail.max_player_size),
    holes: 18,
    allInPrice: quote.price,
    priceIsExact: true,
    hotDeal: false,
    rateName: "Public 18 Holes",
    distanceMiles,
    url: `${url}?date=${date}`,
  }));
}
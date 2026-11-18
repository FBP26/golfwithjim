import { execFile } from "node:child_process";
import { promisify } from "node:util";

const directBaseUrl = "https://www.chronogolf.com/marketplace";
const execFileAsync = promisify(execFile);
let useDirectCurl = false;

function requestUrl(path, searchParams = {}) {
  const target = new URL(path, `${directBaseUrl}/`);
  for (const [name, value] of Object.entries(searchParams)) target.searchParams.set(name, value);
  const proxyUrl = process.env.CHRONOGOLF_PROXY_URL;
  if (!proxyUrl) return target;
  const proxy = new URL(proxyUrl);
  proxy.searchParams.set("target", target);
  return proxy;
}

async function curlJson(url, options = {}) {
  const args = ["--silent", "--show-error", "--fail", "--connect-timeout", "10", "--max-time", "20", "--retry", "2", "--retry-delay", "2", "--header", "Accept: application/json"];
  if (options.method === "POST") args.push("--request", "POST", "--header", "Content-Type: application/json", "--data", options.body);
  args.push(String(url));
  const { stdout } = await execFileAsync(process.platform === "win32" ? "curl.exe" : "curl", args, { maxBuffer: 10 * 1024 * 1024 });
  return { payload: JSON.parse(stdout), headers: new Headers() };
}

// Chronogolf sits behind Cloudflare bot detection, which occasionally 403s even legitimate proxied traffic.
async function fetchWithRetry(fetchImpl, url, options, attempts = 3) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetchImpl(url, options);
    if (response.ok || attempt === attempts - 1) return response;
    const delay = Math.min(500 * 2 ** attempt, 4000) + Math.random() * 300;
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  throw new Error("Unreachable");
}

async function jsonRequest(url, options, fetchImpl) {
  const proxyToken = process.env.CHRONOGOLF_PROXY_TOKEN;
  const directUrl = new URL(url).searchParams.get("target") || url;
  if (fetchImpl === fetch && (useDirectCurl || (process.platform === "win32" && !proxyToken))) return curlJson(directUrl, options);
  let response = await fetchWithRetry(fetchImpl, url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(proxyToken ? { Authorization: `Bearer ${proxyToken}` } : {}),
      ...options?.headers,
    },
    signal: AbortSignal.timeout(20_000),
  }, 3);
  if (response.status === 403 && process.env.CHRONOGOLF_PROXY_URL) {
    const proxy = new URL(process.env.CHRONOGOLF_PROXY_URL);
    const requested = new URL(url);
    const target = requested.searchParams.get("target");
    if (requested.origin === proxy.origin && requested.pathname === proxy.pathname && target && new URL(target).origin === "https://www.chronogolf.com") {
      response = await fetchWithRetry(fetchImpl, new URL(target), {
        ...options,
        headers: { Accept: "application/json", ...options?.headers },
        signal: AbortSignal.timeout(20_000),
      }, 3);
    }
  }
  if (response.status === 403 && fetchImpl === fetch) {
    const result = await curlJson(directUrl, options);
    useDirectCurl = true;
    return result;
  }
  if (!response.ok) throw new Error(`Chronogolf feed returned HTTP ${response.status}.`);
  return { payload: await response.json(), headers: response.headers };
}

async function listTeeTimes({ courseUuid, date, fetchImpl }) {
  const teeTimes = [];
  for (let page = 1; ; page += 1) {
    const url = requestUrl("v2/teetimes", {
      start_date: date,
      course_ids: courseUuid,
      holes: "18",
      page,
    });
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
    ({ payload: detail } = await jsonRequest(requestUrl(`v2/teetimes/${teeTime.uuid}`), {}, fetchImpl));
    publicAffiliationTypeId = publicAffiliation(detail)?.affiliation_type_id;
  }
  if (!publicAffiliationTypeId || Number(detail.max_player_size) < 1) return null;
  const players = Math.min(2, Number(detail.max_player_size));
  const round = { affiliation_type_id: String(publicAffiliationTypeId), extras: [], discounts: [] };
  const { payload: options } = await jsonRequest(requestUrl("reservations/options"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nb_holes: "18",
      rounds_attributes: Array.from({ length: players }, () => round),
      source: "chronogolf",
      medium: "profile",
      teetime_id: String(detail.id),
    }),
  }, fetchImpl);
  const option = options.find(item => Number(item.holes) === 18 && Number(item.invoice?.total) > 0);
  if (!option) return null;
  return { detail, price: Number(option.invoice.total) / players };
}

function displayTime(value) {
  const [hours, minutes] = value.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours >= 12 ? "PM" : "AM"}`;
}

export async function collectChronogolfDay({ courseUuid, affiliationTypeId, date, course, distanceMiles, url, fetchImpl = fetch }) {
  const listed = (await listTeeTimes({ courseUuid, date, fetchImpl }))
    .filter(teeTime => Number(teeTime.max_player_size) >= 1 && teeTime.course?.bookable_holes?.includes(18));
  // Quoting every start is slow (one reservation-options POST each). Within an hour, starts with the same
  // party size almost always share a price, so quote the first and last start of each hour block; when they
  // match, reuse that price for the starts in between, otherwise quote every start in the block.
  const quoted = [];
  const quoteErrors = [];
  const quote = teeTime => quoteTeeTime(teeTime, affiliationTypeId, fetchImpl).catch(error => { quoteErrors.push(error); return null; });
  const blocks = Map.groupBy(listed, teeTime => `${String(teeTime.start_time).slice(0, 2)}|${Math.min(2, Number(teeTime.max_player_size))}`);
  for (const block of blocks.values()) {
    if (block.length <= 2 || !affiliationTypeId) {
      for (let index = 0; index < block.length; index += 2) {
        quoted.push(...await Promise.all(block.slice(index, index + 2).map(async teeTime => ({ teeTime, quote: await quote(teeTime) }))));
      }
      continue;
    }
    const [first, last] = await Promise.all([quote(block[0]), quote(block.at(-1))]);
    if (first && last && first.price === last.price) {
      quoted.push({ teeTime: block[0], quote: first }, ...block.slice(1, -1).map(teeTime => ({ teeTime, quote: { detail: teeTime, price: first.price } })), { teeTime: block.at(-1), quote: last });
      continue;
    }
    quoted.push({ teeTime: block[0], quote: first });
    const middle = block.slice(1, -1);
    for (let index = 0; index < middle.length; index += 2) {
      quoted.push(...await Promise.all(middle.slice(index, index + 2).map(async teeTime => ({ teeTime, quote: await quote(teeTime) }))));
    }
    quoted.push({ teeTime: block.at(-1), quote: last });
  }
  quoted.sort((left, right) => String(left.teeTime.start_time).localeCompare(String(right.teeTime.start_time)));
  if (quoteErrors.length && !quoted.some(item => item.quote)) throw quoteErrors[0];
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
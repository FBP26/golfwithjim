import { isPublicRate, parseTimeMinutes } from "./analyze.js";

export const dealPolicy = { minimumPercent: 20, minimumSavings: 10, historyDays: 56 };
const dayMillis = 86400000;
export const median = values => {
  const sorted = values.toSorted((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length ? (sorted[middle] + sorted[Math.max(0, Math.ceil(sorted.length / 2) - 1)]) / 2 : null;
};
const easternDay = value => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const rateKey = offer => String(offer.rateName || "public").toLowerCase().replace(/\b(hot\s*deal|golfpass|discounted|special|promo)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim() || "public";
const partyKey = offer => (offer.availablePartySizes?.length ? [...offer.availablePartySizes] : [1, 2, 3, 4].filter(size => size <= offer.availablePlayers)).sort().join(",");
const leadBand = (date, observed) => {
  const days = Math.max(0, Math.round((Date.parse(date) - Date.parse(observed)) / dayMillis));
  return days === 0 ? "same day" : days <= 3 ? "1-3 days" : days <= 7 ? "4-7 days" : "8+ days";
};
const period = minutes => minutes < 720 ? "Morning" : minutes < 900 ? "Afternoon" : "Twilight";
const valid = offer => !offer.stale && !offer.cacheExpiresAt && offer.priceIsExact === true && offer.holes === 18
  && Number.isFinite(offer.allInPrice) && offer.allInPrice > 0 && offer.availablePlayers > 0
  && isPublicRate(offer.rateName) && Number.isFinite(parseTimeMinutes(offer.time));
const family = offer => JSON.stringify([offer.course, offer.source, rateKey(offer), partyKey(offer)]);
export const offerKey = offer => JSON.stringify([offer.course, offer.date, offer.time, offer.source, offer.rateName, offer.allInPrice, partyKey(offer)]);
export function applyPriceSnapshot(offers, snapshot, checkedAt, now = Date.now(), sourceChecks = null) {
  const checked = Date.parse(checkedAt);
  if (!Number.isFinite(checked) || checked > now + 300000 || now - checked > 30 * 3600000) return offers.map(offer => ({ ...offer, hotDeal: false, deal: null }));
  if (!snapshot || !Array.isArray(snapshot.deals) || snapshot.checkedAt !== checkedAt || !Number.isFinite(Date.parse(snapshot.computedAt)) || Date.parse(snapshot.computedAt) > now + 300000 || now - Date.parse(snapshot.computedAt) > 30 * 3600000) return qualifyDeals(offers, [], now, sourceChecks);
  const deals = new Map(snapshot.deals.map(row => [row.key, row.deal]));
  const checks = sourceChecks && sourceTimes(sourceChecks, now);
  return offers.map(offer => {
    const deal = valid(offer) && (!checks || sourceTime(offer, checks)) ? deals.get(offerKey(offer)) || null : null;
    return { ...offer, hotDeal: Boolean(deal), deal };
  });
}

function sourceTimes(sourceChecks, now) {
  const checks = new Map();
  for (const check of sourceChecks) {
    const stamp = Date.parse(check.checkedAt);
    if (!check.error && Number.isFinite(stamp) && stamp <= now + 300000 && now - stamp <= 30 * 3600000) checks.set(JSON.stringify([check.course, check.source || ""]), check.checkedAt);
  }
  return checks;
}
const sourceTime = (offer, checks) => checks.get(JSON.stringify([offer.course, offer.source])) || checks.get(JSON.stringify([offer.course, ""]));

export function priceObservations(feed, now = Date.now()) {
  const checks = sourceTimes(feed.sourceChecks || [], now);
  const observedDays = new Map([...checks.values()].map(stamp => [stamp, easternDay(stamp)]));
  const groups = new Map();
  for (const offer of feed.teeTimes) {
    if (!valid(offer)) continue;
    const seenAt = sourceTime(offer, checks);
    if (!seenAt) continue;
    const observed = observedDays.get(seenAt);
    if (offer.date < observed) continue;
    const band = Math.floor(parseTimeMinutes(offer.time) / 15) * 15;
    const key = JSON.stringify([family(offer), offer.date, band, observed]);
    if (!groups.has(key)) groups.set(key, { course: offer.course, observed, date: offer.date, band, source: offer.source, rate: rateKey(offer), party: partyKey(offer), lead: leadBand(offer.date, observed), seenAt, prices: [], providerPromo: false });
    const row = groups.get(key);
    row.prices.push(offer.allInPrice);
    row.providerPromo ||= Boolean(offer.providerHotDeal ?? offer.hotDeal);
  }
  return [...groups.values()].map(({ prices, ...row }) => ({ ...row, low: Math.min(...prices), high: Math.max(...prices), median: median(prices), count: prices.length }));
}

export function mergePriceDay(previous, incoming) {
  const key = row => JSON.stringify([row.date, row.band, row.source, row.rate, row.party]);
  const rows = new Map(previous.map(row => [key(row), row]));
  for (const row of incoming) {
    const old = rows.get(key(row));
    if (old && old.seenAt >= row.seenAt) continue;
    rows.set(key(row), { ...row, low: Math.min(old?.low ?? Infinity, row.low), high: Math.max(old?.high ?? 0, row.high) });
  }
  return [...rows.values()];
}

export function qualifyDeals(offers, history = [], now = Date.now(), sourceChecks = null) {
  const today = easternDay(now);
  const checks = sourceChecks && sourceTimes(sourceChecks, now);
  const eligible = offer => valid(offer) && (!checks || sourceTime(offer, checks));
  const groups = new Map();
  for (const offer of offers) {
    if (!eligible(offer)) continue;
    const key = JSON.stringify([family(offer), offer.date, period(parseTimeMinutes(offer.time))]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(offer);
  }
  const historyGroups = new Map();
  for (const row of history) {
    if (Date.parse(row.observed) < now - dealPolicy.historyDays * dayMillis || Date.parse(row.seenAt) > now) continue;
    const key = JSON.stringify([row.course, row.source, row.rate, row.party, row.band]);
    if (!historyGroups.has(key)) historyGroups.set(key, []);
    historyGroups.get(key).push(row);
  }
  return offers.map(offer => {
    const output = { ...offer, providerHotDeal: Boolean(offer.providerHotDeal ?? offer.hotDeal), hotDeal: false, deal: null };
    if (!eligible(offer)) return output;
    const minutes = parseTimeMinutes(offer.time);
    const references = [];
    if (Number.isFinite(offer.standardAllInPrice) && offer.standardAllInPrice > offer.allInPrice) references.push({ price: offer.standardAllInPrice, basis: "Same offer standard price", samples: 1 });
    const peers = groups.get(JSON.stringify([family(offer), offer.date, period(minutes)])) || [];
    const atSameTime = peers.filter(peer => peer !== offer && parseTimeMinutes(peer.time) === minutes && peer.allInPrice > offer.allInPrice);
    if (atSameTime.length) references.push({ price: Math.min(...atSameTime.map(peer => peer.allInPrice)), basis: "Same start and comparable rate", samples: atSameTime.length });
    const before = peers.filter(peer => parseTimeMinutes(peer.time) < minutes && minutes - parseTimeMinutes(peer.time) <= 30);
    const after = peers.filter(peer => parseTimeMinutes(peer.time) > minutes && parseTimeMinutes(peer.time) - minutes <= 30);
    if (before.length && after.length) references.push({ price: Math.min(...before.map(peer => peer.allInPrice), ...after.map(peer => peer.allInPrice)), basis: "Comparable starts on both sides", samples: before.length + after.length });
    const past = (historyGroups.get(JSON.stringify([offer.course, offer.source, rateKey(offer), partyKey(offer), Math.floor(minutes / 15) * 15])) || [])
      .filter(row => row.observed < today && new Date(`${row.date}T12:00:00Z`).getUTCDay() === new Date(`${offer.date}T12:00:00Z`).getUTCDay()
        && row.lead === leadBand(offer.date, today) && Math.abs(Date.parse(row.date) - Date.parse(offer.date)) <= 56 * dayMillis);
    if (new Set(past.map(row => row.observed)).size >= 3 && new Set(past.map(row => row.date)).size >= 3) references.push({ price: median(past.map(row => row.median)), basis: "Same weekday, time, terms and booking window", samples: past.length });
    const reference = references.toSorted((left, right) => left.price - right.price)[0];
    if (!reference || reference.price <= offer.allInPrice) return output;
    const savings = Math.round((reference.price - offer.allInPrice) * 100) / 100;
    const percent = savings / reference.price * 100;
    if (savings >= dealPolicy.minimumSavings && percent + 0.000001 >= dealPolicy.minimumPercent) {
      output.hotDeal = true;
      output.deal = { referencePrice: reference.price, savings, percent: Math.round(percent), basis: reference.basis, samples: reference.samples };
    }
    return output;
  });
}
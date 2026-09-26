import { isPublicRate, parseTimeMinutes } from "./analyze.js";
import { LOCAL_COURSES } from "./dashboard.js";

export const alertCourseGroups = [
  { value: "group:all", label: "All courses" },
  { value: "group:local", label: "Local courses" },
  { value: "group:regional", label: "Regional courses" },
];

const easternFormatter = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const defaultAlerts = [
  { id: "magnolia-saturday", course: "Magnolia Green Golf Club", days: [6], from: "00:00", until: "10:00", minPrice: 0, maxPrice: null, players: 0, hotDealsOnly: false, enabled: true, startDate: "", endDate: "" },
  { id: "spring-creek-price", course: "Spring Creek Golf Club", days: [0, 1, 2, 3, 4, 5, 6], from: "00:00", until: "23:59", minPrice: 0, maxPrice: 119.99, players: 0, hotDealsOnly: false, enabled: true, startDate: "", endDate: "" },
];

export function validateAlerts(rules, courseNames) {
  if (!Array.isArray(rules) || rules.length > 20) throw new Error("Choose up to 20 alerts.");
  const ids = new Set();
  return rules.map(rule => {
    if (!rule || typeof rule !== "object" || !/^[a-zA-Z0-9-]{1,64}$/.test(rule.id) || ids.has(rule.id)) throw new Error("Invalid alert identifier.");
    ids.add(rule.id);
    if (!courseNames.includes(rule.course) && !alertCourseGroups.some(group => group.value === rule.course)) throw new Error("Choose a supported course or course group.");
    if (!Array.isArray(rule.days) || !rule.days.length || rule.days.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new Error("Choose at least one day.");
    if (![rule.from, rule.until].every(value => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)) || rule.from > rule.until) throw new Error("Enter an ordered time range.");
    if (!Number.isFinite(rule.minPrice) || rule.minPrice < 0 || rule.minPrice > 2000 || (rule.maxPrice !== null && (!Number.isFinite(rule.maxPrice) || rule.maxPrice < rule.minPrice || rule.maxPrice > 2000))) throw new Error("Enter a price range from $0 to $2,000, or leave the maximum blank.");
    if (!Number.isInteger(rule.players) || rule.players < 0 || rule.players > 4) throw new Error("Choose any party size or 1 to 4 golfers.");
    for (const value of [rule.startDate, rule.endDate]) {
      if (value !== "" && (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value)) throw new Error("Enter a valid date.");
    }
    if (rule.startDate && rule.endDate && rule.startDate > rule.endDate) throw new Error("The last date must follow the first date.");
    if (typeof rule.enabled !== "boolean" || typeof rule.hotDealsOnly !== "boolean") throw new Error("Invalid alert options.");
    return { id: rule.id, course: rule.course, days: [...new Set(rule.days)].sort(), from: rule.from, until: rule.until, minPrice: rule.minPrice, maxPrice: rule.maxPrice, players: rule.players, hotDealsOnly: rule.hotDealsOnly, enabled: rule.enabled, startDate: rule.startDate, endDate: rule.endDate };
  });
}

export function matchesAlert(teeTime, rule, now = new Date()) {
  const courseMatches = teeTime.course === rule.course || rule.course === "group:all"
    || (rule.course === "group:local" && LOCAL_COURSES.has(teeTime.course))
    || (rule.course === "group:regional" && !LOCAL_COURSES.has(teeTime.course));
  if (!rule.enabled || !courseMatches || teeTime.stale || teeTime.priceIsExact !== true || teeTime.holes !== 18 || !isPublicRate(teeTime.rateName)) return false;
  if (!Number.isFinite(teeTime.allInPrice) || teeTime.allInPrice <= 0 || teeTime.allInPrice < rule.minPrice || (rule.maxPrice !== null && teeTime.allInPrice > rule.maxPrice)) return false;
  if (rule.hotDealsOnly && !teeTime.hotDeal) return false;
  const minutes = parseTimeMinutes(teeTime.time);
  const toMinutes = value => Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
  if (!Number.isFinite(minutes) || minutes < toMinutes(rule.from) || minutes > toMinutes(rule.until)) return false;
  const date = new Date(`${teeTime.date}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || !rule.days.includes(date.getUTCDay())) return false;
  if ((rule.startDate && teeTime.date < rule.startDate) || (rule.endDate && teeTime.date > rule.endDate)) return false;
  const parts = Object.fromEntries(easternFormatter.formatToParts(now).map(part => [part.type, part.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  if (teeTime.date < today || (teeTime.date === today && minutes <= Number(parts.hour) * 60 + Number(parts.minute))) return false;
  const sizes = Array.isArray(teeTime.availablePartySizes) ? teeTime.availablePartySizes.filter(size => Number.isInteger(size) && size >= 1 && size <= 4 && size <= teeTime.availablePlayers) : [1, 2, 3, 4].filter(size => size <= teeTime.availablePlayers);
  return rule.players === 0 ? sizes.length > 0 : sizes.includes(rule.players);
}

export function alertSummary(rule) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const price = rule.maxPrice === null ? (rule.minPrice ? `$${rule.minPrice.toFixed(2)}+` : "Any price") : `$${rule.minPrice.toFixed(2)}-$${rule.maxPrice.toFixed(2)}`;
  const course = alertCourseGroups.find(group => group.value === rule.course)?.label || rule.course;
  return `${rule.enabled ? "Active" : "Paused"}: ${course}; ${rule.days.length === 7 ? "Every day" : rule.days.map(day => days[day]).join(", ")}; ${rule.from}-${rule.until} Eastern; ${price} per golfer; ${rule.players || "Any available"} golfer${rule.players === 1 ? "" : "s"}; 18 holes${rule.hotDealsOnly ? "; Hot Deals only" : ""}${rule.startDate ? `; from ${rule.startDate}` : ""}${rule.endDate ? `; through ${rule.endDate}` : ""}`;
}
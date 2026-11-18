// Shared data loader for the Golf Stats pages. Keeps the last copy so pages open instantly and work offline.
const override = new URLSearchParams(location.search).get("api");
export const API = override && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(override) ? override : "https://golf-stats.fbp-api-worker.workers.dev";
const CACHE_KEY = "golfStatsData.v1";

export function cachedData() {
  try { const raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

export async function loadData({ fresh = false } = {}) {
  const cached = cachedData();
  try {
    const response = await fetch(`${API}/data`, { cache: fresh ? "no-cache" : "default" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(data)); } catch {}
    return expand(data);
  } catch (error) {
    if (cached) return { ...expand(cached), offline: true };
    throw error;
  }
}

const GREEN = ["miss", "gir", "sgir"];
// Turns the compact arrays into friendly objects with per-round totals.
export function expand(data) {
  const rounds = data.rounds.map(([id, date, player, course, roundNumber, notes, revision]) => ({ id, date, player, course, roundNumber, notes, revision, holes: [] }));
  const holes = data.holes.map(([r, hole, tees, score, par, yards, handicap, fir, green]) => {
    const h = { round: rounds[r], hole, tees, score, par, yards, handicap, fir: fir == null ? null : Boolean(fir), green: green == null ? null : GREEN[green], diff: score - par };
    rounds[r].holes.push(h);
    return h;
  });
  for (const [r, hole, note] of data.conditions || []) { const h = rounds[r]?.holes.find(x => x.hole === hole); if (h) h.condition = note; }
  for (const r of rounds) {
    r.holes.sort((a, b) => a.hole - b.hole);
    r.score = r.holes.reduce((s, h) => s + h.score, 0);
    r.par = r.holes.reduce((s, h) => s + h.par, 0);
    r.count = r.holes.length;
    r.full = r.count === 18;
    r.yards = r.holes.reduce((s, h) => s + (h.yards || 0), 0);
    r.tees = [...new Set(r.holes.map(h => h.tees))].join(" / ");
    r.year = Number(r.date.slice(0, 4));
  }
  const layouts = new Map();
  for (const [course, tees, hole, par, yards, handicap] of data.layouts) {
    if (!layouts.has(course)) layouts.set(course, new Map());
    const byTee = layouts.get(course);
    if (!byTee.has(tees)) byTee.set(tees, []);
    byTee.get(tees).push({ hole, par, yards, handicap });
  }
  const courses = new Map(data.courses.map(c => [c.name, c]));
  const players = [...new Set(rounds.map(r => r.player))].sort((a, b) => a.localeCompare(b));
  return { ...data, rounds, holes, layouts, courseInfo: courses, players };
}

export const resultName = diff => diff <= -2 ? "eagle" : diff === -1 ? "birdie" : diff === 0 ? "par" : diff === 1 ? "bogey" : diff === 2 ? "double" : "triple";
export const RESULTS = ["eagle", "birdie", "par", "bogey", "double", "triple"];
export const toPar = n => n === 0 ? "E" : n > 0 ? `+${n}` : String(n);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const fmtDate = iso => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

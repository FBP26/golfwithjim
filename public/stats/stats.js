import { loadData, cachedData, expand, resultName, RESULTS, toPar, esc, fmtDate } from "./golf-data.js?v=20261118";

const $ = s => document.querySelector(s);
const COLORS = { eagle: "var(--eagle)", birdie: "var(--birdie)", par: "#7f9c8a", bogey: "#e9b679", double: "var(--double)", triple: "var(--triple)" };
const LABEL = { eagle: "Eagle+", birdie: "Birdie", par: "Par", bogey: "Bogey", double: "Double", triple: "Triple+" };
const VIEWS = [
  ["overview", "Overview"], ["rounds", "Rounds"], ["best", "Best scores"], ["course", "Course"], ["holes", "Holes"],
  ["years", "Years"], ["golfers", "Golfers"], ["map", "Map"], ["trophies", "Trophy room"], ["handicaps", "Handicaps"],
];
let D = null;
const state = { view: "overview", player: "", year: "", course: "", window: "" };

// ---------- filters ----------
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  for (const k of Object.keys(state)) if (p.has(k)) state[k] = p.get(k);
}
function writeHash() {
  const p = new URLSearchParams(); for (const [k, v] of Object.entries(state)) if (v && !(k === "view" && v === "overview")) p.set(k, v);
  history.replaceState(null, "", `#${p}`);
}
const complexOf = course => D.courseInfo.get(course)?.complex || course;
function filteredRounds({ ignorePlayer = false, ignoreCourse = false } = {}) {
  const cutoff = state.window ? new Date(Date.now() - Number(state.window) * 86400000).toISOString().slice(0, 10) : "";
  return D.rounds.filter(r => (ignorePlayer || !state.player || r.player === state.player) && (!state.year || String(r.year) === state.year) && (ignoreCourse || !state.course || r.course === state.course || complexOf(r.course) === state.course) && (!cutoff || r.date >= cutoff));
}
const holesOf = rounds => rounds.flatMap(r => r.holes);
function fillFilters() {
  const opt = (v, l, sel) => `<option value="${esc(v)}" ${v === sel ? "selected" : ""}>${esc(l)}</option>`;
  const counts = new Map(); for (const r of D.rounds) counts.set(r.player, (counts.get(r.player) || 0) + 1);
  $("#f-player").innerHTML = opt("", "Everyone", state.player) + [...counts].sort((a, b) => b[1] - a[1]).map(([p, n]) => opt(p, `${p} (${n})`, state.player)).join("");
  $("#f-year").innerHTML = opt("", "All years", state.year) + [...new Set(D.rounds.map(r => r.year))].sort((a, b) => b - a).map(y => opt(String(y), y, state.year)).join("");
  const complexes = new Map(); for (const r of D.rounds) { const c = complexOf(r.course); if (!complexes.has(c)) complexes.set(c, new Set()); complexes.get(c).add(r.course); }
  $("#f-course").innerHTML = opt("", "All courses", state.course) + [...complexes].sort((a, b) => a[0].localeCompare(b[0])).map(([c, set]) => set.size > 1 || !set.has(c) ? `<optgroup label="${esc(c)}">${opt(c, `${c} (all)`, state.course)}${[...set].sort().map(x => opt(x, x, state.course)).join("")}</optgroup>` : opt(c, c, state.course)).join("");
  $("#f-window").value = state.window;
}
for (const id of ["player", "year", "course", "window"]) document.addEventListener("change", e => { if (e.target.id === `f-${id}`) { state[id] = e.target.value; writeHash(); render(); } });

// ---------- helpers ----------
const avg = xs => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
const fmt = (n, d = 1) => Number.isFinite(n) ? n.toFixed(d) : "–";
const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : "–";
function resultCounts(holes) { const c = Object.fromEntries(RESULTS.map(r => [r, 0])); for (const h of holes) c[resultName(h.diff)]++; return c; }
function summaryText(r) { const c = resultCounts(r.holes); return RESULTS.filter(k => c[k]).map(k => `${c[k]} ${k === "triple" ? "triple" : k}${c[k] > 1 ? (k === "birdie" ? "s" : k === "eagle" ? "s" : "s") : ""}`).join(", ").replace(/triples/g, "triples").replace(/doubles/g, "doubles"); }
function accuracy(holes) {
  const fh = holes.filter(h => h.fir != null), gh = holes.filter(h => h.green != null);
  return { fir: fh.filter(h => h.fir).length, firN: fh.length, gir: gh.filter(h => h.green !== "miss").length, sgir: gh.filter(h => h.green === "sgir").length, girN: gh.length };
}
function scorecard(r) {
  const cells = (hs, f) => hs.map(f).join("");
  const front = r.holes.filter(h => h.hole <= 9), back = r.holes.filter(h => h.hole >= 10);
  const sum = (hs, k) => hs.reduce((s, h) => s + (h[k] || 0), 0);
  const mark = h => `${h.fir ? "F" : ""}${h.green === "gir" ? "G" : h.green === "sgir" ? "SG" : ""}`;
  const block = hs => hs.length ? `<tr><th>Hole</th>${cells(hs, h => `<th>${h.hole}</th>`)}<th>${hs[0].hole <= 9 ? "OUT" : "IN"}</th></tr>
    <tr><th>Par</th>${cells(hs, h => `<td>${h.par}</td>`)}<td>${sum(hs, "par")}</td></tr>
    <tr><th>${esc(r.player)}</th>${cells(hs, h => `<td class="r-${resultName(h.diff)}" title="${h.condition ? esc(h.condition) : ""}">${h.score}</td>`)}<td><b>${sum(hs, "score")}</b></td></tr>
    ${hs.some(h => h.fir != null || h.green != null) ? `<tr><th>F/G</th>${cells(hs, h => `<td>${mark(h)}</td>`)}<td></td></tr>` : ""}` : "";
  return `<div><b>${fmtDate(r.date)}</b> · ${esc(r.course)} · ${esc(r.tees)} · ${r.score} (${toPar(r.score - r.par)})${r.count < 18 ? ` · ${r.count} holes` : ""}<table class="scorecard">${block(front)}${block(back)}</table>${partnersLine(r)}</div>`;
}
const outingKey = r => `${r.date}|${complexOf(r.course)}`;
let outings = null;
function partnersOf(r) {
  if (!outings) { outings = new Map(); for (const x of D.rounds) { const k = outingKey(x); if (!outings.has(k)) outings.set(k, []); outings.get(k).push(x); } }
  return (outings.get(outingKey(r)) || []).filter(x => x.player !== r.player);
}
function partnersLine(r) { const p = partnersOf(r); return p.length ? `<div class="muted">With ${p.map(x => `${esc(x.player)} ${x.score}${x.count < 18 ? `/${x.count}` : ""}`).join(", ")}</div>` : ""; }

// tooltips
const tip = $("#tip");
document.addEventListener("mouseover", e => { const t = e.target.closest("[data-tip]"); if (!t) return; tip.innerHTML = tipStore.get(t.dataset.tip) || ""; tip.hidden = false; });
document.addEventListener("mousemove", e => { if (tip.hidden) return; const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8); const y = e.clientY + 16 + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : e.clientY + 16; tip.style.left = `${x}px`; tip.style.top = `${y}px`; });
document.addEventListener("mouseout", e => { if (e.target.closest("[data-tip]")) tip.hidden = true; });
const tipStore = new Map(); let tipN = 0;
const tipAttr = html => { const id = `t${tipN++}`; tipStore.set(id, html); return `data-tip="${id}"`; };

// ---------- charts (plain SVG) ----------
function lineChart(points, { height = 240, yLabel = "", rolling = 0 } = {}) {
  if (!points.length) return `<p class="muted">No full 18-hole rounds for these filters.</p>`;
  const W = 900, H = height, L = 36, B = 22, T = 10;
  const ys = points.map(p => p.y), min = Math.floor(Math.min(...ys) / 5) * 5, max = Math.ceil(Math.max(...ys) / 5) * 5 || 1;
  const x = i => L + (W - L - 10) * (points.length === 1 ? .5 : i / (points.length - 1));
  const y = v => T + (H - T - B) * (1 - (v - min) / Math.max(1, max - min));
  const ticks = []; for (let v = min; v <= max; v += Math.max(5, Math.round((max - min) / 5 / 5) * 5)) ticks.push(v);
  const roll = rolling ? points.map((_, i) => avg(points.slice(Math.max(0, i - rolling + 1), i + 1).map(p => p.y))) : [];
  const years = []; points.forEach((p, i) => { const yr = p.date?.slice(0, 4); if (yr && (i === 0 || points[i - 1].date.slice(0, 4) !== yr) && (!years.length || x(i) - x(years.at(-1)[0]) > 34)) years.push([i, yr]); });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(yLabel)}">
    ${ticks.map(v => `<line class="grid" x1="${L}" x2="${W - 10}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
    ${years.map(([i, yr]) => `<text x="${x(i)}" y="${H - 6}">${yr}</text>`).join("")}
    ${rolling ? `<polyline fill="none" stroke="var(--brand2)" stroke-width="2.5" points="${roll.map((v, i) => `${x(i)},${y(v)}`).join(" ")}"/>` : ""}
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.y)}" r="${points.length > 300 ? 2.2 : 3.5}" fill="${p.color || "var(--birdie)"}" opacity=".75" ${p.tip ? tipAttr(p.tip) : ""}/>`).join("")}
  </svg>`;
}
function stackedBars(groups, keys, colors, { height = 260, labels = {} } = {}) {
  if (!groups.length) return `<p class="muted">Nothing to show.</p>`;
  const W = 900, H = height, L = 40, B = 34, T = 8;
  const max = Math.max(...groups.map(g => keys.reduce((s, k) => s + (g.values[k] || 0), 0))) || 1;
  const bw = (W - L - 10) / groups.length;
  const y = v => (H - T - B) * v / max;
  const every = Math.ceil(groups.length / 24);
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">
    ${[0, .25, .5, .75, 1].map(f => `<line class="grid" x1="${L}" x2="${W - 10}" y1="${T + (H - T - B) * (1 - f)}" y2="${T + (H - T - B) * (1 - f)}"/><text x="${L - 6}" y="${T + (H - T - B) * (1 - f) + 4}" text-anchor="end">${Math.round(max * f)}</text>`).join("")}
    ${groups.map((g, i) => { let acc = 0; return keys.map(k => { const v = g.values[k] || 0; if (!v) return ""; const h = y(v); acc += h; return `<rect x="${L + i * bw + 1}" y="${H - B - acc}" width="${Math.max(1, bw - 2)}" height="${h}" fill="${colors[k] || "var(--brand2)"}" ${tipAttr(`<b>${esc(g.label)}</b><br>${esc(labels[k] || k)}: ${v}${g.tip ? `<br>${g.tip}` : ""}`)}/>`; }).join("") + (i % every === 0 ? `<text x="${L + i * bw + bw / 2}" y="${H - B + 14}" text-anchor="middle">${esc(g.short ?? g.label)}</text>` : ""); }).join("")}
  </svg>`;
}
function hbars(rows, { color = "var(--brand2)", fmtv = v => v } = {}) {
  const max = Math.max(...rows.map(r => r.v), 1);
  return `<div class="bars">${rows.map(r => `<div class="bar"><span>${esc(r.label)}</span><div class="track"><div class="fill" style="width:${100 * r.v / max}%;background:${r.color || color}"></div></div><span class="num">${r.note ?? fmtv(r.v)}</span></div>`).join("")}</div>`;
}
function heatTable(rows, cols, cell, { first = "", firstCells = r => r.label } = {}) {
  const all = rows.flatMap(r => cols.map(c => cell(r, c)).filter(Number.isFinite)); const max = Math.max(...all, 1);
  return `<div class="scroll"><table class="data heat"><thead><tr><th>${esc(first)}</th>${cols.map(c => `<th class="n">${esc(LABEL[c] || c)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr><td>${firstCells(r)}</td>${cols.map(c => { const v = cell(r, c); const a = Number.isFinite(v) && v ? .12 + .7 * v / max : 0; return `<td class="h" style="background:rgba(47,98,201,${a.toFixed(2)});color:${a > .5 ? "#fff" : "inherit"}">${v || ""}</td>`; }).join("")}</tr>`).join("")}</tbody></table></div>`;
}
const card = (title, explain, body) => `<section class="card"><h2>${esc(title)}</h2>${explain ? `<p class="explain">${explain}</p>` : ""}${body}</section>`;
const legend = keys => `<div class="legend">${keys.map(k => `<span><i style="background:${COLORS[k]}"></i>${LABEL[k]}</span>`).join("")}</div>`;

// ---------- views ----------
function overview() {
  const rounds = filteredRounds(), holes = holesOf(rounds), full = rounds.filter(r => r.full);
  const best = full.reduce((b, r) => (!b || r.score < b.score ? r : b), null);
  const acc = accuracy(holes);
  const byPar = [3, 4, 5].map(p => { const hs = holes.filter(h => h.par === p); return { label: `Par ${p}s`, v: avg(hs.map(h => h.score)), n: hs.length, over: avg(hs.map(h => h.diff)) }; });
  const counts = resultCounts(holes);
  const now = Date.now();
  const windows = [["Forever", 0], ["This year", -1], ["Last 6 months", 182], ["Last 30 days", 30]].map(([label, days]) => {
    const rs = rounds.filter(r => days === 0 || (days === -1 ? r.year === new Date().getFullYear() : r.date >= new Date(now - days * 86400000).toISOString().slice(0, 10)));
    const hs = holesOf(rs), fr = rs.filter(r => r.full), a = accuracy(hs);
    return `<tr><td>${label}</td><td class="n">${rs.length}</td><td class="n">${fmt(avg(fr.map(r => r.score)))}</td><td class="n">${fr.length ? Math.min(...fr.map(r => r.score)) : "–"}</td><td class="n">${fmt(avg(hs.map(h => h.diff)), 2)}</td><td class="n">${pct(a.fir, a.firN)}</td><td class="n">${pct(a.gir, a.girN)}</td></tr>`;
  }).join("");
  const pts = full.map(r => ({ y: r.score, date: r.date, color: "var(--birdie)", tip: scorecard(r) }));
  const fl = flow(holes);
  const birdied = mostBirdied(holes);
  return `<div class="kpis">
      ${kpi(rounds.length.toLocaleString(), "rounds")}${kpi(holes.length.toLocaleString(), "holes played")}${kpi(fmt(avg(full.map(r => r.score))), "average 18-hole score")}
      ${kpi(best ? best.score : "–", best ? `best 18 · ${esc(best.player)} ${fmtDate(best.date)}` : "best 18")}${kpi(fmt(avg(holes.map(h => h.diff)), 2), "strokes over par per hole")}
      ${kpi(pct(acc.fir, acc.firN), "fairways hit")}${kpi(pct(acc.gir, acc.girN), "greens in regulation")}${kpi((holes.reduce((s, h) => s + (h.yards || 0), 0) / 1760).toFixed(0), "miles played")}
    </div>
    ${card("Scoring trend", "Every full 18-hole round, with a 10-round average line. Hover a dot for the scorecard and who you played with.", lineChart(pts, { rolling: 10, yLabel: "18-hole scores" }))}
    <div class="two">
      ${card("How the holes finish", "Share of all holes by result.", hbars(RESULTS.map(k => ({ label: LABEL[k], v: counts[k], color: COLORS[k], note: `${counts[k].toLocaleString()} · ${pct(counts[k], holes.length)}` }))))}
      ${card("Average by par", "Average strokes on par 3s, 4s and 5s (and strokes over par).", hbars(byPar.map(b => ({ label: b.label, v: b.v || 0, note: `${fmt(b.v, 2)} (+${fmt(b.over, 2)}) · ${b.n}` }))))}
    </div>
    ${card("Are you improving?", "The same numbers over different stretches. Average and best only count full 18-hole rounds.", `<div class="scroll"><table class="data"><thead><tr><th>Stretch</th><th class="n">Rounds</th><th class="n">Avg 18</th><th class="n">Best 18</th><th class="n">Over par / hole</th><th class="n">FIR</th><th class="n">GIR</th></tr></thead><tbody>${windows}</tbody></table></div>`)}
    <div class="two">
      ${card("After the fairway and green", "What happens next: how often each fairway/green combination ends in birdie, par, bogey or worse. Par 4s and 5s with tracking only.", fl)}
      ${card("Most birdied holes", "Holes with the most birdies or better.", birdied)}
    </div>`;
}
const kpi = (v, l) => `<div class="kpi"><div class="v">${v}</div><div class="l">${l}</div></div>`;
function flow(holes) {
  const tracked = holes.filter(h => h.fir != null && h.green != null && h.par > 3);
  if (!tracked.length) return `<p class="muted">No tracked fairways and greens for these filters (tracking started Oct 2020).</p>`;
  const groups = [["Fairway + green", h => h.fir && h.green !== "miss"], ["Fairway, missed green", h => h.fir && h.green === "miss"], ["Missed fairway, hit green", h => !h.fir && h.green !== "miss"], ["Missed both", h => !h.fir && h.green === "miss"]];
  return `<div class="scroll"><table class="data flow"><thead><tr><th>Tee shot → approach</th><th>Holes</th>${["birdie", "par", "bogey", "double"].map(k => `<th>${k === "double" ? "Double+" : LABEL[k]}${k === "birdie" ? "+" : ""}</th>`).join("")}</tr></thead><tbody>${groups.map(([label, f]) => {
    const hs = tracked.filter(f), c = resultCounts(hs);
    return `<tr><td style="text-align:left">${label}</td><td>${hs.length}</td><td>${pct(c.eagle + c.birdie, hs.length)}</td><td>${pct(c.par, hs.length)}</td><td>${pct(c.bogey, hs.length)}</td><td>${pct(c.double + c.triple, hs.length)}</td></tr>`;
  }).join("")}</tbody></table></div>`;
}
function mostBirdied(holes) {
  const m = new Map(); for (const h of holes.filter(h => h.diff < 0)) { const k = `${h.round.course}|${h.hole}`; m.set(k, (m.get(k) || 0) + 1); }
  const rows = [...m].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => { const [c, hole] = k.split("|"); return { label: `${c} #${hole}`, v }; });
  return rows.length ? hbars(rows, { color: COLORS.birdie }) : `<p class="muted">No birdies yet for these filters.</p>`;
}

let roundSort = "date";
function roundsView() {
  const rounds = filteredRounds().slice().sort((a, b) => roundSort === "score" ? (b.full - a.full) || a.score - b.score : b.date.localeCompare(a.date) || a.score - b.score);
  const recent = rounds.filter(r => r.full).slice(0, 16).reverse();
  return `${card("Results by round", "The latest 16 full rounds for these filters, split by result. Hover for the card.", legend(RESULTS) + stackedBars(recent.map(r => ({ label: `${r.player} ${fmtDate(r.date)}`, short: r.date.slice(5), values: resultCounts(r.holes), tip: `${esc(r.course)} · ${r.score}` })), RESULTS, COLORS, { labels: LABEL }))}
    ${card("Scores by date", `${rounds.length} rounds. Click a row for the scorecard, fairways/greens and who played that day.`, `<div class="row seg" style="margin-bottom:8px"><button type="button" data-sort="date" aria-pressed="${roundSort === "date"}">Newest first</button><button type="button" data-sort="score" aria-pressed="${roundSort === "score"}">Lowest score</button></div>
      <div class="scroll"><table class="data"><thead><tr><th>Date</th><th>Golfer</th><th>Course</th><th>Tees</th><th class="n">Holes</th><th class="n">Score</th><th class="n">Par</th><th class="n">+/-</th>${RESULTS.map(k => `<th class="n">${LABEL[k]}</th>`).join("")}</tr></thead><tbody>
      ${rounds.slice(0, 600).map(r => { const c = resultCounts(r.holes); return `<tr class="clickable" data-round="${r.id}"><td>${r.date}</td><td>${esc(r.player)}</td><td>${esc(r.course)}</td><td>${esc(r.tees)}</td><td class="n">${r.count}</td><td class="n"><b>${r.score}</b></td><td class="n">${r.par}</td><td class="n">${toPar(r.score - r.par)}</td>${RESULTS.map(k => `<td class="n">${c[k] || ""}</td>`).join("")}</tr>`; }).join("")}
      </tbody></table></div>${rounds.length > 600 ? `<p class="muted">Showing 600 of ${rounds.length}. Narrow the filters to see more.</p>` : ""}`)}`;
}
document.addEventListener("click", e => {
  const s = e.target.closest("[data-sort]"); if (s) { roundSort = s.dataset.sort; render(); return; }
  const row = e.target.closest("tr[data-round]"); if (!row) return;
  if (row.nextElementSibling?.classList.contains("expand")) { row.nextElementSibling.remove(); return; }
  const r = D.rounds.find(x => x.id === row.dataset.round);
  row.insertAdjacentHTML("afterend", `<tr class="expand"><td colspan="20">${scorecard(r)}</td></tr>`);
});

function bestView() {
  const full = filteredRounds().filter(r => r.full).sort((a, b) => a.score - b.score || a.date.localeCompare(b.date)).slice(0, 100);
  const nines = filteredRounds().filter(r => r.count === 9).sort((a, b) => a.score - b.score).slice(0, 25);
  const table = rs => `<div class="scroll"><table class="data"><thead><tr><th class="n">Score</th><th class="n">Par</th><th>Golfer</th><th>Date</th><th>Course</th><th>Tees</th><th>How</th></tr></thead><tbody>${rs.map(r => `<tr class="clickable" data-round="${r.id}" ${tipAttr(scorecard(r))}><td class="n"><b>${r.score}</b></td><td class="n">${r.par}</td><td>${esc(r.player)}</td><td>${r.date}</td><td>${esc(r.course)}</td><td>${esc(r.tees)}</td><td>${esc(summaryText(r))}</td></tr>`).join("")}</tbody></table></div>`;
  const perPlayer = new Map(); for (const r of filteredRounds().filter(r => r.full)) { const b = perPlayer.get(r.player); if (!b || r.score < b.score) perPlayer.set(r.player, r); }
  return `${card("Best 18-hole scores", "Lowest full rounds. Hover for the scorecard; click to open it.", table(full))}
    <div class="two">${card("Personal bests", "Each golfer's lowest 18.", `<div class="scroll"><table class="data"><tbody>${[...perPlayer.values()].sort((a, b) => a.score - b.score).map(r => `<tr class="clickable" data-round="${r.id}"><td>${esc(r.player)}</td><td class="n"><b>${r.score}</b></td><td>${r.date}</td><td>${esc(r.course)}</td></tr>`).join("")}</tbody></table></div>`)}
    ${card("Best 9-hole rounds", "Rounds of exactly 9 holes.", table(nines))}</div>`;
}

function courseView() {
  const rounds = filteredRounds({ ignoreCourse: true });
  const courseCounts = new Map(); for (const r of rounds) courseCounts.set(r.course, (courseCounts.get(r.course) || 0) + 1);
  const pick = state.course && D.layouts.has(state.course) ? state.course : [...courseCounts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const compare = [...new Set(rounds.map(r => r.course))].map(c => { const hs = holesOf(rounds.filter(r => r.course === c)); return { c, n: hs.length, rounds: rounds.filter(r => r.course === c).length, over: avg(hs.map(h => h.diff)), acc: accuracy(hs) }; }).filter(x => x.n >= 18).sort((a, b) => a.over - b.over);
  if (!pick) return card("Course", "", `<p class="muted">No rounds for these filters.</p>`);
  const cr = rounds.filter(r => r.course === pick), holes = holesOf(cr);
  const holeRows = [...new Set(holes.map(h => h.hole))].sort((a, b) => a - b).map(n => { const hs = holes.filter(h => h.hole === n); return { label: n, hole: n, par: Math.round(avg(hs.map(h => h.par))), hs, c: resultCounts(hs), over: avg(hs.map(h => h.diff)), yards: hs[0]?.yards, hcp: hs[0]?.handicap }; });
  const ranked = holeRows.slice().sort((a, b) => b.over - a.over);
  const who = [...new Set(cr.map(r => r.player))].map(p => { const rs = cr.filter(r => r.player === p); const hs = holesOf(rs); return { p, n: rs.length, over: avg(hs.map(h => h.diff)), best: Math.min(...rs.filter(r => r.full).map(r => r.score)) }; }).filter(x => x.n >= 2).sort((a, b) => a.over - b.over).slice(0, 15);
  const acc = accuracy(holes);
  const dates = cr.slice().sort((a, b) => b.date.localeCompare(a.date));
  return `${card(`${pick}`, `${cr.length} rounds · ${holes.length} holes · ${fmt(avg(holes.map(h => h.diff)), 2)} over par per hole · FIR ${pct(acc.fir, acc.firN)} · GIR ${pct(acc.gir, acc.girN)}${acc.sgir ? ` · ${acc.sgir} super greens` : ""}. Pick a course in the Course filter above.`,
      heatTable(holeRows, RESULTS, (r, k) => r.c[k], { first: "Hole · par · yds", firstCells: r => `<b>${r.hole}</b> <span class="muted">par ${r.par}${r.yards ? ` · ${r.yards}` : ""}${r.hcp ? ` · hcp ${r.hcp}` : ""}</span>` }))}
    <div class="two">
      ${card("Hole difficulty", "Average strokes over par on each hole, hardest first.", hbars(ranked.map(r => ({ label: `#${r.hole} (par ${r.par})`, v: Math.max(0, r.over), note: `+${fmt(r.over, 2)}`, color: r.over > 1.2 ? COLORS.double : r.over > .8 ? COLORS.bogey : "#7f9c8a" }))))}
      ${card("Who plays it best", "Lowest strokes over par per hole here (2+ rounds).", `<table class="data"><thead><tr><th>Golfer</th><th class="n">Rounds</th><th class="n">Over/hole</th><th class="n">Best 18</th></tr></thead><tbody>${who.map(w => `<tr><td>${esc(w.p)}</td><td class="n">${w.n}</td><td class="n">${fmt(w.over, 2)}</td><td class="n">${Number.isFinite(w.best) ? w.best : "–"}</td></tr>`).join("")}</tbody></table>`)}
    </div>
    ${card("Every visit", "Dates and tees played here. Click for the card.", `<div class="scroll" style="max-height:320px"><table class="data"><tbody>${dates.map(r => `<tr class="clickable" data-round="${r.id}"><td>${r.date}</td><td>${esc(r.player)}</td><td>${esc(r.tees)}</td><td class="n">${r.score}${r.count < 18 ? ` (${r.count})` : ""}</td></tr>`).join("")}</tbody></table></div>`)}
    ${card("Course comparison", "Strokes over par per hole at every course (18+ holes). Easiest first.", `<div class="scroll"><table class="data"><thead><tr><th>Course</th><th class="n">Rounds</th><th class="n">Holes</th><th class="n">Over/hole</th><th class="n">FIR</th><th class="n">GIR</th></tr></thead><tbody>${compare.map(x => `<tr><td>${esc(x.c)}</td><td class="n">${x.rounds}</td><td class="n">${x.n}</td><td class="n">${fmt(x.over, 2)}</td><td class="n">${pct(x.acc.fir, x.acc.firN)}</td><td class="n">${pct(x.acc.gir, x.acc.girN)}</td></tr>`).join("")}</tbody></table></div>`)}
    ${notebook()}`;
}
function notebook() {
  const rank = D.references?.course_rank || [];
  if (!rank.length) return "";
  const cols = Object.keys(rank[0]).filter(k => k);
  return card("Jim's course notebook", "Jim's course rankings, prices and notes.", `<div class="scroll"><table class="data"><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rank.filter(r => r.course).map(r => `<tr>${cols.map(c => `<td>${/^https?:/.test(r[c] || "") ? `<a href="${esc(r[c])}" target="_blank" rel="noopener">link</a>` : esc(r[c])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
}

function holesView() {
  const holes = holesOf(filteredRounds());
  const byNumber = Array.from({ length: 18 }, (_, i) => ({ label: i + 1, c: resultCounts(holes.filter(h => h.hole === i + 1)) }));
  const byHcp = Array.from({ length: 18 }, (_, i) => { const hs = holes.filter(h => h.handicap === i + 1); return { label: `${i + 1}`, hs, over: avg(hs.map(h => h.diff)), c: resultCounts(hs) }; }).filter(x => x.hs.length);
  const great = holes.filter(h => h.diff < 0).sort((a, b) => a.diff - b.diff || b.round.date.localeCompare(a.round.date));
  return `<div class="two">${card("By hole number", "Results on holes 1–18 across every course.", heatTable(byNumber, RESULTS, (r, k) => r.c[k], { first: "Hole" }))}
      ${card("By hole handicap", "Average over par by the hole's handicap (1 = hardest on the card). Is the card right?", hbars(byHcp.map(r => ({ label: `Hcp ${r.label}`, v: Math.max(0, r.over), note: `+${fmt(r.over, 2)} · ${r.hs.length}` }))))}</div>
    ${card("Best holes", `Every eagle and birdie for these filters (${great.length}). Fairway/green marks shown where tracked.`, `<div class="scroll"><table class="data"><thead><tr><th>Result</th><th class="n">Score</th><th>Golfer</th><th>Date</th><th>Course</th><th class="n">Hole</th><th class="n">Par</th><th class="n">Yds</th><th class="n">Hcp</th><th>Tees</th><th>F/G</th></tr></thead><tbody>${great.slice(0, 800).map(h => `<tr class="clickable" data-round="${h.round.id}"><td><span class="pill r-${resultName(h.diff)}">${resultName(h.diff)}</span></td><td class="n">${h.score}</td><td>${esc(h.round.player)}</td><td>${h.round.date}</td><td>${esc(h.round.course)}</td><td class="n">${h.hole}</td><td class="n">${h.par}</td><td class="n">${h.yards || ""}</td><td class="n">${h.handicap || ""}</td><td>${esc(h.tees)}</td><td>${h.fir ? "F" : ""}${h.green === "gir" ? "G" : h.green === "sgir" ? "SG" : ""}</td></tr>`).join("")}</tbody></table></div>`)}`;
}

function yearsView() {
  const rounds = filteredRounds(), years = [...new Set(rounds.map(r => r.year))].sort();
  const series = years.map(y => ({ label: String(y), values: resultCounts(holesOf(rounds.filter(r => r.year === y))) }));
  const table = [...new Set(rounds.map(r => r.player))].flatMap(p => years.map(y => { const rs = rounds.filter(r => r.player === p && r.year === y); if (!rs.length) return null; const hs = holesOf(rs), c = resultCounts(hs), full = rs.filter(r => r.full); return { p, y, hs: hs.length, days: new Set(rs.map(r => r.date)).size, rounds: rs.length, per18: hs.length / 18, miles: hs.reduce((s, h) => s + (h.yards || 0), 0) / 1760, avg: avg(full.map(r => r.score)), c, sum: hs.reduce((s, h) => s + h.score, 0) }; }).filter(Boolean)).sort((a, b) => b.hs - a.hs || b.y - a.y);
  const months = new Map();
  for (const r of rounds) { const m = r.date.slice(0, 7); if (!months.has(m)) months.set(m, {}); const v = months.get(m); v[r.player] = (v[r.player] || 0) + r.count; }
  const topPlayers = [...new Set(rounds.map(r => r.player))].map(p => [p, rounds.filter(r => r.player === p).length]).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([p]) => p);
  const palette = ["#2f62c9", "#e7893b", "#1f6b45", "#8e5bd0", "#d14f6e", "#0f8b8d", "#c9a227", "#6b7a72"];
  const pc = Object.fromEntries([...topPlayers, "Others"].map((p, i) => [p, palette[i] || "#9aa79f"]));
  const monthGroups = [...months].sort().map(([m, v]) => { const values = {}; for (const [p, n] of Object.entries(v)) { const k = topPlayers.includes(p) ? p : "Others"; values[k] = (values[k] || 0) + n; } return { label: m, short: m.slice(5) === "01" ? m.slice(0, 4) : "", values }; });
  return `${card("Results by year", "Count of each result per year.", legend(RESULTS) + stackedBars(series.map(s => ({ ...s, tip: `${RESULTS.map(k => `${LABEL[k]} ${pct(s.values[k], RESULTS.reduce((t, x) => t + s.values[x], 0))}`).join("<br>")}` })), RESULTS, COLORS, { labels: LABEL }))}
    ${card("Season by season", "Each golfer's year: holes, days, rounds, miles and results. Avg counts full rounds only.", `<div class="scroll"><table class="data"><thead><tr><th>Golfer</th><th>Year</th><th class="n">Holes</th><th class="n">Days</th><th class="n">Rounds</th><th class="n">Holes/18</th><th class="n">Miles</th><th class="n">Avg 18</th><th class="n">Strokes</th>${RESULTS.map(k => `<th class="n">${LABEL[k]}</th>`).join("")}</tr></thead><tbody>${table.map(t => `<tr><td>${esc(t.p)}</td><td>${t.y}</td><td class="n">${t.hs}</td><td class="n">${t.days}</td><td class="n">${t.rounds}</td><td class="n">${fmt(t.per18, 2)}</td><td class="n">${fmt(t.miles, 1)}</td><td class="n">${fmt(t.avg)}</td><td class="n">${t.sum.toLocaleString()}</td>${RESULTS.map(k => `<td class="n">${t.c[k] || ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`)}
    ${card("Holes by month", "Holes played each month, by golfer (top 8, the rest grouped).", `<div class="legend">${Object.entries(pc).map(([p, c]) => `<span><i style="background:${c}"></i>${esc(p)}</span>`).join("")}</div>` + stackedBars(monthGroups, Object.keys(pc), pc, { height: 300 }))}`;
}

let partnerWindow = "all";
function golfersView() {
  const rounds = filteredRounds({ ignorePlayer: true });
  const players = [...new Set(rounds.map(r => r.player))].map(p => { const rs = rounds.filter(r => r.player === p); const hs = holesOf(rs); const withJim = p === "Jim" ? null : rs.filter(r => partnersOf(r).some(x => x.player === "Jim")).length; return { p, hs: hs.length, rounds: rs.length, miles: hs.reduce((s, h) => s + (h.yards || 0), 0) / 1760, first: rs.reduce((m, r) => r.date < m ? r.date : m, "9999"), last: rs.reduce((m, r) => r.date > m ? r.date : m, ""), withJim, acc: accuracy(hs), birdies: hs.filter(h => h.diff < 0).length }; }).sort((a, b) => b.hs - a.hs);
  const me = state.player || "Jim";
  const cutoff = partnerWindow === "year" ? `${new Date().getFullYear()}-01-01` : partnerWindow === "12m" ? new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10) : "";
  const mine = D.rounds.filter(r => r.player === me && (!cutoff || r.date >= cutoff) && (partnerWindow !== "fri" || new Date(`${r.date}T12:00`).getDay() === 5));
  const partners = new Map(); for (const r of mine) for (const x of partnersOf(r)) partners.set(x.player, (partners.get(x.player) || 0) + 1);
  return `${card("Miles played", "Every golfer: holes, rounds and miles walked (or ridden), first and last round, and rounds with Jim.", `<div class="scroll"><table class="data"><thead><tr><th>Golfer</th><th class="n">Holes</th><th class="n">Rounds</th><th class="n">Miles</th><th>First golfed</th><th>Last golfed</th><th class="n">With Jim</th><th class="n">Birdies+</th><th class="n">FIR</th><th class="n">GIR</th></tr></thead><tbody>${players.map(x => `<tr><td>${esc(x.p)}</td><td class="n">${x.hs.toLocaleString()}</td><td class="n">${x.rounds}</td><td class="n">${fmt(x.miles, 1)}</td><td>${x.first}</td><td>${x.last}</td><td class="n">${x.withJim ?? ""}</td><td class="n">${x.birdies}</td><td class="n">${pct(x.acc.fir, x.acc.firN)}</td><td class="n">${pct(x.acc.gir, x.acc.girN)}</td></tr>`).join("")}</tbody></table></div>`)}
    ${card(`Who ${esc(me)} plays with most`, "Rounds on the same day at the same course. Pick a golfer in the filter above to see theirs.", `<div class="seg" style="margin-bottom:10px">${[["all", "Forever"], ["year", "This year"], ["12m", "Last 12 months"], ["fri", "On Fridays"]].map(([k, l]) => `<button type="button" data-pw="${k}" aria-pressed="${partnerWindow === k}">${l}</button>`).join("")}</div>${hbars([...partners].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([p, n]) => ({ label: p, v: n })))}`)}`;
}
document.addEventListener("click", e => { const b = e.target.closest("[data-pw]"); if (b) { partnerWindow = b.dataset.pw; render(); } });

let map;
function mapView() {
  setTimeout(drawMap, 0);
  return card("Courses played", "Every course with coordinates, sized by rounds for these filters. Tap a pin for dates, tees and best scores.", `<div id="map"></div>`);
}
function drawMap() {
  const el = $("#map"); if (!el || !window.L) return;
  if (map) { map.remove(); map = null; }
  map = L.map(el, { scrollWheelZoom: false });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
  const rounds = filteredRounds({ ignoreCourse: true });
  const byCourse = new Map(); for (const r of rounds) { if (!byCourse.has(r.course)) byCourse.set(r.course, []); byCourse.get(r.course).push(r); }
  const pts = [];
  for (const [course, rs] of byCourse) {
    const info = D.courseInfo.get(course); const lat = Number(info?.Latitude), lon = Number(info?.Longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    pts.push([lat, lon]);
    const best = rs.filter(r => r.full).sort((a, b) => a.score - b.score)[0];
    const dates = [...new Set(rs.map(r => r.date))].sort().reverse();
    L.circleMarker([lat, lon], { radius: Math.min(18, 5 + Math.sqrt(rs.length) * 1.4), color: "#15392a", weight: 1, fillColor: "#2f62c9", fillOpacity: .7 })
      .bindPopup(`<b>${esc(course)}</b><br>${esc(info.City || "")}${info.State ? `, ${esc(info.State)}` : ""}<br>${rs.length} rounds on ${dates.length} days · tees ${esc([...new Set(rs.map(r => r.tees))].join(", "))}${best ? `<br>Best 18: ${best.score} (${esc(best.player)}, ${best.date})` : ""}<br><span style="font-size:11px">${dates.slice(0, 8).join(", ")}${dates.length > 8 ? "…" : ""}</span>`).addTo(map);
  }
  if (pts.length) map.fitBounds(pts, { padding: [24, 24], maxZoom: 11 }); else map.setView([37.55, -77.45], 9);
}

function trophiesView() {
  const majors = (D.references?.majors || []).filter(m => m.date).sort((a, b) => b.date.localeCompare(a.date));
  const wins = new Map(); for (const m of majors) if (m.champion) wins.set(m.champion, (wins.get(m.champion) || 0) + 1);
  const keys = ["big dog", "white tees", "closest to the pin", "longest drive", "chip challenge", "putt challenge"];
  return `${card("Champions", "Majors won.", hbars([...wins].sort((a, b) => b[1] - a[1]).map(([p, n]) => ({ label: p, v: n }))))}
    <div class="trophies">${majors.map(m => `<article class="trophy"><div class="muted">${fmtDate(m.date)} · ${esc(m.complex)}</div><h3>${esc(m.major)}</h3><div>🏆 ${esc(m.champion || "Champion not recorded")}</div><dl>${keys.filter(k => m[k]).map(k => `<dt>${esc(k)}</dt><dd>${esc(m[k])}</dd>`).join("")}</dl></article>`).join("")}</div>`;
}

// WHS-style estimate where a published rating exists for the course + tees; otherwise a strokes-over-par benchmark.
function handicapsView() {
  const ratings = new Map((D.ratings || []).map(r => [`${r.course}|${r.tees}|${r.gender}`, r]));
  const players = [...new Set(D.rounds.map(r => r.player))];
  const rows = players.map(p => {
    const full = D.rounds.filter(r => r.player === p && r.full && !r.tees.includes("/")).sort((a, b) => b.date.localeCompare(a.date));
    if (full.length < 3) return null;
    const cat = D.ratingCategories?.[p] || "M";
    const diffs = full.slice(0, 20).map(r => { const rt = ratings.get(`${r.course}|${r.holes[0].tees}|${cat}`); return rt ? (113 / rt.slope) * (adjusted(r) - rt.rating) : null; });
    const rated = diffs.filter(d => d != null);
    const n = rated.length; const use = n >= 20 ? 8 : n >= 19 ? 7 : n >= 17 ? 6 : n >= 15 ? 5 : n >= 12 ? 4 : n >= 9 ? 3 : n >= 7 ? 2 : n >= 3 ? 1 : 0;
    const index = use ? avg(rated.sort((a, b) => a - b).slice(0, use)) : null;
    const bench = avg(full.slice(0, 20).map(r => r.score - r.par));
    return { p, n: full.length, rated: n, index, bench, last: full[0].date };
  }).filter(Boolean).sort((a, b) => (a.index ?? 99) - (b.index ?? 99) || a.bench - b.bench);
  return card("Handicaps", "Estimated index uses the official USGA course rating and slope where we have one for that course and tees (best differentials of the last 20 rated rounds, scores capped at double bogey per hole as an approximation of net double bogey). Rounds on courses without a matched rating are left out. The benchmark is simply average strokes over par in the last 20 full rounds. Neither is an official GHIN handicap.",
    `<div class="scroll"><table class="data"><thead><tr><th>Golfer</th><th class="n">Est. index</th><th class="n">Rated rounds (of last 20)</th><th class="n">Over par (last 20)</th><th class="n">Full rounds</th><th>Last round</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.p)}</td><td class="n"><b>${r.index == null ? "–" : fmt(r.index)}</b></td><td class="n">${r.rated}</td><td class="n">+${fmt(r.bench)}</td><td class="n">${r.n}</td><td>${r.last}</td></tr>`).join("")}</tbody></table></div>${(D.ratings || []).length ? "" : `<p class="notice">Course ratings are still being matched to your courses and tees, so only the benchmark shows for now.</p>`}`);
}
const adjusted = r => r.holes.reduce((s, h) => s + Math.min(h.score, h.par + 2), 0);

// ---------- shell ----------
function render() {
  tipStore.clear(); tipN = 0;
  document.querySelectorAll(".view-tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.view === state.view)));
  const fn = { overview, rounds: roundsView, best: bestView, course: courseView, holes: holesView, years: yearsView, golfers: golfersView, map: mapView, trophies: trophiesView, handicaps: handicapsView }[state.view] || overview;
  $("#view").innerHTML = fn();
}
function shell() {
  $(".view-tabs").innerHTML = VIEWS.map(([k, l]) => `<button role="tab" type="button" data-view="${k}">${l}</button>`).join("");
  $(".view-tabs").addEventListener("click", e => { const b = e.target.closest("[data-view]"); if (!b) return; state.view = b.dataset.view; writeHash(); render(); });
}
addEventListener("hashchange", () => { readHash(); if (D) { fillFilters(); render(); } });
(async function start() {
  readHash(); shell();
  const cached = cachedData();
  if (cached) { D = expand(cached); fillFilters(); render(); }
  try {
    D = await loadData(); outings = null; fillFilters(); render();
    const last = D.rounds.reduce((m, r) => r.date > m ? r.date : m, "");
    $("#data-note").textContent = `${D.rounds.length.toLocaleString()} rounds · ${D.holes.length.toLocaleString()} holes · ${D.players.length} golfers · latest round ${last ? fmtDate(last) : "–"}${D.offline ? " · offline copy" : ""}`;
  } catch { if (!D) $("#view").innerHTML = `<p class="notice warn">Couldn't load the golf database. Check your connection and refresh.</p>`; }
})();

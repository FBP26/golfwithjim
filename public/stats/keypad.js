// Phone score keypad: light up Fairway / Green / GG, tap the result (eagle..triple), it saves the hole and moves on.
// Uses the same data, passcode and /rounds endpoint as enter.html. The whole card is kept on this device until it saves.
import { API, loadData, cachedData, expand, toPar, esc } from "./golf-data.js?v=20261118b";

const DRAFT_KEY = "golfKeypadDraft.v1";
const KEY_KEY = "golfEntryKey";
const $ = (s) => document.querySelector(s);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());
const NAMES = { "-3": "Albatross", "-2": "Eagle", "-1": "Birdie", 0: "Par", 1: "Bogey", 2: "Double", 3: "Triple" };
const RCLASS = (d) => (d <= -2 ? "r-eagle" : d === -1 ? "r-birdie" : d === 0 ? "r-par" : d === 1 ? "r-bogey" : d === 2 ? "r-double" : "r-triple");

let data = null;
let d = freshDraft();
const ui = { f: false, g: 0, toast: "", toastOk: false, toastWarn: false, sync: "", syncWarn: false };

function freshDraft() { return { date: todayIso(), course: "", tees: "", players: ["Jim"], started: false, cur: { p: 0, r: 0, hole: 1 }, golfers: {} }; }
function persist() { store.set(DRAFT_KEY, JSON.stringify(d)); }

// ---------- course data ----------
const layout = (course = d.course, tees = d.tees) => (data?.layouts.get(course)?.get(tees) || []).slice().sort((a, b) => a.hole - b.hole);
const teesFor = (course) => [...(data?.layouts.get(course)?.keys() || [])];
const meta = (hole) => layout().find((h) => h.hole === hole) || { hole, par: 4 };
const allHoles = () => layout().map((h) => h.hole);
const teeYards = (course, t) => layout(course, t).reduce((a, h) => a + (h.yards || 0), 0);
function rating(course, tees, player) {
  const gender = data?.ratingCategories?.[player] === "W" ? "W" : "M";
  const list = data?.ratings || [];
  return list.find((r) => r.course === course && r.tees === tees && r.gender === gender) || list.find((r) => r.course === course && r.tees === tees);
}
function recentCourses() {
  const last = new Map();
  for (const r of data?.rounds || []) if (!last.has(r.course) || last.get(r.course) < r.date) last.set(r.course, r.date);
  return [...(data?.layouts.keys() || [])].sort((a, b) => (last.get(b) || "").localeCompare(last.get(a) || "") || a.localeCompare(b));
}
function defaultTees(course) {
  const tees = teesFor(course);
  const mine = (data?.rounds || []).filter((r) => r.course === course && r.player === "Jim").at(-1)?.holes[0]?.tees;
  return tees.includes(mine) ? mine : tees.includes("White") ? "White" : tees[0] || "";
}
function usualPlayers() {
  if (!data) return ["Jim"];
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const days = new Set(data.rounds.filter((r) => r.player === "Jim" && r.date >= cutoff).map((r) => r.date + "|" + r.course));
  const counts = new Map();
  for (const r of data.rounds) if (r.player !== "Jim" && days.has(r.date + "|" + r.course)) counts.set(r.player, (counts.get(r.player) || 0) + 1);
  return ["Jim", ...[...counts].sort((a, b) => b[1] - a[1]).slice(0, 9).map(([p]) => p)];
}

// ---------- current golfer / round ----------
const golferName = () => d.players[d.cur.p];
const golfer = (name = golferName()) => d.golfers[name];
const round = () => golfer()?.rounds[d.cur.r];
const holesOf = (r) => r.holes;
function roundTotals(r) {
  let s = 0, p = 0, n = 0;
  for (const h of r.holes) { const e = r.scores[h]; if (e && e.v) { s += e.v; p += meta(h).par; n++; } }
  return { s, p, n };
}
function isDone(r) { return r.holes.every((h) => r.scores[h]); }
function nextOpen(r, from) { const i = r.holes.indexOf(from); for (let k = i + 1; k < r.holes.length; k++) if (!r.scores[r.holes[k]]) return r.holes[k]; return r.holes.find((h) => !r.scores[h]) ?? null; }
function loadToggles() { const e = round()?.scores[d.cur.hole]; ui.f = !!(e && e.f); ui.g = e?.g || 0; }

// ---------- setup screen ----------
function renderSetup() {
  $("#setup").hidden = false; $("#card").hidden = true;
  $("#date").value = d.date; $("#date").max = todayIso();
  const courses = recentCourses();
  $("#course-more").innerHTML = (d.course ? "" : `<option value="">Pick a course…</option>`) + courses.slice().sort((a, b) => a.localeCompare(b)).map((c) => `<option value="${esc(c)}" ${c === d.course ? "selected" : ""}>${esc(c)}</option>`).join("");
  const tees = teesFor(d.course).sort((a, b) => teeYards(d.course, b) - teeYards(d.course, a) || a.localeCompare(b));
  $("#tee-chips").innerHTML = tees.length ? tees.map((t) => {
    const holes = layout(d.course, t); const yds = teeYards(d.course, t); const rt = rating(d.course, t, "Jim");
    return `<button type="button" data-tee="${esc(t)}" aria-pressed="${t === d.tees}"><b>${esc(t)}</b><small>${yds ? yds.toLocaleString("en-US") + " yds" : holes.length + " holes"}</small><small>${rt ? rt.rating + " / " + rt.slope : "no rating"}</small></button>`;
  }).join("") : `<p class="hint">Pick a course first.</p>`;
  const usual = usualPlayers();
  const chips = [...new Set([...usual, ...d.players])];
  $("#player-chips").innerHTML = chips.map((p) => `<button type="button" data-player="${esc(p)}" aria-pressed="${d.players.includes(p)}">${d.players.includes(p) ? "✓ " : ""}${esc(p)}</button>`).join("");
  $("#player-count").textContent = `(${d.players.length})`;
  renderSugg();
  const ready = d.course && d.tees && d.players.length && allHoles().length;
  $("#start").disabled = !ready;
  $("#start").textContent = ready ? `Start · ${d.players.length} player${d.players.length === 1 ? "" : "s"} · ${d.course}` : !d.course ? "Pick a course" : !d.players.length ? "Add a player" : "Pick tees";
  $("#setup-note").textContent = d.date > todayIso() ? "That date is in the future." : "";
}
$("#date").addEventListener("change", (e) => { d.date = e.target.value || todayIso(); persist(); renderSetup(); });
$("#course-more").addEventListener("change", (e) => { if (e.target.value) setCourse(e.target.value); });
function setCourse(c) { d.course = c; d.tees = defaultTees(c); persist(); renderSetup(); }
$("#tee-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-tee]"); if (!b) return; d.tees = b.dataset.tee; persist(); renderSetup(); });
$("#player-chips").addEventListener("click", (e) => { const b = e.target.closest("[data-player]"); if (!b) return; const p = b.dataset.player; d.players = d.players.includes(p) ? d.players.filter((x) => x !== p) : [...d.players, p]; persist(); renderSetup(); });
// Suggestions while typing a name: known players who start with (then contain) what's typed, not already on the card.
function suggestions() {
  const q = $("#player-add").value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!q) return [];
  const pool = (data?.players || []).filter((p) => !d.players.some((x) => x.toLowerCase() === p.toLowerCase()));
  const starts = pool.filter((p) => p.toLowerCase().startsWith(q) || p.toLowerCase().split(" ").some((w) => w.startsWith(q)));
  const has = pool.filter((p) => !starts.includes(p) && p.toLowerCase().includes(q));
  return [...starts.sort((a, b) => a.localeCompare(b)), ...has].slice(0, 6);
}
function renderSugg() {
  const q = $("#player-add").value.trim();
  const list = suggestions();
  const hi = (p) => { const i = p.toLowerCase().indexOf(q.toLowerCase()); return i < 0 ? esc(p) : esc(p.slice(0, i)) + "<b>" + esc(p.slice(i, i + q.length)) + "</b>" + esc(p.slice(i + q.length)); };
  $("#player-sugg").innerHTML = list.map((p) => `<button type="button" data-sugg="${esc(p)}">+ ${hi(p)}</button>`).join("");
}
$("#player-add").addEventListener("input", renderSugg);
$("#player-sugg").addEventListener("click", (e) => { const b = e.target.closest("[data-sugg]"); if (!b) return; $("#player-add").value = b.dataset.sugg; addPlayer(); $("#player-add").focus(); });
function addPlayer() {
  let raw = $("#player-add").value.trim().replace(/\s+/g, " ");
  if (!raw) return;
  const s = suggestions();
  if (s.length === 1 && !(data?.players || []).some((p) => p.toLowerCase() === raw.toLowerCase())) raw = s[0];
  const known = (data?.players || []).find((p) => p.toLowerCase() === raw.toLowerCase());
  const name = known || raw;
  if (!d.players.some((p) => p.toLowerCase() === name.toLowerCase())) d.players.push(name);
  $("#player-add").value = ""; persist(); renderSetup();
}
$("#player-add-btn").addEventListener("click", addPlayer);
$("#player-add").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addPlayer(); } });
function existingRounds(name) { return (data?.rounds || []).filter((r) => r.date === d.date && r.course === d.course && r.player.toLowerCase() === name.toLowerCase()).map((r) => r.roundNumber); }
$("#start").addEventListener("click", () => {
  const holes = allHoles();
  for (const name of d.players) {
    if (d.golfers[name]?.rounds?.length) continue;
    const base = Math.max(0, ...existingRounds(name));
    d.golfers[name] = { rounds: [{ id: uuid(), number: base + 1, holes, scores: {}, revision: null, saved: false }] };
  }
  for (const name of Object.keys(d.golfers)) if (!d.players.includes(name)) delete d.golfers[name];
  d.started = true; d.cur = { p: 0, r: 0, hole: holes[0] };
  ui.toast = base1Note(); persist(); loadToggles(); render();
});
function base1Note() {
  const extra = d.players.filter((n) => (d.golfers[n]?.rounds[0]?.number || 1) > 1);
  return extra.length ? `${extra.join(", ")} already ${extra.length === 1 ? "has" : "have"} a saved round here today, so this card is round ${d.golfers[extra[0]].rounds[0].number}.` : "";
}

// ---------- card screen ----------
function render() {
  $("#loading").hidden = true;
  if (!d.started || !data || !layout().length) return renderSetup();
  $("#setup").hidden = true; $("#card").hidden = false;
  const r = round(), name = golferName();
  if (!r) { d.cur = { p: 0, r: 0, hole: golfer(d.players[0]).rounds[0].holes[0] }; return render(); }
  const rt = rating(d.course, d.tees, name);
  $("#course-line").textContent = `${d.course} · ${d.tees}${rt ? " " + rt.rating + "/" + rt.slope : ""} · ${new Date(d.date + "T12:00").toLocaleDateString("en-US", { month: "numeric", day: "numeric" })}`;
  const t = roundTotals(r);
  $("#topar-line").textContent = `${name}${t.n ? ` ${t.s} (${toPar(t.s - t.p)}) thru ${t.n}` : ""}`;
  $("#who").innerHTML = d.players.map((p, i) => {
    const g = golfer(p); const rs = g?.rounds || []; const n = rs.reduce((a, x) => a + Object.keys(x.scores).length, 0);
    const withScores = rs.filter(hasScores); const allSaved = withScores.length && withScores.every((x) => x.saved);
    return `<button type="button" data-p="${i}" aria-pressed="${i === d.cur.p}">${esc(p)}${allSaved ? " ✓" : n ? " · " + n : ""}</button>`;
  }).join("");
  renderNines(r);
  const tl = $("#toast-line"); tl.textContent = ui.toast || "Light up Fairway, Green or GG (optional), then tap the score."; const warnOn = !!ui.toast && (ui.toast === ui.warnText || ui.toast.startsWith("Not saved")); tl.classList.toggle("ok", ui.toastOk && !warnOn); tl.classList.toggle("warn", warnOn);
  const sy = $("#sync"); sy.textContent = ui.sync; sy.classList.toggle("warn", ui.syncWarn);
  const done = isDone(r) && !ui.editing;
  $("#keys").hidden = done; $("#review").hidden = !done;
  if (done) renderReview(r); else renderKeys(r);
}
function renderNines(r) {
  const all = layout().map((h) => h.hole);
  const nines = [all.filter((h) => h <= 9), all.filter((h) => h >= 10)].filter((x) => x.length);
  const rows = nines.map((holes, ni) => {
    const pad = (arr, fill) => { const out = arr.slice(); while (out.length < 9) out.push(fill); return out; };
    const hs = holes.map(meta);
    const sumY = hs.reduce((a, h) => a + (h.yards || 0), 0), sumP = hs.reduce((a, h) => a + h.par, 0);
    let sub = 0, any = false, miss = false;
    const cells = pad(holes.map((h) => {
      const e = r.scores[h], par = meta(h).par, live = r.holes.includes(h);
      const cur = h === d.cur.hole && !(isDone(r) && !ui.editing);
      if (live && !e && r.holes.some((x) => holes.includes(x) && x !== h && r.scores[x] && !r.scores[x].skip)) miss = true;
      if (e?.skip) { miss = true; return `<button type="button" class="s skip ${cur ? "cur" : ""}" data-hole="${h}" aria-label="Hole ${h}, skipped"><b>–</b><small>skip</small></button>`; }
      if (e) { sub += e.v; any = true; return `<button type="button" class="s ${RCLASS(e.v - par)} ${cur ? "cur" : ""}" data-hole="${h}" aria-label="Hole ${h}, ${e.v}"><b>${e.v}</b><small>${marks(e)}</small></button>`; }
      return `<button type="button" class="s ${live ? "" : "off"} ${cur ? "cur" : ""}" data-hole="${live ? h : ""}" aria-label="Hole ${h}" ${live ? "" : "disabled"}><b></b><small></small></button>`;
    }), `<span></span>`);
    const head = pad(holes.map((h) => `<span class="h">${h}</span>`), `<span></span>`).join("");
    const yrow = pad(hs.map((h) => `<span class="n">${h.yards || ""}</span>`), `<span></span>`).join("");
    const crow = pad(hs.map((h) => `<span class="n">${h.handicap || ""}</span>`), `<span></span>`).join("");
    const prow = pad(hs.map((h) => `<span class="n par">${h.par}</span>`), `<span></span>`).join("");
    const label = ni === 0 && holes[0] <= 9 ? "OUT" : "IN";
    return `<div class="nine">
      <span class="h l">HOLE</span>${head}<span class="h">${label}</span>
      <span class="l">${esc(d.tees.toUpperCase().slice(0, 5))}</span>${yrow}<span class="n">${sumY || ""}</span>
      <span class="l">HCP</span>${crow}<span class="n"></span>
      <span class="l">PAR</span>${prow}<span class="n par">${sumP}</span>
      <span class="nm">${esc(golferName().slice(0, 6))}</span>${cells.join("")}<span class="t">${any ? sub + (miss ? "*" : "") : ""}</span>
    </div>`;
  });
  $("#nines").innerHTML = rows.join("");
}
const marks = (e) => [e.f ? "F" : "", e.g === 2 ? "GG" : e.g ? "G" : ""].filter(Boolean).join(" ");
function renderKeys(r) {
  const hole = d.cur.hole, m = meta(hole), par = m.par;
  $("#hole-title").textContent = `Hole ${hole}`;
  $("#hole-par").textContent = `Par ${par}`;
  $("#hole-meta").textContent = [m.yards ? m.yards + " yds" : "", m.handicap ? "Hcp " + m.handicap : ""].filter(Boolean).join(" · ");
  const rs = golfer().rounds;
  $("#round-tag").textContent = rs.length > 1 || r.number > 1 ? `Round ${r.number}` : "";
  const tog = [
    { k: "f", label: par === 3 ? "No fairway" : "Fairway", on: ui.f, off: par === 3 },
    { k: "g", label: "Green", on: ui.g === 1, off: false },
    { k: "gg", label: par === 3 ? "No GG" : "GG", on: ui.g === 2, off: par === 3 },
  ];
  $("#toggles").innerHTML = tog.map((t) => `<button type="button" data-tog="${t.k}" aria-pressed="${t.on}" ${t.off ? "disabled" : ""}>${t.label}</button>`).join("");
  $("#results").innerHTML = [-2, -1, 0, 1, 2, 3].map((dd) => {
    const v = par + dd; if (v < 1) return `<button type="button" disabled><b>–</b><span>${NAMES[dd]}</span></button>`;
    return `<button type="button" class="${RCLASS(dd)} ${dd === 0 ? "isPar" : ""}" data-score="${v}"><b>${v}</b><span>${v === 1 ? "Ace" : NAMES[dd]}</span></button>`;
  }).join("");
  const alb = par - 3;
  $("#albatross").disabled = alb < 1;
  $("#albatross").textContent = alb >= 1 ? `${alb === 1 ? "Ace" : "Albatross"} ${alb}` : "—";
  $("#albatross").dataset.score = alb >= 1 ? alb : "";
  $("#back").disabled = r.holes.indexOf(hole) <= 0;
}
$("#toggles").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tog]"); if (!b || b.disabled) return;
  const k = b.dataset.tog;
  if (k === "f") ui.f = !ui.f;
  if (k === "g") ui.g = ui.g === 1 ? 0 : 1;
  if (k === "gg") ui.g = ui.g === 2 ? 0 : 2;
  render();
});
function saveHole(rec) {
  const r = round(), hole = d.cur.hole, par = meta(hole).par;
  const wasEmpty = !r.scores[hole];
  r.scores[hole] = rec; r.saved = false;
  r.ver = (r.ver || 0) + 1;
  if (wasEmpty) ui.editing = false; // a new hole means still playing: keep moving forward
  ui.toastOk = true;
  const warn = rec.skip ? null : checksFor(r).find((c) => c.h === hole && !c.gap);
  ui.warnText = warn ? warn.text : "";
  ui.toast = warn ? warn.text : rec.skip ? `Hole ${hole} skipped.` : `Hole ${hole}: ${(rec.v === 1 ? "Ace" : NAMES[rec.v - par]) || rec.v} ${rec.v}${marks(rec) ? " · " + marks(rec) : ""}. Tap it above to change.`;
  const nx = ui.editing ? null : nextOpen(r, hole);
  ui.editing = false;
  if (nx != null) d.cur.hole = nx; else if (!isDone(r)) d.cur.hole = r.holes.find((h) => !r.scores[h]);
  ui.f = false; ui.g = 0;
  persist(); loadToggles(); render();
  if (isDone(r)) scrollTo(0, 0);
  queueSave();
}
$("#results").addEventListener("click", (e) => { const b = e.target.closest("[data-score]"); if (!b) return; saveHole({ v: Number(b.dataset.score), f: meta(d.cur.hole).par === 3 ? false : ui.f, g: ui.g }); });
$("#albatross").addEventListener("click", (e) => { const v = Number(e.target.closest("button").dataset.score); if (v) saveHole({ v, f: ui.f, g: ui.g }); });
$("#skip").addEventListener("click", () => saveHole({ skip: true }));
$("#back").addEventListener("click", () => { const r = round(); const i = r.holes.indexOf(d.cur.hole); if (i > 0) { d.cur.hole = r.holes[i - 1]; ui.editing = true; ui.toast = ""; loadToggles(); persist(); render(); } });
$("#nines").addEventListener("click", (e) => {
  const b = e.target.closest("[data-hole]"); if (!b || !b.dataset.hole) return;
  const h = Number(b.dataset.hole); const r = round(); if (!r.holes.includes(h)) return;
  d.cur.hole = h; ui.editing = true; ui.toastOk = false; ui.toast = r.scores[h] ? `Changing hole ${h}.` : ""; loadToggles(); persist(); render();
});
$("#who").addEventListener("click", (e) => {
  const b = e.target.closest("[data-p]"); if (!b) return;
  d.cur.p = Number(b.dataset.p); d.cur.r = 0; const r = round();
  d.cur.hole = r.holes.find((h) => !r.scores[h]) ?? r.holes[0]; ui.editing = false; ui.toast = ""; loadToggles(); persist(); render();
});

// ---------- review + save ----------
function checksFor(r) {
  const out = [];
  for (const h of r.holes) {
    const e = r.scores[h], p = meta(h).par;
    if (!e) {
      const nine = r.holes.filter((x) => (x <= 9) === (h <= 9));
      const playedNine = nine.filter((x) => r.scores[x] && !r.scores[x].skip);
      const gap = playedNine.some((x) => x < h) && playedNine.some((x) => x > h);
      if (gap || playedNine.length >= 6) out.push({ h, gap: true, text: `Hole ${h}: no score, but you played holes around it` });
      continue;
    }
    if (e.skip) { out.push({ h, text: `Hole ${h}: skipped (won't be saved)` }); continue; }
    const putts = e.g === 2 ? e.v - (p - 3) : e.g === 1 ? e.v - (p - 2) : null;
    if (putts != null && putts >= 5) out.push({ h, text: `Hole ${h}: ${e.g === 2 ? "GG" : "Green"} then ${e.v} on a par ${p} means ${putts} putts. Right?` });
    if (e.v - p <= -2 && !e.g) out.push({ h, text: `Hole ${h}: ${e.v === 1 ? "ace" : (NAMES[e.v - p] || "").toLowerCase() + " " + e.v} without Green or GG. Holed out from off the green?` });
  }
  return out;
}
function renderReview(r) {
  const t = roundTotals(r);
  let fir = 0, firOf = 0, gir = 0, gg = 0;
  for (const h of r.holes) { const e = r.scores[h]; if (!e || e.skip) continue; if (meta(h).par !== 3) { firOf++; if (e.f) fir++; } if (e.g) gir++; if (e.g === 2) gg++; }
  $("#sum").innerHTML = [[t.s, t.n === r.holes.length ? "Score" : `Score · ${t.n} holes`], [t.n ? toPar(t.s - t.p) : "–", "To par"], [fir + "/" + firOf, "Fairways"], [gir + (gg ? " · " + gg + "GG" : ""), "Greens"]].map(([v, l]) => `<div><b>${v}</b><span>${l}</span></div>`).join("");
  const ch = checksFor(r);
  $("#check-count").textContent = `(${ch.length})`;
  $("#checks").innerHTML = ch.length ? ch.map((c) => `<button type="button" data-hole="${c.h}">${esc(c.text)}</button>`).join("") : `<p class="none">Nothing odd.</p>`;
  const last = d.cur.p >= d.players.length - 1;
  $("#save-next").hidden = last;
  $("#save-next").textContent = last ? "" : `Next: ${d.players[d.cur.p + 1]}`;
  $("#save-state").textContent = r.saved ? `Saved${r.number > 1 ? " as round " + r.number : ""}. Changes save automatically.` : "Saves automatically.";
}
$("#checks").addEventListener("click", (e) => { const b = e.target.closest("[data-hole]"); if (!b) return; d.cur.hole = Number(b.dataset.hole); ui.editing = true; ui.toast = `Changing hole ${d.cur.hole}.`; loadToggles(); persist(); render(); });
$("#edit-holes").addEventListener("click", () => { const r = round(); d.cur.hole = r.holes.find((h) => r.scores[h]) ?? r.holes[0]; ui.editing = true; ui.toast = "Tap any hole above, or change this one."; loadToggles(); persist(); render(); });
function addMore() {
  const g = golfer(); const holes = allHoles();
  const number = Math.max(...g.rounds.map((x) => x.number), ...existingRounds(golferName())) + 1;
  g.rounds.push({ id: uuid(), number, holes, scores: {}, revision: null, saved: false });
  d.cur.r = g.rounds.length - 1; d.cur.hole = holes[0]; ui.editing = false;
  ui.toastOk = true; ui.toast = `Round ${number} at ${d.course}. Start on any hole; tap Finish when you're done.`;
  persist(); loadToggles(); render(); scrollTo(0, 0);
}
$("#more").addEventListener("click", addMore);

function getKey() {
  const saved = store.get(KEY_KEY); if (saved) return Promise.resolve(saved);
  const dialog = $("#key-dialog");
  return new Promise((resolve) => {
    $("#key-input").value = "";
    dialog.onclose = () => { const v = $("#key-input").value.trim(); if (dialog.returnValue === "ok" && v) { store.set(KEY_KEY, v); resolve(v); } else resolve(null); };
    dialog.showModal();
  });
}
function payloadFor(name, r) {
  const scored = r.holes.filter((h) => r.scores[h] && !r.scores[h].skip);
  const track = scored.some((h) => r.scores[h].f || r.scores[h].g);
  return {
    id: r.id, revision: r.revision, played_on: d.date, player: name, course: d.course, round_number: r.number, notes: "",
    holes: scored.map((h) => { const e = r.scores[h], par = meta(h).par; return { hole: h, tees: d.tees, score: e.v, fir: track && par !== 3 ? Boolean(e.f) : null, green: track ? ["miss", "gir", "sgir"][e.g || 0] : null }; }),
  };
}
// ---------- autosave: every change is sent shortly after it's made; retried when signal comes back ----------
const hasScores = (r) => r.holes.some((h) => r.scores[h] && !r.scores[h].skip);
const dirtyRounds = () => d.players.flatMap((name) => (golfer(name)?.rounds || []).filter((r) => !r.saved && hasScores(r)).map((r) => [name, r]));
let saveTimer = null, saving = false, keyAsked = false;
function setSync(text, warn = false) { ui.sync = text; ui.syncWarn = warn; const sy = $("#sync"); if (sy) { sy.textContent = text; sy.classList.toggle("warn", warn); } }
function queueSave(delay = 1200) { clearTimeout(saveTimer); setSync(dirtyRounds().length ? "Saving…" : ui.sync); saveTimer = setTimeout(flushSave, delay); }
async function flushSave() {
  clearTimeout(saveTimer);
  if (saving) { saveTimer = setTimeout(flushSave, 800); return; }
  const todo = dirtyRounds();
  if (!todo.length) { if (d.started && Object.keys(d.golfers).length) setSync(anySaved() ? "Saved ✓" : ""); return; }
  let key = store.get(KEY_KEY);
  if (!key) { if (keyAsked) { setSync("Not saved · passcode", true); return; } keyAsked = true; key = await getKey(); if (!key) { setSync("Not saved · passcode", true); return; } }
  if (!navigator.onLine) { setSync("Not saved yet · no signal", true); return; }
  saving = true; setSync("Saving…");
  const sent = todo.map(([name, r]) => ({ r, ver: r.ver || 0 }));
  try {
    const res = await fetch(`${API}/rounds`, { method: "POST", headers: { "Content-Type": "application/json", "X-Golf-Key": key }, body: JSON.stringify({ rounds: todo.map(([name, r]) => payloadFor(name, r)) }) });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) { store.del(KEY_KEY); keyAsked = false; throw new Error("wrong passcode"); }
    if (!res.ok) throw new Error(body.details?.length ? body.details.map((x) => x.error).join(" · ") : body.error || `HTTP ${res.status}`);
    for (const s of body.saved) { const x = sent.find((y) => y.r.id === s.id); if (x) { x.r.revision = s.revision; x.r.saved = (x.r.ver || 0) === x.ver; } }
    persist(); ui.saveError = "";
    if (ui.toast.startsWith("Not saved")) ui.toast = "";
    setSync(dirtyRounds().length ? "Saving…" : "Saved ✓");
    loadData({ fresh: true }).then((x) => { data = x; }).catch(() => {});
  } catch (err) {
    setSync(navigator.onLine ? "Not saved · tap to retry" : "Not saved yet · no signal", true);
    ui.saveError = String(err.message || err);
  } finally {
    saving = false;
    render();
    if (dirtyRounds().length && !ui.syncWarn) saveTimer = setTimeout(flushSave, 800);
  }
}
const anySaved = () => d.players.some((n) => golfer(n)?.rounds.some((r) => r.saved));
$("#sync").addEventListener("click", () => { if (ui.syncWarn) { if (ui.saveError) { ui.toast = "Not saved: " + ui.saveError; render(); } flushSave(); } });
addEventListener("online", () => flushSave());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flushSave(); else if (dirtyRounds().length) flushSave(); });
setInterval(() => { if (dirtyRounds().length && !saving) flushSave(); }, 30000);
$("#save-next").addEventListener("click", () => {
  if (d.cur.p >= d.players.length - 1) return;
  const name = golferName();
  d.cur.p++; d.cur.r = 0; const r = round(); d.cur.hole = r.holes.find((h) => !r.scores[h]) ?? r.holes[0];
  ui.editing = false; ui.toastOk = true; ui.toast = `${name} done.`;
  loadToggles(); persist(); render(); scrollTo(0, 0); flushSave();
});
$("#new-card").addEventListener("click", () => {
  const unsaved = [...new Set(dirtyRounds().map(([n]) => n))];
  if (unsaved.length && !confirm(`Not saved yet for ${unsaved.join(", ")} (no signal?). Start a new card anyway? Those scores will be lost.`)) return;
  const keep = { course: d.course, tees: d.tees, players: d.players };
  d = { ...freshDraft(), ...keep }; ui.toast = ""; persist(); render();
});

// ---------- start ----------
(async function start() {
  try { const saved = JSON.parse(store.get(DRAFT_KEY) || "null"); if (saved && saved.golfers) d = saved; } catch {}
  const cached = cachedData();
  if (cached) { data = expand(cached); if (!d.course) { const c = recentCourses()[0]; if (c) { d.course = c; d.tees = defaultTees(c); } } loadToggles(); render(); }
  try { data = await loadData(); } catch (e) { if (!data) { $("#loading").textContent = "Couldn't load courses. Check your signal and reload."; return; } }
  if (!d.course) { const c = recentCourses()[0]; if (c) { d.course = c; d.tees = defaultTees(c); } }
  if (d.course && !teesFor(d.course).includes(d.tees)) d.tees = defaultTees(d.course);
  loadToggles(); render();
  if (dirtyRounds().length) flushSave(); else if (anySaved()) setSync("Saved ✓");
})();

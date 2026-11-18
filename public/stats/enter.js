import { API, loadData, cachedData, expand, resultName, toPar, esc } from "./golf-data.js?v=20261118";

const DRAFT_KEY = "golfEntryDraft.v1";
const KEY_KEY = "golfEntryKey";
const $ = s => document.querySelector(s);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const todayIso = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

let data = null;
let outing = freshOuting();
let mode = store.get("golfEntryMode") || "B";
const cursor = { golfer: 0, hole: null, down: true };

function freshOuting() {
  return { date: todayIso(), course: "", tees: "", plan: "18", golfers: [] };
}
function saveDraft() { store.set(DRAFT_KEY, JSON.stringify(outing)); renderSummary(); }

// ---------- course + hole helpers ----------
function teesFor(course) { return [...(data?.layouts.get(course)?.keys() || [])]; }
function layout(course, tees) { return data?.layouts.get(course)?.get(tees) || []; }
function planHoles(golfer) {
  const holes = layout(outing.course, golfer?.tees || outing.tees).map(h => h.hole);
  if (outing.plan === "front") return holes.filter(h => h <= 9);
  if (outing.plan === "back") return holes.filter(h => h >= 10);
  return holes;
}
function holeMeta(golfer, hole) { return layout(outing.course, golfer?.tees || outing.tees).find(h => h.hole === hole) || { hole, par: 4 }; }
function allHoles() { const set = new Set(); for (const g of outing.golfers.length ? outing.golfers : [null]) for (const h of planHoles(g)) set.add(h); return [...set].sort((a, b) => a - b); }
function entry(g, hole) { return g.scores[hole] || (g.scores[hole] = {}); }
function cls(score, par) { return score ? `r-${resultName(score - par)}` : "r-blank"; }
function totals(g) {
  let s = 0, p = 0, n = 0;
  for (const h of planHoles(g)) { const e = g.scores[h]; if (e?.s) { s += e.s; p += holeMeta(g, h).par; n++; } }
  return { s, p, n, label: n ? `${s} (${toPar(s - p)}) thru ${n}` : "no scores yet" };
}
function setScore(g, hole, score) {
  const e = entry(g, hole);
  const par = holeMeta(g, hole).par;
  if (score != null && (score < 1 || score > par + 3)) { toast(`Max is triple bogey (${par + 3}) on a par ${par}.`); return false; }
  e.s = score;
  g.savedAt = null;
  saveDraft();
  return true;
}
function toggleMark(g, hole, mark) {
  const e = entry(g, hole);
  const par = holeMeta(g, hole).par;
  if (mark === "f") { if (par === 3) return; e.f = !e.f; }
  if (mark === "g") e.g = e.g === "gir" ? null : "gir";
  if (mark === "sg") e.g = e.g === "sgir" ? null : "sgir";
  g.savedAt = null;
  saveDraft();
}

// ---------- setup panel ----------
function renderSetup() {
  const ready = outing.course && layout(outing.course, outing.tees).length && outing.golfers.length;
  const open = !ready || outing.setupOpen !== false;
  $("#setup").hidden = !open; $("#setup-summary").hidden = open;
  $("#setup-line").textContent = `${outing.course} · ${outing.tees} · ${outing.plan === "18" ? "18 holes" : outing.plan === "front" ? "front 9" : "back 9"}`;
  $("#setup-sub").textContent = `${new Date(`${outing.date}T12:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} · ${outing.golfers.map(g => g.name).join(", ")}`;
  $("#done-setup").disabled = !ready;
  $("#date").value = outing.date;
  $("#course").value = outing.course;
  const tees = teesFor(outing.course);
  $("#tees").innerHTML = tees.length ? tees.map(t => `<option ${t === outing.tees ? "selected" : ""}>${esc(t)}</option>`).join("") : `<option value="">Pick a course first</option>`;
  $("#plan").value = outing.plan;
  $("#golfers").innerHTML = outing.golfers.map((g, i) => `
    <span class="golfer-chip" data-i="${i}">
      <strong>${esc(g.name)}</strong>
      ${tees.length > 1 ? `<select data-act="gtees" aria-label="${esc(g.name)} tees">${tees.map(t => `<option ${t === (g.tees || outing.tees) ? "selected" : ""}>${esc(t)}</option>`).join("")}</select>` : ""}
      <label title="Round number (use 2 for a second round the same day)">Rd<input data-act="ground" type="number" min="1" max="10" value="${g.round}"></label>
      <label title="Track fairways and greens for this golfer"><input data-act="gtrack" type="checkbox" ${g.track ? "checked" : ""}>F/G</label>
      <button class="x" data-act="gremove" type="button" aria-label="Remove ${esc(g.name)}">×</button>
    </span>`).join("") || `<span class="muted">Add at least one golfer.</span>`;
}
function addGolfers(text) {
  const names = text.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
  for (const raw of names) {
    const known = data?.players.find(p => p.toLowerCase() === raw.toLowerCase());
    const name = known || raw;
    if (outing.golfers.some(g => g.name.toLowerCase() === name.toLowerCase())) continue;
    outing.golfers.push({ name, tees: "", round: 1, track: true, id: uuid(), revision: null, scores: {} });
  }
  saveDraft(); renderSetup(); renderMode();
}
function usualGroup() {
  if (!data) return [];
  const cutoff = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const jimDays = new Set(data.rounds.filter(r => r.player === "Jim" && r.date >= cutoff).map(r => `${r.date}|${r.course}`));
  const counts = new Map();
  for (const r of data.rounds) if (r.player !== "Jim" && jimDays.has(`${r.date}|${r.course}`)) counts.set(r.player, (counts.get(r.player) || 0) + 1);
  return ["Jim", ...[...counts].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p]) => p)];
}

// ---------- modes ----------
function needSetup() {
  if (!outing.course || !layout(outing.course, outing.tees).length) return `<div class="card empty"><p><b>Pick a course and tees</b> to start.</p><p class="muted">Not listed? Use “Add a course or new tees” at the bottom.</p></div>`;
  if (!outing.golfers.length) return `<div class="card empty"><p><b>Add golfers</b> above to start entering scores.</p></div>`;
  return "";
}
function holeHeader(hole, golfer, extra = "") {
  const m = holeMeta(golfer, hole);
  const holes = allHoles();
  const i = holes.indexOf(hole);
  return `<div class="hole-head"><div><h2>Hole ${hole}</h2><div class="meta">Par ${m.par}${m.yards ? ` · ${m.yards} yds` : ""}${m.handicap ? ` · Hcp ${m.handicap}` : ""}${extra}</div></div>
    <div class="navs"><button type="button" data-act="hole" data-hole="${holes[Math.max(0, i - 1)]}" aria-label="Previous hole">‹</button><button type="button" data-act="hole" data-hole="${holes[Math.min(holes.length - 1, i + 1)]}" aria-label="Next hole">›</button></div></div>`;
}
const names = { "-3": "Albatross", "-2": "Eagle", "-1": "Birdie", 0: "Par", 1: "Bogey", 2: "Double", 3: "Triple" };
function chipRange(par) { const out = []; for (let s = Math.max(1, par - 2); s <= par + 3; s++) out.push(s); return out; }
function marksHtml(g, hole, gi, tiny = false) {
  if (!g.track) return "";
  const e = g.scores[hole] || {};
  const par = holeMeta(g, hole).par;
  const c = tiny ? "mark tiny" : "mark";
  return `<div class="marks">${par === 3 ? "" : `<button type="button" class="${c}" data-act="mark" data-m="f" data-g="${gi}" data-hole="${hole}" aria-pressed="${Boolean(e.f)}">${tiny ? "F" : "Fairway"}</button>`}
    <button type="button" class="${c}" data-act="mark" data-m="g" data-g="${gi}" data-hole="${hole}" aria-pressed="${e.g === "gir"}">${tiny ? "G" : "Green"}</button>
    <button type="button" class="${c}" data-act="mark" data-m="sg" data-g="${gi}" data-hole="${hole}" aria-pressed="${e.g === "sgir"}">${tiny ? "SG" : "Super green"}</button></div>`;
}
function progressHtml(g, gi, current) {
  return `<div class="progress">${planHoles(g).map(h => { const e = g.scores[h]; const par = holeMeta(g, h).par; return `<button type="button" data-act="hole" data-g="${gi}" data-hole="${h}" class="${cls(e?.s, par)} ${h === current ? "cur" : ""}" aria-label="Hole ${h}${e?.s ? `, ${e.s}` : ""}"><small>${h}</small>${e?.s || (h === current ? "•" : "")}</button>`; }).join("")}</div>`;
}

function modeA() {
  const gi = Math.min(cursor.golfer, outing.golfers.length - 1);
  const g = outing.golfers[gi];
  const holes = planHoles(g);
  if (!holes.includes(cursor.hole)) cursor.hole = holes.find(h => !g.scores[h]?.s) ?? holes[0];
  const hole = cursor.hole, par = holeMeta(g, hole).par, e = g.scores[hole] || {};
  return `${outing.golfers.length > 1 ? `<label class="field">Entering for<select data-act="pickgolfer">${outing.golfers.map((x, i) => `<option value="${i}" ${i === gi ? "selected" : ""}>${esc(x.name)} — ${esc(totals(x).label)}</option>`).join("")}</select></label>` : ""}
    ${holeHeader(hole, g, ` · ${esc(g.name)} ${esc(totals(g).label)}`)}
    ${g.track ? `<p class="muted">Mark fairway / green first, then tap the score. It saves and moves on.</p>${marksHtml(g, hole, gi)}` : `<p class="muted">Tap the score. It saves and moves to the next hole.</p>`}
    <div class="chips">${chipRange(par).map(s => `<button type="button" class="chip ${cls(s, par)} ${e.s === s ? "picked" : ""}" data-act="score" data-g="${gi}" data-hole="${hole}" data-s="${s}"><b>${s}</b><span>${names[s - par]}</span></button>`).join("")}</div>
    <button type="button" class="btn" data-act="clear" data-g="${gi}" data-hole="${hole}">Clear hole ${hole} (didn’t play it)</button>
    ${progressHtml(g, gi, hole)}`;
}

function modeB() {
  const holes = allHoles();
  if (!holes.includes(cursor.hole)) cursor.hole = holes.find(h => outing.golfers.some(g => planHoles(g).includes(h) && !g.scores[h]?.s)) ?? holes[0];
  const hole = cursor.hole;
  const entered = outing.golfers.filter(g => g.scores[hole]?.s).length;
  return `${holeHeader(hole, outing.golfers[0], ` · ${entered} of ${outing.golfers.length} entered`)}
    <p class="muted">One tap per golfer. When everyone has a score it jumps to the next hole.</p>
    ${outing.golfers.map((g, gi) => {
      if (!planHoles(g).includes(hole)) return "";
      const par = holeMeta(g, hole).par, e = g.scores[hole] || {};
      return `<article class="golfer-row"><header><div><strong>${esc(g.name)}</strong> <span class="muted">${esc(totals(g).label)}</span></div>${marksHtml(g, hole, gi, true)}</header>
        <div class="chips small">${chipRange(par).map(s => `<button type="button" class="chip ${cls(s, par)} ${e.s === s ? "picked" : ""}" data-act="score" data-g="${gi}" data-hole="${hole}" data-s="${s}" aria-label="${esc(g.name)} ${s}"><b>${s}</b></button>`).join("")}</div></article>`;
    }).join("")}`;
}

function cardGrid(desk) {
  const holes = allHoles();
  const front = holes.filter(h => h <= 9), back = holes.filter(h => h >= 10);
  const head = `<tr><th>${desk ? "Golfer" : "Hole"}</th>${desk ? [...front.map(h => `<th>${h}<br><span class="muted">${holeMeta(null, h).par}</span></th>`), front.length ? "<th>OUT</th>" : "", ...back.map(h => `<th>${h}<br><span class="muted">${holeMeta(null, h).par}</span></th>`), back.length ? "<th>IN</th>" : "", "<th>TOT</th>"].join("") : `<th>Par</th>${outing.golfers.map(g => `<th>${esc(g.name)}</th>`).join("")}`}</tr>`;
  if (desk) {
    const rows = outing.golfers.map((g, gi) => {
      const cell = h => { if (!planHoles(g).includes(h)) return "<td></td>"; const e = g.scores[h] || {}; const par = holeMeta(g, h).par; const v = e.s ? `${e.s}${e.f ? "f" : ""}${e.g === "gir" ? "g" : e.g === "sgir" ? "gg" : ""}` : ""; return `<td><input class="${cls(e.s, par)}" data-g="${gi}" data-hole="${h}" value="${v}" inputmode="text" autocomplete="off" aria-label="${esc(g.name)} hole ${h}"></td>`; };
      const sum = hs => hs.reduce((s, h) => s + (g.scores[h]?.s || 0), 0) || "";
      return `<tr><td class="name">${esc(g.name)}</td>${front.map(cell).join("")}${front.length ? `<td class="tot">${sum(front)}</td>` : ""}${back.map(cell).join("")}${back.length ? `<td class="tot">${sum(back)}</td>` : ""}<td class="tot">${sum(holes) || ""}</td></tr>`;
    });
    return `<table class="cardgrid desk">${head}${rows.join("")}</table>`;
  }
  const rows = holes.map(h => `<tr><th>${h}</th><th>${holeMeta(null, h).par}</th>${outing.golfers.map((g, gi) => {
    if (!planHoles(g).includes(h)) return "<td></td>";
    const e = g.scores[h] || {}, par = holeMeta(g, h).par;
    const marks = g.track ? `${e.f ? "F" : ""}${e.g === "gir" ? "G" : e.g === "sgir" ? "SG" : ""}` : "";
    return `<td><div class="cell ${cls(e.s, par)} ${cursor.golfer === gi && cursor.hole === h ? "cur" : ""}" data-act="cell" data-g="${gi}" data-hole="${h}" role="button" tabindex="0" aria-label="${esc(g.name)} hole ${h}">${e.s || ""}${marks ? `<sup>${marks}</sup>` : ""}</div></td>`;
  }).join("")}</tr>`);
  const tot = `<tr><th>Tot</th><th>${holes.reduce((s, h) => s + holeMeta(null, h).par, 0)}</th>${outing.golfers.map(g => `<td class="tot">${totals(g).s || ""}</td>`).join("")}</tr>`;
  return `<table class="cardgrid">${head}${rows.join("")}${tot}</table>`;
}

function modeC() {
  const holes = allHoles();
  if (!holes.includes(cursor.hole)) cursor.hole = holes[0];
  const g = outing.golfers[Math.min(cursor.golfer, outing.golfers.length - 1)];
  return `<div class="row"><span class="muted">${esc(g.name)} · hole ${cursor.hole} · par ${holeMeta(g, cursor.hole).par}</span>
      <div class="tabs" role="group" aria-label="Fill order"><button type="button" data-act="dir" data-down="1" aria-selected="${cursor.down}">Down each golfer ↓</button><button type="button" data-act="dir" data-down="0" aria-selected="${!cursor.down}">Across each hole →</button></div></div>
    <div class="gridwrap">${cardGrid(false)}</div>
    <div class="keypad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button type="button" data-act="key" data-k="${n}">${n}</button>`).join("")}
      <button type="button" class="mk" data-act="key" data-k="f">F</button><button type="button" class="mk" data-act="key" data-k="g">G</button><button type="button" data-act="key" data-k="del" aria-label="Delete">⌫</button></div>`;
}

let scanRows = null;
function modeD() {
  const sample = outing.golfers.length ? outing.golfers.slice(0, 3).map(g => `${g.name}  ${planHoles(g).map(h => g.scores[h]?.s ?? "").join(" ").trim()}`).join("\n") : "";
  return `<div class="card quick"><div class="row"><label class="btn primary" for="scan-file">📷 Snap or upload scorecards</label><input id="scan-file" type="file" accept="image/*" capture="environment" multiple hidden><span class="muted" id="scan-status">The card reader fills the box below. Check it before saving.</span></div></div>
    <div class="card quick"><label class="field" for="quick-text"><b style="color:var(--ink)">One line per golfer</b> — name, then the scores in hole order</label>
      <textarea id="quick-text" spellcheck="false" placeholder="Jim 5 4 6 3 6 5 5 3 5 | 4 4 5 6 6 3 5 4 6&#10;RJ 44535443 4 | 545463445&#10;Sam +0 +1 0 -1 0 +1 ...">${esc(store.get("golfQuickText") || sample)}</textarea>
      <p class="muted">Spaces optional (5453 = 5,4,5,3). Add <b>f</b> fairway, <b>g</b> green, <b>gg</b> super green after a score (5fg). Start with + or − for strokes vs par (+1 0 -1). New names are added as golfers.</p>
      <div class="row"><button class="btn soft" type="button" data-act="parse">Check these lines</button><button class="btn" type="button" data-act="apply" ${scanRows ? "" : "disabled"}>Use them for this outing</button></div>
      <div id="quick-preview" class="preview">${scanRows ? previewHtml(scanRows) : ""}</div></div>`;
}
function parseQuick(textValue) {
  const holes = allHoles();
  return textValue.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
    const m = line.match(/^([^\d+\-|:]+?)[\s:]+(.+)$/);
    if (!m) return { line, error: "Couldn’t find a name and scores." };
    const name = m[1].trim();
    const rest = m[2].replace(/\|/g, " ").trim();
    const relative = /^[+\-]/.test(rest);
    let tokens = rest.split(/[\s,]+/).filter(Boolean).flatMap(t => /^\d{2,}$/.test(t) && !relative ? t.split("") : [t]);
    const known = data?.players.find(p => p.toLowerCase() === name.toLowerCase()) || outing.golfers.find(g => g.name.toLowerCase() === name.toLowerCase())?.name;
    const golfer = outing.golfers.find(g => g.name.toLowerCase() === (known || name).toLowerCase());
    const playHoles = golfer ? planHoles(golfer) : holes;
    const scores = [], warnings = [];
    tokens.slice(0, playHoles.length).forEach((t, i) => {
      const hole = playHoles[i]; const par = holeMeta(golfer, hole).par;
      const tm = t.match(/^([+\-]?\d+|x|-)(f)?(gg|g)?$/i);
      if (!tm || tm[1] === "x" || tm[1] === "-") { scores.push({ hole, s: null }); return; }
      let s = relative || /^[+\-]/.test(tm[1]) ? par + Number(tm[1]) : Number(tm[1]);
      if (s > par + 3) { warnings.push(`hole ${hole} ${s} is over triple bogey`); s = null; }
      if (s != null && s < 1) { warnings.push(`hole ${hole} can't be ${s}`); s = null; }
      if (s != null && s <= par - 2) warnings.push(`eagle or better on ${hole}?`);
      scores.push({ hole, s, f: Boolean(tm[2]) && par !== 3, g: tm[3] ? (tm[3].toLowerCase() === "gg" ? "sgir" : "gir") : null });
    });
    if (tokens.length > playHoles.length) warnings.push(`${tokens.length} scores for ${playHoles.length} holes — extras ignored`);
    const count = scores.filter(x => x.s).length;
    if (count && count < playHoles.length) warnings.push(`only ${count} of ${playHoles.length} holes`);
    const total = scores.reduce((a, x) => a + (x.s || 0), 0);
    const parTotal = scores.filter(x => x.s).reduce((a, x) => a + holeMeta(golfer, x.hole).par, 0);
    return { name: known || name, isNew: !known, scores, total, toPar: total - parTotal, count, warnings, marks: scores.some(x => x.f || x.g) };
  });
}
function previewHtml(rows) {
  return rows.map(r => r.error ? `<div class="line"><span class="dot warn"></span><b>${esc(r.line)}</b><span class="muted">${esc(r.error)}</span></div>` :
    `<div class="line"><span class="dot ${r.warnings.length || r.isNew ? "warn" : ""}"></span><b>${esc(r.name)}</b><span>${r.total || "–"} ${r.count ? `(${toPar(r.toPar)})` : ""}</span><span class="muted">${r.count} holes${r.marks ? " · F/G marked" : ""}${r.isNew ? " · new golfer" : ""}${r.warnings.length ? " · " + esc(r.warnings.join("; ")) : ""}</span></div>`).join("");
}
function applyQuick(rows) {
  for (const r of rows.filter(x => !x.error)) {
    let g = outing.golfers.find(x => x.name.toLowerCase() === r.name.toLowerCase());
    if (!g) { g = { name: r.name, tees: "", round: 1, track: r.marks, id: uuid(), revision: null, scores: {} }; outing.golfers.push(g); }
    for (const x of r.scores) if (x.s) g.scores[x.hole] = { s: x.s, f: x.f, g: x.g };
  }
  saveDraft(); renderSetup(); toast(`Filled ${rows.filter(x => !x.error).length} golfers. Check them in C or E, then save.`);
}
async function scanFiles(files) {
  const status = $("#scan-status");
  const key = await getKey(); if (!key) return;
  const lines = [];
  for (const [i, file] of [...files].entries()) {
    status.textContent = `Reading card ${i + 1} of ${files.length}…`;
    try {
      const image = await shrink(file);
      const res = await fetch(`${API}/scan`, { method: "POST", headers: { "Content-Type": "application/json", "X-Golf-Key": key }, body: JSON.stringify({ image, players: data?.players || [], holes: allHoles().length || 18 }) });
      const body = await res.json();
      if (res.status === 401) { store.del(KEY_KEY); throw new Error("Wrong passcode."); }
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      for (const r of body.rows) lines.push(`${r.name || "?"} ${r.scores.map(s => s ?? "x").join(" ")}`);
    } catch (e) { lines.push(`# card ${i + 1}: ${e.message}`); }
  }
  const box = $("#quick-text");
  box.value = [box.value.trim(), ...lines].filter(Boolean).join("\n");
  store.set("golfQuickText", box.value);
  status.textContent = "Done. Check every line against the card (x = couldn’t read), then press Check these lines.";
}
function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { const scale = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement("canvas"); c.width = img.width * scale; c.height = img.height * scale; c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.src); resolve(c.toDataURL("image/jpeg", 0.85)); };
    img.onerror = () => reject(new Error("Couldn’t open that photo."));
    img.src = URL.createObjectURL(file);
  });
}

function modeE() {
  return `<p class="muted">Type a score and it jumps right. Add <b>f</b> / <b>g</b> / <b>gg</b> after it for fairway / green / super green. <b>Enter</b> goes to the next golfer. Paste a row of 9 or 18 scores into any box.</p>
    <div class="gridwrap">${cardGrid(true)}</div>`;
}

function renderMode() {
  document.querySelectorAll(".mode-tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.mode === mode)));
  const blocker = needSetup();
  $("#mode").innerHTML = blocker || { A: modeA, B: modeB, C: modeC, D: modeD, E: modeE }[mode]();
  renderSummary();
}
function renderSummary() {
  $("#summary").innerHTML = outing.golfers.map(g => `<span><b>${esc(g.name)}</b> ${esc(totals(g).label)}${g.savedAt ? " ✓" : ""}</span>`).join("") || `<span class="muted">Drafts save on this device automatically.</span>`;
}

// ---------- events ----------
function nextHoleFor(g, hole) { const hs = planHoles(g); const i = hs.indexOf(hole); return hs[i + 1]; }
document.addEventListener("click", event => {
  const el = event.target.closest("[data-act]"); if (!el) return;
  const act = el.dataset.act, gi = Number(el.dataset.g), hole = Number(el.dataset.hole), g = outing.golfers[gi];
  if (act === "hole") { cursor.hole = hole; if (!Number.isNaN(gi)) cursor.golfer = gi; renderMode(); }
  if (act === "score") {
    if (!setScore(g, hole, Number(el.dataset.s))) return;
    if (mode === "A") { const n = nextHoleFor(g, hole); if (n) cursor.hole = n; else toast(`${g.name} is done: ${totals(g).label}.`); }
    if (mode === "B" && outing.golfers.every(x => !planHoles(x).includes(hole) || x.scores[hole]?.s)) {
      renderMode(); const hs = allHoles(); const n = hs[hs.indexOf(hole) + 1];
      setTimeout(() => { if (n && cursor.hole === hole) { cursor.hole = n; renderMode(); } else if (!n) toast("All holes in. Press Save rounds."); }, 350); return;
    }
    renderMode();
  }
  if (act === "mark") { toggleMark(g, hole, el.dataset.m); renderMode(); }
  if (act === "clear") { delete g.scores[hole]; saveDraft(); renderMode(); }
  if (act === "cell") { cursor.golfer = gi; cursor.hole = hole; renderMode(); }
  if (act === "dir") { cursor.down = el.dataset.down === "1"; renderMode(); }
  if (act === "key") keypad(el.dataset.k);
  if (act === "gremove") { const i = Number(el.closest(".golfer-chip").dataset.i); const x = outing.golfers[i]; if (Object.keys(x.scores).length && !confirm(`Remove ${x.name} and the scores entered for them?`)) return; outing.golfers.splice(i, 1); saveDraft(); renderSetup(); renderMode(); }
  if (act === "parse") { const t = $("#quick-text").value; store.set("golfQuickText", t); scanRows = parseQuick(t); renderMode(); }
  if (act === "apply" && scanRows) { applyQuick(scanRows); scanRows = null; mode = "C"; store.set("golfEntryMode", mode); renderMode(); }
});
function keypad(k) {
  const g = outing.golfers[cursor.golfer]; if (!g) return;
  if (k === "f" || k === "g") { if (!g.track) { g.track = true; renderSetup(); } toggleMark(g, cursor.hole, k); renderMode(); return; }
  if (k === "del") { delete g.scores[cursor.hole]; saveDraft(); renderMode(); return; }
  if (!setScore(g, cursor.hole, Number(k))) return;
  advanceCursor(); renderMode();
}
function advanceCursor() {
  const holes = allHoles();
  if (cursor.down) {
    const i = holes.indexOf(cursor.hole);
    if (i < holes.length - 1) cursor.hole = holes[i + 1]; else if (cursor.golfer < outing.golfers.length - 1) { cursor.golfer++; cursor.hole = holes[0]; }
  } else if (cursor.golfer < outing.golfers.length - 1) cursor.golfer++;
  else { cursor.golfer = 0; const i = holes.indexOf(cursor.hole); if (i < holes.length - 1) cursor.hole = holes[i + 1]; }
}
document.addEventListener("keydown", event => {
  if (mode !== "C" || event.target.closest("input, textarea, select")) return;
  if (/^[1-9]$/.test(event.key)) { keypad(event.key); event.preventDefault(); }
  else if (event.key === "f" || event.key === "g") { keypad(event.key); event.preventDefault(); }
  else if (event.key === "Backspace") { keypad("del"); event.preventDefault(); }
});
// Desk grid (E)
function parseCell(v) { const m = String(v).trim().match(/^(\d)(f)?(gg|g)?$/i); return m ? { s: Number(m[1]), f: Boolean(m[2]), g: m[3] ? (m[3].toLowerCase() === "gg" ? "sgir" : "gir") : null } : null; }
document.addEventListener("input", event => {
  const input = event.target;
  if (input.closest(".desk")) {
    const g = outing.golfers[Number(input.dataset.g)], hole = Number(input.dataset.hole), par = holeMeta(g, hole).par;
    const v = input.value.trim();
    if (!v) { delete g.scores[hole]; saveDraft(); input.className = "r-blank"; return; }
    const p = parseCell(v);
    if (!p) return;
    if (p.s > par + 3) { toast(`Max is ${par + 3} on a par ${par}.`); return; }
    g.scores[hole] = { s: p.s, f: p.f && par !== 3, g: p.g };
    if ((p.f || p.g) && !g.track) g.track = true;
    saveDraft();
    input.className = cls(p.s, par);
    if (/^\d$/.test(v)) focusDesk(input, 1);
  }
  if (input.id === "quick-text") store.set("golfQuickText", input.value);
});
document.addEventListener("keydown", event => {
  const input = event.target; if (!input.closest?.(".desk")) return;
  const wasFresh = input.dataset.fresh === "1";
  if (!/^[fg]$/i.test(event.key)) input.dataset.fresh = "";
  if (/^[fg]$/i.test(event.key) && (!input.value || wasFresh)) {
    // f / g typed right after a score jumped here: mark the box that was just filled.
    event.preventDefault();
    const row = [...document.querySelectorAll(`.desk input[data-g="${input.dataset.g}"]`)];
    const prev = row[row.indexOf(input) - 1]; if (!prev?.value) return;
    const g = outing.golfers[Number(prev.dataset.g)], hole = Number(prev.dataset.hole);
    if (!g.track) g.track = true;
    const k = event.key.toLowerCase();
    toggleMark(g, hole, k === "g" && g.scores[hole]?.g === "gir" ? "sg" : k);
    const e = g.scores[hole]; prev.value = `${e.s}${e.f ? "f" : ""}${e.g === "gir" ? "g" : e.g === "sgir" ? "gg" : ""}`;
    prev.className = cls(e.s, holeMeta(g, hole).par);
    return;
  }
  if (event.key === "Enter") { event.preventDefault(); const next = document.querySelector(`.desk input[data-g="${Number(input.dataset.g) + 1}"]`); if (next) next.focus(); else { renderMode(); toast("Last golfer. Press Save rounds when you're done."); } }
  if (event.key === "ArrowRight" && input.selectionStart === input.value.length) focusDesk(input, 1);
  if (event.key === "ArrowLeft" && input.selectionStart === 0) focusDesk(input, -1);
  if (event.key === "ArrowDown") document.querySelector(`.desk input[data-g="${Number(input.dataset.g) + 1}"][data-hole="${input.dataset.hole}"]`)?.focus();
  if (event.key === "ArrowUp") document.querySelector(`.desk input[data-g="${Number(input.dataset.g) - 1}"][data-hole="${input.dataset.hole}"]`)?.focus();
});
document.addEventListener("focusin", event => { if (event.target.closest?.(".desk")) event.target.select(); });
document.addEventListener("focusout", event => { if (event.target.closest?.(".desk") && !event.relatedTarget?.closest?.(".desk")) renderSummary(); });
document.addEventListener("paste", event => {
  const input = event.target; if (!input.closest?.(".desk")) return;
  const tokens = event.clipboardData.getData("text").split(/[\s,\t|]+/).filter(Boolean).flatMap(t => /^\d{2,}$/.test(t) ? t.split("") : [t]);
  if (tokens.length < 2) return;
  event.preventDefault();
  const g = outing.golfers[Number(input.dataset.g)];
  const hs = planHoles(g); let i = hs.indexOf(Number(input.dataset.hole));
  for (const t of tokens) { const hole = hs[i++]; if (!hole) break; const p = parseCell(t); if (p && p.s <= holeMeta(g, hole).par + 3) g.scores[hole] = { s: p.s, f: p.f, g: p.g }; }
  saveDraft(); renderMode();
});
function focusDesk(input, step) {
  const all = [...document.querySelectorAll(`.desk input[data-g="${input.dataset.g}"]`)];
  const next = all[all.indexOf(input) + step];
  if (next) { next.dataset.fresh = step > 0 ? "1" : ""; next.focus(); next.select(); } else if (step > 0) document.querySelector(`.desk input[data-g="${Number(input.dataset.g) + 1}"]`)?.focus();
}

document.addEventListener("change", event => {
  const el = event.target;
  if (el.id === "scan-file" && el.files.length) scanFiles(el.files);
  const chip = el.closest(".golfer-chip"); if (!chip) return;
  const g = outing.golfers[Number(chip.dataset.i)];
  if (el.dataset.act === "gtees") g.tees = el.value === outing.tees ? "" : el.value;
  if (el.dataset.act === "ground") g.round = Math.max(1, Math.min(10, Number(el.value) || 1));
  if (el.dataset.act === "gtrack") g.track = el.checked;
  saveDraft(); renderMode();
});
document.addEventListener("click", event => {
  const el = event.target.closest("[data-act=pickgolfer]"); if (el) return;
});
$("#mode").addEventListener("change", event => { if (event.target.dataset.act === "pickgolfer") { cursor.golfer = Number(event.target.value); cursor.hole = null; renderMode(); } });
document.querySelector(".mode-tabs").addEventListener("click", event => { const b = event.target.closest("[data-mode]"); if (!b) return; mode = b.dataset.mode; store.set("golfEntryMode", mode); renderMode(); });

$("#date").addEventListener("change", e => { outing.date = e.target.value; saveDraft(); });
$("#course").addEventListener("change", e => {
  const value = e.target.value.trim();
  const match = data?.courses.find(c => c.name.toLowerCase() === value.toLowerCase());
  outing.course = match ? match.name : value;
  const tees = teesFor(outing.course);
  outing.tees = tees.includes(outing.tees) ? outing.tees : lastTees(outing.course) || tees[0] || "";
  for (const g of outing.golfers) if (!tees.includes(g.tees)) g.tees = "";
  saveDraft(); renderSetup(); renderMode();
});
$("#tees").addEventListener("change", e => { outing.tees = e.target.value; saveDraft(); renderSetup(); renderMode(); });
$("#plan").addEventListener("change", e => { outing.plan = e.target.value; cursor.hole = null; saveDraft(); renderMode(); });
$("#golfer-input").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addGolfers(e.target.value); e.target.value = ""; } });
$("#add-golfer").addEventListener("click", () => { addGolfers($("#golfer-input").value); $("#golfer-input").value = ""; });
$("#add-usual").addEventListener("click", () => addGolfers(usualGroup().join(",")));
$("#edit-setup").addEventListener("click", () => { outing.setupOpen = true; saveDraft(); renderSetup(); });
$("#done-setup").addEventListener("click", () => { outing.setupOpen = false; saveDraft(); renderSetup(); scrollTo({ top: 0, behavior: "smooth" }); });
$("#new-outing").addEventListener("click", () => {
  const unsaved = outing.golfers.some(g => g.dirty !== false && Object.keys(g.scores).length && !g.savedAt);
  if (unsaved && !confirm("Start over? Unsaved scores on this device will be cleared.")) return;
  const keep = { course: outing.course, tees: outing.tees };
  outing = { ...freshOuting(), ...keep, setupOpen: true }; cursor.hole = null; cursor.golfer = 0; scanRows = null; store.del("golfQuickText"); saveDraft(); renderSetup(); renderMode();
});
function lastTees(course) { const r = data?.rounds.filter(x => x.course === course && x.player === "Jim").at(-1); return r?.holes[0]?.tees; }

// ---------- saving ----------
function getKey() {
  const saved = store.get(KEY_KEY); if (saved) return Promise.resolve(saved);
  const dialog = $("#key-dialog");
  return new Promise(resolve => {
    $("#key-input").value = "";
    dialog.onclose = () => { const v = $("#key-input").value.trim(); if (dialog.returnValue === "ok" && v) { store.set(KEY_KEY, v); resolve(v); } else resolve(null); };
    dialog.showModal();
  });
}
function buildRounds() {
  return outing.golfers.map(g => {
    const holes = planHoles(g).filter(h => g.scores[h]?.s).map(h => {
      const e = g.scores[h], par = holeMeta(g, h).par;
      return { hole: h, tees: g.tees || outing.tees, score: e.s, fir: g.track && par !== 3 ? Boolean(e.f) : null, green: g.track ? (e.g || "miss") : null };
    });
    return { golfer: g, payload: { id: g.id, revision: g.revision, played_on: outing.date, player: g.name, course: outing.course, round_number: g.round, notes: "", holes } };
  }).filter(r => r.payload.holes.length);
}
$("#save").addEventListener("click", async () => {
  const status = $("#status");
  const rounds = buildRounds();
  if (!outing.course || !rounds.length) { status.textContent = "Nothing to save yet."; return; }
  const partial = rounds.filter(r => r.payload.holes.length < planHoles(r.golfer).length).map(r => `${r.golfer.name} (${r.payload.holes.length} holes)`);
  if (partial.length && !confirm(`Save partial rounds for ${partial.join(", ")}?`)) return;
  const eagles = rounds.flatMap(r => r.payload.holes.filter(h => h.score <= holeMeta(r.golfer, h.hole).par - 2).map(h => `${r.golfer.name} ${h.score} on hole ${h.hole}`));
  if (eagles.length && !confirm(`Double-check: eagle or better for ${eagles.join(", ")}. Save?`)) return;
  const key = await getKey(); if (!key) return;
  status.textContent = `Saving ${rounds.length} round${rounds.length > 1 ? "s" : ""}…`;
  $("#save").disabled = true;
  try {
    const res = await fetch(`${API}/rounds`, { method: "POST", headers: { "Content-Type": "application/json", "X-Golf-Key": key }, body: JSON.stringify({ rounds: rounds.map(r => r.payload) }) });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) { store.del(KEY_KEY); throw new Error("Wrong passcode. Try saving again."); }
    if (!res.ok) throw new Error(body.details?.length ? body.details.map(d => d.error).join(" · ") : body.error || `HTTP ${res.status}`);
    for (const saved of body.saved) { const g = outing.golfers.find(x => x.id === saved.id); if (g) { g.revision = saved.revision; g.savedAt = new Date().toISOString(); } }
    saveDraft();
    status.textContent = `Saved ${body.saved.length} round${body.saved.length > 1 ? "s" : ""}. You can keep editing; saving again updates them.`;
    toast("Saved ✓");
    loadData({ fresh: true }).then(d => { data = d; }).catch(() => {});
  } catch (e) {
    status.textContent = navigator.onLine ? e.message : "You're offline. Scores are kept on this device; press Save again when you have signal.";
  } finally { $("#save").disabled = false; }
});

$("#course-form").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.target);
  const count = Number(form.get("count"));
  const lines = String(form.get("holes")).split("\n").map(l => l.trim()).filter(Boolean);
  const statusEl = $("#course-status");
  if (lines.length !== count) { statusEl.textContent = `Enter ${count} lines (one per hole). You have ${lines.length}.`; return; }
  const start = count === 9 && confirm("Is this the back nine (holes 10–18)? Cancel = front nine.") ? 10 : 1;
  const holes = lines.map((l, i) => { const [par, length, handicap] = l.split(/[\s,]+/).map(Number); return { hole: start + i, par, length: length || null, handicap: handicap || null }; });
  const key = await getKey(); if (!key) return;
  const res = await fetch(`${API}/courses`, { method: "POST", headers: { "Content-Type": "application/json", "X-Golf-Key": key }, body: JSON.stringify({ course: form.get("course"), tees: form.get("tees"), holes }) });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) store.del(KEY_KEY);
  statusEl.textContent = res.ok ? "Saved. Pick it in the Course box above." : body.error || `HTTP ${res.status}`;
  if (res.ok) { data = await loadData({ fresh: true }); fillLists(); }
});

let toastTimer;
function toast(message) {
  let el = document.querySelector(".toast"); if (!el) { el = document.createElement("div"); el.className = "toast"; el.setAttribute("role", "status"); document.body.append(el); }
  el.textContent = message; clearTimeout(toastTimer); toastTimer = setTimeout(() => el.remove(), 2600);
}
function fillLists() {
  $("#course-list").innerHTML = data.courses.map(c => `<option value="${esc(c.name)}">`).join("");
  $("#player-list").innerHTML = data.players.map(p => `<option value="${esc(p)}">`).join("");
}

(async function start() {
  try { const draft = JSON.parse(store.get(DRAFT_KEY) || "null"); if (draft?.golfers) outing = draft; } catch {}
  const cached = cachedData();
  if (cached) { data = expand(cached); fillLists(); }
  renderSetup(); renderMode();
  try { data = await loadData(); fillLists(); renderSetup(); renderMode(); if (data.offline) $("#status").textContent = "Offline: using the last downloaded course list."; }
  catch { $("#status").textContent = "Couldn't reach the golf database. Check your connection."; }
})();

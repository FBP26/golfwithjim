import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { d1, installCache } from "./dev/d1-shim.mjs";
import worker from "./worker.js";

installCache();
function setup() {
  const DB = d1();
  DB.raw.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));
  DB.raw.exec(`INSERT INTO courses VALUES ('Test Links','{"complex":"Test"}');`);
  for (let h = 1; h <= 18; h++) DB.raw.exec(`INSERT INTO course_holes VALUES ('Test Links','White',${h},${h % 3 === 0 ? 3 : 4},${300 + h},${h})`);
  return { DB, GOLF_ADMIN_PASSWORD: "secret-pass", ALLOWED_ORIGINS: "https://fbp26.github.io" };
}
const call = (env, path, { method = "GET", body, key } = {}) => worker.fetch(new Request(`https://x${path}`, { method, headers: { Origin: "https://fbp26.github.io", "Content-Type": "application/json", ...(key ? { "X-Golf-Key": key } : {}) }, body: body ? JSON.stringify(body) : undefined }), env);
const round = (over = {}) => ({ id: "11111111-1111-4111-8111-111111111111", played_on: "2026-11-01", player: "Jim", course: "Test Links", round_number: 1, holes: Array.from({ length: 18 }, (_, i) => ({ hole: i + 1, tees: "White", score: 5, fir: true, green: "miss" })), ...over });

test("rejects writes without the passcode and accepts with it", async () => {
  const env = setup();
  assert.equal((await call(env, "/rounds", { method: "POST", body: { rounds: [round()] } })).status, 401);
  const ok = await call(env, "/rounds", { method: "POST", body: { rounds: [round()] }, key: "secret-pass" });
  assert.equal(ok.status, 200);
  const data = await (await call(env, "/data")).json();
  assert.equal(data.rounds.length, 1);
  assert.equal(data.holes.length, 18);
  assert.equal(data.holes.find(h => h[1] === 3)[7], null, "par 3 FIR is unknown");
});

test("saves a foursome in one call, is idempotent, and bumps revision on edit", async () => {
  const env = setup();
  const ids = ["a", "b", "c", "d"].map(c => `${c.repeat(8)}-1111-4111-8111-111111111111`);
  const rounds = ids.map((id, i) => round({ id, player: ["Jim", "RJ", "Sam", "Brant"][i] }));
  const first = await (await call(env, "/rounds", { method: "POST", body: { rounds }, key: "secret-pass" })).json();
  assert.equal(first.saved.length, 4);
  const again = await (await call(env, "/rounds", { method: "POST", body: { rounds: rounds.map(r => ({ ...r, revision: 1 })) }, key: "secret-pass" })).json();
  assert.ok(again.saved.every(s => s.unchanged));
  const edited = rounds[0]; edited.holes[0].score = 4; edited.revision = 1;
  const third = await (await call(env, "/rounds", { method: "POST", body: { rounds: [edited] }, key: "secret-pass" })).json();
  assert.equal(third.saved[0].revision, 2);
  const stale = await call(env, "/rounds", { method: "POST", body: { rounds: [{ ...edited, revision: 1 }] }, key: "secret-pass" });
  assert.equal(stale.status, 409);
});

test("caps scores at triple bogey and blocks duplicate rounds", async () => {
  const env = setup();
  const bad = round(); bad.holes[0].score = 8;
  const res = await call(env, "/rounds", { method: "POST", body: { rounds: [bad] }, key: "secret-pass" });
  assert.equal(res.status, 422);
  await call(env, "/rounds", { method: "POST", body: { rounds: [round()] }, key: "secret-pass" });
  const dup = await call(env, "/rounds", { method: "POST", body: { rounds: [round({ id: "22222222-1111-4111-8111-111111111111", player: "jim" })] }, key: "secret-pass" });
  assert.equal(dup.status, 409);
});

test("data is cached by version and refreshes after a save", async () => {
  const env = setup();
  const a = await call(env, "/data"); const etag = a.headers.get("ETag");
  const b = await worker.fetch(new Request("https://x/data", { headers: { "If-None-Match": etag } }), env);
  assert.equal(b.status, 304);
  await call(env, "/rounds", { method: "POST", body: { rounds: [round()] }, key: "secret-pass" });
  const c = await call(env, "/data");
  assert.notEqual(c.headers.get("ETag"), etag);
});

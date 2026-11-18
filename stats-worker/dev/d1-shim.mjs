// Minimal D1 stand-in on node:sqlite for local tests and previews.
import { DatabaseSync } from "node:sqlite";
export function d1(path = ":memory:") {
  const db = new DatabaseSync(path);
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return {
    raw: db,
    prepare: sql => stmt(sql),
    exec: async sql => db.exec(sql),
    batch: async list => { db.exec("BEGIN"); try { const out = []; for (const s of list) { const r = db.prepare(s.sql).run(...s.args); out.push({ meta: { changes: Number(r.changes) } }); } db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } },
  };
}
export function installCache() {
  const store = new Map();
  globalThis.caches = { default: { match: async k => store.get(k.url)?.clone(), put: async (k, v) => { store.set(k.url, v); } } };
}

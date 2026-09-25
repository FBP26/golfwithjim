import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { appendFile, mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const execute = promisify(execFile);
const course = "Sycamore Creek Golf Course";
const repository = "https://github.com/FBP26/golfwithjim.git";
const git = process.platform === "win32" ? "C:/Program Files/Git/cmd/git.exe" : "git";

export function validateCollection(collected) {
  const check = collected.sourceChecks?.find(item => item.course === course);
  if (!check || check.error || !collected.sources?.includes(course) || !Number.isFinite(Date.parse(collected.checkedAt))) {
    throw new Error(`Sycamore collection failed: ${check?.error || "missing successful source check"}`);
  }
  if (!Array.isArray(collected.teeTimes) || collected.teeTimes.some(item => item.course !== course || item.holes !== 18 || item.priceIsExact !== true || !(item.allInPrice > 0))) {
    throw new Error("Sycamore collection contains unverified inventory");
  }
}

export function hasNewerCollection(base, collected) {
  const check = base.sourceChecks?.find(item => item.course === course);
  const verifiedAt = check?.lastSuccessfulAt || (!check?.error ? check?.checkedAt : null);
  return Date.parse(verifiedAt) >= Date.parse(collected.checkedAt);
}

async function run(command, args, cwd, options = {}) {
  return (await execute(command, args, { cwd, timeout: 120_000, maxBuffer: 20 * 1024 * 1024, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" }, ...options })).stdout.trim();
}

export async function publishSycamore() {
  const stateDirectory = join(process.env.LOCALAPPDATA || tmpdir(), "GolfWithJim");
  await mkdir(stateDirectory, { recursive: true });
  const lockPath = join(stateDirectory, "sycamore.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const previous = JSON.parse(await readFile(lockPath, "utf8"));
    try { process.kill(previous.pid, 0); console.log("Sycamore publisher is already running."); return; }
    catch (activeError) { if (activeError.code !== "ESRCH") throw activeError; }
    await rm(lockPath);
    lock = await open(lockPath, "wx");
  }
  await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
  const status = { startedAt: new Date().toISOString(), ok: false };
  let temporary;
  try {
    temporary = await mkdtemp(join(tmpdir(), "golf-sycamore-"));
    let collected;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const checkout = join(temporary, `checkout-${attempt}`);
      await run(git, ["clone", "--quiet", "--depth=1", "--branch=main", repository, checkout]);
      if (!collected) {
        const output = join(temporary, "collected.json");
        const env = { ...process.env };
        delete env.CHRONOGOLF_PROXY_URL;
        delete env.CHRONOGOLF_PROXY_TOKEN;
        await run(process.execPath, ["src/collect.js", `--course=${course}`, `--output=${output}`], checkout, { env, timeout: 10 * 60_000 });
        collected = JSON.parse(await readFile(output, "utf8"));
        validateCollection(collected);
      }
      await run(git, ["fetch", "origin", "main"], checkout);
      await run(git, ["merge", "--ff-only", "origin/main"], checkout);
      const feedPath = join(checkout, "fixtures/live-current.json");
      const base = JSON.parse(await readFile(feedPath, "utf8"));
      if (hasNewerCollection(base, collected)) {
        Object.assign(status, { ok: true, skipped: "A newer Sycamore collection is already published." });
        break;
      }
      const { mergeCollectedInventory } = await import(pathToFileURL(join(checkout, "src/collect.js")));
      const merged = mergeCollectedInventory(base, collected, { partial: true });
      await writeFile(feedPath, `${JSON.stringify(merged, null, 2)}\n`);
      await run(git, ["add", "fixtures/live-current.json"], checkout);
      await run(git, ["-c", "user.name=GolfWithJim Laptop", "-c", "user.email=golfwithjim-laptop@users.noreply.github.com", "commit", "-m", "Refresh Sycamore from laptop"], checkout);
      try {
        await run(git, ["push", "origin", "HEAD:main"], checkout);
        Object.assign(status, { ok: true, checkedAt: collected.checkedAt, teeTimeCount: collected.teeTimes.length, commit: await run(git, ["rev-parse", "HEAD"], checkout) });
        break;
      } catch (error) {
        if (attempt === 3) throw error;
      }
    }
    console.log(JSON.stringify(status, null, 2));
  } catch (error) {
    status.error = error.message;
    throw error;
  } finally {
    status.completedAt = new Date().toISOString();
    try {
      await writeFile(join(stateDirectory, "sycamore-status.json"), `${JSON.stringify(status, null, 2)}\n`);
      await appendFile(join(stateDirectory, "sycamore.log"), `${JSON.stringify(status)}\n`);
      if (temporary) await rm(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  publishSycamore().catch(error => { console.error(error.message); process.exitCode = 1; });
}
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const email = process.argv[2];
if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Usage: node alert-worker/activate.mjs EMAIL");
const directory = fileURLToPath(new URL(".", import.meta.url));
const wrangler = fileURLToPath(new URL("node_modules/wrangler/bin/wrangler.js", import.meta.url));
if (!process.argv.includes("--resume")) {
  const relay = spawnSync(process.execPath, [wrangler, "secret", "put", "EMAIL_RELAY_SECRET"], { cwd: directory, stdio: "inherit" });
  if (relay.status !== 0) throw new Error("Email secret setup did not finish. No enrollment attempted.");
}
const adminSecret = randomBytes(32).toString("hex");
const admin = spawnSync(process.execPath, [wrangler, "secret", "put", "ADMIN_SECRET"], { cwd: directory, input: adminSecret, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
if (admin.status !== 0) throw new Error("Admin secret setup failed. No enrollment attempted.");
const endpoint = "https://golfwithjim-alerts.fbp-api-worker.workers.dev";
async function command(path, body) {
  const response = await fetch(`${endpoint}/admin/${path}`, { method: "POST", headers: { Authorization: `Bearer ${adminSecret}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Operation failed: HTTP ${response.status}`);
  return result;
}
const enrollment = await command("enroll", { email });
console.log(JSON.stringify({ enrolled: Boolean(enrollment.enrolled || enrollment.alreadyEnrolled), welcomeAccepted: enrollment.welcomeDelivered ?? null }));
const initial = await command("check", {});
console.log(JSON.stringify({ emailConfigured: initial.configured, messagesAcceptedDuringInitialCheck: initial.sent }));
if (enrollment.enrolled && !enrollment.welcomeDelivered) throw new Error("The relay did not confirm the welcome message. Inspect private delivery status before claiming activation.");
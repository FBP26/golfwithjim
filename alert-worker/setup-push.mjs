import { createECDH } from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const response = await fetch("https://golfwithjim-alerts.fbp-api-worker.workers.dev/health", { signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error("Unable to verify existing push configuration.");
if ((await response.json()).pushConfigured) {
  console.log("Push keys are already configured; existing device subscriptions are preserved.");
} else {
  const keys = createECDH("prime256v1");
  keys.generateKeys();
  const wrangler = fileURLToPath(new URL("node_modules/wrangler/bin/wrangler.js", import.meta.url));
  const config = fileURLToPath(new URL("wrangler.toml", import.meta.url));
  for (const [name, value] of [["VAPID_PUBLIC_KEY", keys.getPublicKey().toString("base64url")], ["VAPID_PRIVATE_KEY", keys.getPrivateKey().toString("base64url")]]) {
    execFileSync(process.execPath, [wrangler, "secret", "put", name, "--config", config], { input: value, stdio: ["pipe", "inherit", "inherit"], windowsHide: true });
  }
  console.log("Push keys configured securely. Deploy the Worker before enabling devices.");
}
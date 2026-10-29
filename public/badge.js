if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { scope: "./", updateViaCache: "none" })
    .then(() => navigator.serviceWorker.ready)
    .then(registration => registration.active?.postMessage({ type: "clear-app-badge" }))
    .catch(error => console.warn("Tee Times badge setup failed:", error));
}

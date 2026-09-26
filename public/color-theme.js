(() => {
  const key = "tee-times-color-theme";
  try { document.documentElement.dataset.theme = localStorage.getItem(key) === "dark" ? "dark" : "light"; } catch {}
  document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("theme-toggle");
    toggle.checked = document.documentElement.dataset.theme === "dark";
    toggle.addEventListener("change", () => {
      document.documentElement.dataset.theme = toggle.checked ? "dark" : "light";
      try { localStorage.setItem(key, document.documentElement.dataset.theme); } catch {}
    });
    window.addEventListener("storage", event => {
      if (event.key !== key) return;
      document.documentElement.dataset.theme = event.newValue === "dark" ? "dark" : "light";
      toggle.checked = document.documentElement.dataset.theme === "dark";
    });
  });
})();
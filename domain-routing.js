(() => {
  const primaryOrigin = "https://dcsong.com";
  const current = new URL(window.location.href);
  if (current.hostname !== "songdc98.github.io" || current.searchParams.get("stay") === "1") {
    return;
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 2000);
  fetch(`${primaryOrigin}/site-health.json`, {
    mode: "cors",
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    signal: controller.signal,
  })
    .then((response) => response.ok ? response.json() : null)
    .then((health) => {
      if (health?.site !== "songdc98-personal-homepage" || health?.domain !== "dcsong.com") {
        return;
      }
      const latest = new URL(window.location.href);
      if (latest.searchParams.get("stay") === "1") return;
      const destination = new URL(latest.pathname + latest.search + latest.hash, primaryOrigin);
      window.location.replace(destination.href);
    })
    .catch(() => {})
    .finally(() => window.clearTimeout(timeout));
})();

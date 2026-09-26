// Stale-evidence badge: pages older than 90 days get a warning under the title.
document.addEventListener("DOMContentLoaded", () => {
  if (/\/(archive|platform)\//.test(location.pathname)) return; // archives self-flag
  const t = document.querySelector("time[class*='git-revision-date']");
  if (!t || document.querySelector(".hpc-stale")) return;
  const raw = t.getAttribute("datetime") || t.textContent;
  const d = new Date(raw);
  if (isNaN(d)) return;
  const days = Math.floor((Date.now() - d.getTime()) / 864e5);
  if (days <= 90) return;
  const h1 = document.querySelector("article h1");
  if (!h1) return;
  const box = document.createElement("div");
  box.className = "admonition warning hpc-stale";
  box.innerHTML = "<p><strong>\u26a0 Stale evidence</strong> \u2014 last updated " +
    days + " days ago. Verify against the live cluster before acting.</p>";
  h1.insertAdjacentElement("afterend", box);
});

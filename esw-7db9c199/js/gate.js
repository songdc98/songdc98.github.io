/* Access gate for the hosted copy. The world data (scenes, buildings, episodes, catalog, stills, videos, sound clips) is stored encrypted (AES-256-GCM) on the public host; the key is part of the
   link we hand out (#k=...), and a URL fragment is never sent to a server, so a crawler or anyone who only knows the address sees a locked page and ciphertext.
   Files that start with "ESWG" (gzip + encrypted) or "ESWR" (encrypted) are decrypted inside fetch(); media tags written with data-src are filled with decrypted blob URLs.
   A server that holds plain files (the local development server) is not affected. */
(() => {
  const cs = document.currentScript, ES = (window.ES = window.ES || {}), gated = !!document.querySelector('meta[name="esw-gated"]'), G = (ES.gate = { gated });
  const FRAG = /[#&]k=([A-Za-z0-9_-]{43})/;
  let raw = null;
  try { const m = FRAG.exec(location.hash); raw = m ? m[1] : sessionStorage.getItem("esw-k"); if (m) sessionStorage.setItem("esw-k", raw); } catch (e) { const m = FRAG.exec(location.hash); raw = m ? m[1] : null; }
  const b64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
  const keyP = raw && window.crypto && crypto.subtle ? crypto.subtle.importKey("raw", b64u(raw), "AES-GCM", false, ["decrypt"]).catch(() => null) : Promise.resolve(null);
  let locked = false;
  const NOTICE = '<div style="position:fixed;inset:0;display:grid;place-items:center;background:#0e1417;color:#dbe7e8;font:16px/1.5 system-ui,sans-serif;text-align:center"><div><h1 style="font-size:20px;margin:0 0 8px">This page is private</h1><p style="margin:0;opacity:.85">Open it with the full link you were given.</p></div></div>';
  const lock = () => {                                                         // neutral notice instead of the lab; no data is loaded afterwards
    if (locked) return; locked = true; document.title = "Private"; document.body.innerHTML = NOTICE; window.fetch = () => new Promise(() => {});
  };
  G.locked = () => locked;
  if (gated && !raw) { lock(); return; }

  const PROT = /(^|\/)(sim|img|media)\/|placements_[^/?]*\.json/;               // folders whose files are encrypted on the host
  const MIME = { json: "application/json", jpg: "image/jpeg", png: "image/png", mp4: "video/mp4", wav: "audio/wav" };
  const decrypt = async (buf) => {
    const u = new Uint8Array(buf), tag = u.length > 16 ? String.fromCharCode(u[0], u[1], u[2], u[3]) : "";
    if (tag !== "ESWG" && tag !== "ESWR") return null;                          // plain file
    const key = await keyP; if (!key) { lock(); throw new Error("locked"); }
    let plain;
    try { plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(4, 16), additionalData: u.subarray(0, 4) }, key, u.subarray(16)); } catch (e) { lock(); throw new Error("locked"); }
    return tag === "ESWG" ? new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer() : plain;
  };
  const f0 = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!PROT.test(url) || (init && init.method && init.method !== "GET")) return f0(input, init);
    const res = await f0(input, init); if (!res.ok) return res;
    const buf = await res.arrayBuffer(), plain = await decrypt(buf), ext = (/\.([a-z0-9]+)(\?|$)/i.exec(url) || [])[1];
    return new Response(plain || buf, { status: 200, headers: { "Content-Type": MIME[ext] || res.headers.get("Content-Type") || "application/octet-stream" } });
  };

  /* media: G.setSrc(el, url) sets el.src (decrypting on the hosted copy); markup may use data-src="..." instead of src="..." */
  G.setSrc = async (el, url) => {
    if (!gated) { el.src = url; return; }
    try { const r = await window.fetch(url); if (!r.ok) throw new Error("missing"); el.src = URL.createObjectURL(await r.blob()); } catch (e) { el.dispatchEvent(new Event("error")); }
  };
  const fill = (el) => { const u = el.getAttribute("data-src"); if (u && !el._esw) { el._esw = 1; G.setSrc(el, u); } };
  const scan = (n) => { if (n.nodeType !== 1) return; if (n.hasAttribute("data-src")) fill(n); n.querySelectorAll("[data-src]").forEach(fill); };
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach(scan))).observe(document.documentElement, { childList: true, subtree: true });
  scan(document.documentElement);
  /* the hosted page lists the app scripts in data-next and loads them only after the key is present (in order), so a visitor without the link never receives or runs the app */
  for (const u of ((cs && cs.dataset.next) || "").split(",").filter(Boolean)) { const s = document.createElement("script"); s.src = u; s.async = false; document.body.appendChild(s); }
})();

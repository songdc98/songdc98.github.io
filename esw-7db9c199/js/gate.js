/* Access gate for the hosted copy: nothing opens without the password. The public host holds only this script, a small parameter file (salt, iteration count, a check value) and ciphertext:
   the page markup, styles and code (one encrypted bundle) and the world data, stills, videos and sound clips (encrypted files). The password is never stored anywhere; the browser derives the AES-256-GCM
   key from it (PBKDF2-SHA256, many iterations), proves it against the check value, then decrypts the bundle and starts the lab. The derived key is kept in this tab's session storage only, so a reload does
   not ask again and closing the tab forgets it. Files that start with "ESWG" (gzip + encrypted) or "ESWR" (encrypted) are decrypted inside fetch(); media tags written with data-src are filled with
   decrypted blob URLs. A server that holds plain files (the local development server) is not affected. */
(() => {
  const ES = (window.ES = window.ES || {}), gated = !!document.querySelector('meta[name="esw-gated"]'), G = (ES.gate = { gated });
  const enc = new TextEncoder(), dec = new TextDecoder(), sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0)), unb64 = (u) => btoa(String.fromCharCode(...u));
  const MIME = { json: "application/json", jpg: "image/jpeg", png: "image/png", mp4: "video/mp4", wav: "audio/wav" };
  const PROT = /(^|\/)(sim|img|media)\/|placements_[^/?]*\.json/;               // folders whose files are encrypted on the host
  const f0 = window.fetch.bind(window);
  let key = null;                                                               // AES key (CryptoKey, not extractable); null until the password is accepted

  const unseal = async (buf, k) => {                                            // tag(4) + iv(12) + AES-GCM ciphertext; the tag is the associated data
    const u = new Uint8Array(buf), tag = u.length > 16 ? String.fromCharCode(u[0], u[1], u[2], u[3]) : "";
    if (tag !== "ESWG" && tag !== "ESWR") return null;                          // plain file
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u.subarray(4, 16), additionalData: u.subarray(0, 4) }, k, u.subarray(16));
    return tag === "ESWG" ? new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer() : plain;
  };
  const forget = () => { try { sessionStorage.removeItem("esw-k"); } catch (e) {} location.reload(); };
  window.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    if (!PROT.test(url) || (init && init.method && init.method !== "GET")) return f0(input, init);
    const res = await f0(input, init); if (!res.ok) return res;
    const buf = await res.arrayBuffer(); let plain = null;
    if (key) { try { plain = await unseal(buf, key); } catch (e) { forget(); throw e; } }
    const ext = (/\.([a-z0-9]+)(\?|$)/i.exec(url) || [])[1];
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
  if (!gated) return;

  /* ---- password gate (hosted copy only) ---- */
  const STYLE = "<style>html,body{margin:0;background:#0e1417;color:#dbe7e8;font:16px/1.5 system-ui,-apple-system,sans-serif}.esw{position:fixed;inset:0;display:grid;place-items:center;text-align:center;padding:16px}.esw form{width:min(320px,100%)}.esw h1{font-size:20px;margin:0 0 6px}.esw p{margin:0 0 14px;opacity:.85}.esw input{box-sizing:border-box;width:100%;padding:10px 12px;font:inherit;color:#fff;background:#18232a;border:1px solid #3b5560;border-radius:8px;text-align:center;letter-spacing:.12em}.esw input:focus{outline:2px solid #4fc3c7;border-color:#4fc3c7}.esw button{margin-top:10px;width:100%;padding:10px;font:inherit;font-weight:600;color:#04191a;background:#4fc3c7;border:0;border-radius:8px;cursor:pointer}.esw button:disabled{opacity:.6;cursor:default}.esw .m{min-height:1.4em;margin:10px 0 0;font-size:14px;color:#f2ad94}</style>";
  const notice = (html) => { document.title = "Private"; document.body.innerHTML = STYLE + '<div class="esw"><div>' + html + "</div></div>"; };
  const checkKey = async (raw, cfg) => {                                        // the check value is a short known text sealed with the key: a wrong password cannot open it
    try { const k = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]), t = await unseal(b64(cfg.check).buffer, k); return t && dec.decode(t) === "esw-ok" ? k : null; } catch (e) { return null; }
  };
  const derive = async (pw, cfg) => {
    const base = await crypto.subtle.importKey("raw", enc.encode(pw), "PBKDF2", false, ["deriveBits"]);
    return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: b64(cfg.salt), iterations: cfg.iter }, base, 256));
  };
  const start = async () => {                                                   // decrypt the bundle (title, markup, styles, code) and run it
    const r = await f0("app.bin", { cache: "no-cache" }), p = JSON.parse(dec.decode(await unseal(await r.arrayBuffer(), key)));
    document.title = p.title; const st = document.createElement("style"); st.textContent = p.css; document.head.appendChild(st);
    document.body.innerHTML = p.body; const sc = document.createElement("script"); sc.textContent = p.js; document.body.appendChild(sc);
  };
  const ask = (cfg) => {
    document.title = "Private";
    document.body.innerHTML = STYLE + '<div class="esw"><form id="esw-form" autocomplete="off"><h1>This page is private</h1><p>Enter the password to open it.</p><input id="esw-pw" type="password" autocomplete="off" aria-label="Password" autofocus><button type="submit">Open</button><p class="m" id="esw-msg" role="status"></p></form></div>';
    const form = document.getElementById("esw-form"), input = document.getElementById("esw-pw"), btn = form.querySelector("button"), msg = document.getElementById("esw-msg"); input.focus();
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); const pw = input.value; if (!pw) return;
      btn.disabled = input.disabled = true; msg.style.color = "#dbe7e8"; msg.textContent = "Checking…";
      const raw = await derive(pw, cfg), k = await checkKey(raw, cfg);
      if (!k) { await sleep(600); msg.style.color = "#f2ad94"; msg.textContent = "Wrong password."; btn.disabled = input.disabled = false; input.value = ""; input.focus(); return; }
      key = k; try { sessionStorage.setItem("esw-k", unb64(raw)); } catch (e2) {}
      msg.textContent = "Opening…"; start().catch(() => { msg.style.color = "#f2ad94"; msg.textContent = "Could not open the page."; });
    });
  };
  (async () => {
    if (!window.crypto || !crypto.subtle) return notice("<h1>This page is private</h1><p>It needs a secure (https) connection.</p>");
    const cfg = await f0("gate.json", { cache: "no-store" }).then((r) => r.json()); let raw = null;
    try { raw = sessionStorage.getItem("esw-k"); } catch (e) {}
    if (raw) { key = await checkKey(b64(raw), cfg); if (key) return start(); try { sessionStorage.removeItem("esw-k"); } catch (e) {} }
    ask(cfg);
  })();
})();

// SmartRoute: tiny Worker. Stores StepFree community reports (D1, binding DB),
// proxies the free US Census address geocoder (no key) and serves the static app.
const ADMIN_KEY_SHA256 = "1f6c9031ede1d9062ebd7354517d0a53734539b8eaf2ffd7424bf519cf26d86b";
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, x-admin-key", "access-control-max-age": "86400" };
const J = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS, ...extra }
});
const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
async function sha256(s) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, "0")).join("");
}
const KINDS = ["elevator_broken", "no_ramp", "blocked_path", "accessible_entrance", "accessible_bathroom", "step_free_route", "other"];
let ready = false;
async function ensure(env) {
  if (ready) return;
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS reports (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, note TEXT, place TEXT, lat REAL, lon REAL, email TEXT, hidden INTEGER DEFAULT 0, country TEXT)").run();
  ready = true;
}
async function isAdmin(request) {
  const key = request.headers.get("x-admin-key") || "";
  return key && (await sha256(key)) === ADMIN_KEY_SHA256;
}
async function geocodeCensus(q) {
  const u = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=" + encodeURIComponent(q);
  const r = await fetch(u, { headers: { "user-agent": "SmartRoute/1.0 (smartroute.sites.tab.bot)" }, cf: { cacheTtl: 86400, cacheEverything: true } });
  if (!r.ok) return { ok: false, status: r.status };
  const js = await r.json();
  const m = js && js.result && js.result.addressMatches && js.result.addressMatches[0];
  if (!m) return { ok: true, match: null };
  return { ok: true, match: { lat: m.coordinates.y, lon: m.coordinates.x, label: m.matchedAddress, source: "US Census" } };
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p.startsWith("/api/") && request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (p === "/api/geo") {
      const q = clean(url.searchParams.get("q"), 200);
      if (q.length < 4) return J({ ok: false, error: "short" }, 400);
      try { return J(await geocodeCensus(q), 200, { "cache-control": "public, max-age=3600" }); }
      catch (e) { return J({ ok: false, error: "upstream" }, 502); }
    }
    if (p === "/api/report") {
      if (request.method !== "POST") return J({ ok: false, error: "method" }, 405);
      let b; try { b = await request.json(); } catch { return J({ ok: false, error: "bad_json" }, 400); }
      if (b && b.website) return J({ ok: true }); // honeypot
      const rep = {
        kind: clean(b.kind, 40), note: clean(b.note, 600), place: clean(b.place, 150),
        lat: Number(b.lat), lon: Number(b.lon), email: clean(b.email, 150),
        at: new Date().toISOString(), country: (request.cf && request.cf.country) || ""
      };
      if (!KINDS.includes(rep.kind) || !isFinite(rep.lat) || !isFinite(rep.lon) || Math.abs(rep.lat) > 90 || Math.abs(rep.lon) > 180)
        return J({ ok: false, error: "missing_fields" }, 400);
      if (rep.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rep.email)) return J({ ok: false, error: "bad_email" }, 400);
      if (!env.DB) return J({ ok: false, error: "no_store" }, 503);
      await ensure(env);
      const res = await env.DB.prepare("INSERT INTO reports (at, kind, note, place, lat, lon, email, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(rep.at, rep.kind, rep.note, rep.place, rep.lat, rep.lon, rep.email, rep.country).run();
      return J({ ok: true, id: res.meta && res.meta.last_row_id });
    }
    if (p === "/api/reports") {
      if (!env.DB) return J({ ok: false, error: "no_store" }, 503);
      await ensure(env);
      const { results } = await env.DB.prepare("SELECT id, at, kind, note, place, lat, lon FROM reports WHERE hidden = 0 ORDER BY id DESC LIMIT 1000").all();
      return J({ ok: true, count: results.length, reports: results });
    }
    if (p === "/api/admin/reports") {
      if (!(await isAdmin(request))) return J({ ok: false, error: "forbidden" }, 403);
      if (!env.DB) return J({ ok: false, error: "no_store" }, 503);
      await ensure(env);
      if (request.method === "POST") {
        let b; try { b = await request.json(); } catch { return J({ ok: false, error: "bad_json" }, 400); }
        await env.DB.prepare("UPDATE reports SET hidden = ? WHERE id = ?").bind(b.hidden ? 1 : 0, Number(b.id)).run();
        return J({ ok: true });
      }
      const { results } = await env.DB.prepare("SELECT * FROM reports ORDER BY id DESC LIMIT 2000").all();
      return J({ ok: true, count: results.length, reports: results });
    }
    return env.ASSETS.fetch(request);
  }
};

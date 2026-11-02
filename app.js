/* SmartRoute v1 — free map helper. Data: OpenStreetMap (ODbL), routing: OSRM public server,
   addresses: US Census geocoder (via our tiny API), Photon and Nominatim. No API keys. */
(function () {
"use strict";
var API = /sites\.tab\.bot$/.test(location.hostname) ? "" : "https://smartroute.sites.tab.bot";
var OSRM = "https://router.project-osrm.org";
var OVERPASS = ["https://overpass-api.de/api/interpreter", "https://maps.mail.ru/osm/tools/overpass/api/interpreter"];
var MI = 1609.344;
var $ = function (id) { return document.getElementById(id); };
var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
var params = new URLSearchParams(location.search);
var EMBED = params.get("embed") === "1";
if (EMBED) document.body.classList.add("embed");

/* ---------- GoatCounter (David's standard), only on the live hosts ---------- */
if (/(sites\.tab\.bot|github\.io)$/.test(location.hostname)) {
  window.goatcounter = { path: function (p) { return "/smartroute" + p; } };
  var g = document.createElement("script"); g.async = true;
  g.setAttribute("data-goatcounter", "https://kehalkasho.goatcounter.com/count");
  g.src = "https://gc.zgo.at/count.js"; document.body.appendChild(g);
}

/* ---------- crossings (from OpenStreetMap bridge/tunnel geometry) ---------- */
// a = one end, b = other end, m = middle. Each direction gets the right span via an OSRM bearing.
var CROSSINGS = [
  { id: "tz", name: "Tappan Zee (Mario Cuomo) Bridge", short: "Tappan Zee", a: [41.0726, -73.9176], b: [41.0666, -73.8662], m: [41.07093, -73.89221] },
  { id: "gwb", name: "George Washington Bridge", short: "GWB", a: [40.8532, -73.9607], b: [40.8496, -73.9413], m: [40.8516, -73.9525] },
  { id: "vz", name: "Verrazzano Bridge", short: "Verrazzano", a: [40.6020, -74.0592], b: [40.6104, -74.0326], m: [40.60628, -74.04564] },
  { id: "bm", name: "Bear Mountain Bridge", short: "Bear Mountain", a: [41.3200, -73.9879], b: [41.3199, -73.9797], m: [41.3200, -73.9840] },
  { id: "goe", name: "Goethals Bridge", short: "Goethals", a: [40.6416, -74.2063], b: [40.6297, -74.1859], m: [40.6356, -74.1972] },
  { id: "bay", name: "Bayonne Bridge", short: "Bayonne", a: [40.6510, -74.1375], b: [40.6342, -74.1453], m: [40.64226, -74.142] },
  { id: "ob", name: "Outerbridge Crossing", short: "Outerbridge", a: [40.5261, -74.2692], b: [40.5253, -74.2372], m: [40.52448, -74.25339] },
  { id: "hol", name: "Holland Tunnel", short: "Holland Tunnel", a: [40.7301, -74.0362], b: [40.7242, -74.0074], m: [40.7275, -74.0213] },
  { id: "lin", name: "Lincoln Tunnel", short: "Lincoln Tunnel", a: [40.7669, -74.0197], b: [40.7571, -73.9971], m: [40.76292, -74.00967] },
  { id: "nb", name: "Newburgh-Beacon Bridge", short: "Newburgh-Beacon", a: [41.5210, -74.0106], b: [41.5182, -73.9819], m: [41.5196, -73.9962] }
];

/* ---------- settings ---------- */
var SKEY = "smartroute.settings.v1";
var settings = (function () { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { return {}; } })();
settings.avoid = settings.avoid || [];
settings.custom = settings.custom || [];
settings.def = settings.def || "";
function saveSettings() { try { localStorage.setItem(SKEY, JSON.stringify(settings)); } catch (e) {} }
function allCrossings() {
  return CROSSINGS.concat(settings.custom.map(function (c) { return { id: c.id, name: c.name, short: c.name, m: c.m, custom: true }; }));
}

/* ---------- geometry helpers ---------- */
function hav(a, b) { // [lat,lon] meters
  var R = 6371000, toR = Math.PI / 180;
  var dLat = (b[0] - a[0]) * toR, dLon = (b[1] - a[1]) * toR;
  var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(a[0] * toR) * Math.cos(b[0] * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * R * Math.asin(Math.sqrt(x));
}
function bearing(a, b) {
  var toR = Math.PI / 180, y = Math.sin((b[1] - a[1]) * toR) * Math.cos(b[0] * toR);
  var x = Math.cos(a[0] * toR) * Math.sin(b[0] * toR) - Math.sin(a[0] * toR) * Math.cos(b[0] * toR) * Math.cos((b[1] - a[1]) * toR);
  return (Math.atan2(y, x) / toR + 360) % 360;
}
// project point p onto polyline line ([lat,lon] list) using a local flat approximation.
// returns {d: meters off the line, along: meters from start, i: segment index, t, side: +1 right / -1 left}
function makeLine(line) {
  var cum = [0];
  for (var i = 1; i < line.length; i++) cum.push(cum[i - 1] + hav(line[i - 1], line[i]));
  return { pts: line, cum: cum, total: cum[cum.length - 1] };
}
function project(L, p) {
  var pts = L.pts, best = { d: Infinity }, kx = Math.cos(p[0] * Math.PI / 180) * 111320, ky = 110540;
  for (var i = 0; i < pts.length - 1; i++) {
    var ax = (pts[i][1] - p[1]) * kx, ay = (pts[i][0] - p[0]) * ky;
    var bx = (pts[i + 1][1] - p[1]) * kx, by = (pts[i + 1][0] - p[0]) * ky;
    if (Math.min(ax, bx) > best.d || Math.max(ax, bx) < -best.d || Math.min(ay, by) > best.d || Math.max(ay, by) < -best.d) continue;
    var dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy, t = len2 ? -(ax * dx + ay * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = ax + t * dx, cy = ay + t * dy, d = Math.sqrt(cx * cx + cy * cy);
    if (d < best.d) {
      var cross = dx * (-ay) - dy * (-ax); // >0 means point is left of travel direction
      best = { d: d, i: i, t: t, along: L.cum[i] + t * (L.cum[i + 1] - L.cum[i]), side: cross > 0 ? -1 : 1 };
    }
  }
  return best;
}
function pointAt(L, along) {
  along = Math.max(0, Math.min(L.total, along));
  var c = L.cum, lo = 0, hi = c.length - 1;
  while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (c[mid] <= along) lo = mid; else hi = mid; }
  var seg = c[hi] - c[lo] || 1, t = (along - c[lo]) / seg, a = L.pts[lo], b = L.pts[hi];
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
function fmtMin(sec) {
  var m = Math.round(sec / 60);
  if (m < 60) return m + " min";
  var h = Math.floor(m / 60), r = m % 60;
  return h + " h" + (r ? " " + r + " min" : "");
}
function fmtMi(m) { var mi = m / MI; return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + " mi"; }
function ll(p) { return p[0].toFixed(6) + "," + p[1].toFixed(6); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---------- polite fetch queue (public servers ask for low request rates) ---------- */
var lastHit = {};
async function politeFetch(url, opts, host, gapMs) {
  var now = Date.now(), wait = (lastHit[host] || 0) + gapMs - now;
  lastHit[host] = Math.max(now, (lastHit[host] || 0) + gapMs);
  if (wait > 0) await sleep(wait);
  var ctl = new AbortController(), timer = setTimeout(function () { ctl.abort(); }, (opts && opts.timeout) || 25000);
  try { return await fetch(url, Object.assign({}, opts || {}, { signal: ctl.signal })); }
  finally { clearTimeout(timer); }
}
async function getJSON(url, host, gap, opts) {
  for (var attempt = 0; attempt < 3; attempt++) {
    try {
      var r = await politeFetch(url, opts, host, gap);
      if (r.status === 429 || r.status >= 500) { await sleep(1200 * (attempt + 1)); continue; }
      return await r.json();
    } catch (e) { if (attempt === 2) throw e; await sleep(800); }
  }
  throw new Error("The free server is busy. Try again in a minute.");
}

/* ---------- map ---------- */
var map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([41.1, -74.1], 9);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · OSRM'
}).addTo(map);
map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
var layers = { stops: L.layerGroup().addTo(map), route: L.layerGroup(), stepfree: L.layerGroup(), settings: L.layerGroup() };
function numIcon(n, color, size) {
  size = size || 28;
  return L.divIcon({ className: "", iconSize: [size, size], iconAnchor: [size / 2, size / 2],
    html: '<div class="mk" style="width:' + size + "px;height:" + size + "px;background:" + color + '">' + n + "</div>" });
}

/* ---------- tabs ---------- */
var current = "stops";
function showTab(name) {
  current = name;
  document.querySelectorAll(".tb").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === name); b.setAttribute("aria-current", b.dataset.tab === name ? "page" : "false"); });
  document.querySelectorAll(".tab").forEach(function (s) { s.hidden = s.id !== "tab-" + name; });
  Object.keys(layers).forEach(function (k) { if (k === name) map.addLayer(layers[k]); else map.removeLayer(layers[k]); });
  if (name !== "route") setPicking(false);
  if (name === "stepfree") initStepFree();
  if (name === "settings") renderSettings();
  setTimeout(function () { map.invalidateSize(); }, 50);
  try { history.replaceState(null, "", "#" + name); } catch (e) {}
}
document.querySelectorAll(".tb").forEach(function (b) { b.addEventListener("click", function () { showTab(b.dataset.tab); $("panel").scrollTop = 0; }); });

/* ---------- geolocation ---------- */
var myPos = null;
function locate() {
  return new Promise(function (res, rej) {
    if (!navigator.geolocation) return rej(new Error("This phone did not share a location."));
    navigator.geolocation.getCurrentPosition(function (p) {
      myPos = [p.coords.latitude, p.coords.longitude]; res(myPos);
    }, function () { rej(new Error("Location is off. Type the start address instead.")); }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  });
}
function wireGps(btnId, inputId, statusId) {
  $(btnId).addEventListener("click", async function () {
    $(statusId).textContent = "Finding you…"; $(statusId).classList.remove("err");
    try { var p = await locate(); $(inputId).value = "My location"; $(inputId).dataset.gps = ll(p); $(statusId).textContent = "Using your location."; }
    catch (e) { $(statusId).textContent = e.message; $(statusId).classList.add("err"); }
  });
  $(inputId).addEventListener("input", function () { delete $(inputId).dataset.gps; });
}

/* ---------- geocoding: US Census (exact US addresses) → Photon → Nominatim ---------- */
var GKEY = "smartroute.geo.v1.";
function photonLabel(p) {
  var street = [p.housenumber, p.street].filter(Boolean).join(" ");
  var parts = [];
  if (p.name && p.name !== street) parts.push(p.name);
  if (street) parts.push(street);
  parts.push(p.city || p.town || p.village || p.district || p.county || "");
  parts.push([p.state, p.postcode].filter(Boolean).join(" "));
  return parts.filter(Boolean).join(", ");
}
function norm(s) { return String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|court|ct|place|pl|boulevard|blvd|parkway|pkwy|route|rte|highway|hwy|north|south|east|west|n|s|e|w)\b/g, " ").replace(/\s+/g, " ").trim(); }
function streetMatches(typed, p) {
  var m = typed.match(/^\s*(\d+[a-z]?)\s+([^,]+)/i);
  if (!m) return true; // not a street address: a place name or town is fine
  if (!p.street) return false;
  var want = norm(m[2]).split(" ").filter(function (w) { return w.length > 1; });
  var got = norm(p.street);
  return want.length ? want.some(function (w) { return got.indexOf(w) >= 0; }) && (!p.housenumber || String(p.housenumber).toLowerCase() === m[1].toLowerCase()) : true;
}
async function geocode(text, bias) {
  text = String(text || "").trim();
  if (!text) throw new Error("Empty address");
  var mm = text.match(/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
  if (mm) return { lat: +mm[1], lon: +mm[2], label: text, coords: true };
  var ck = GKEY + text.toLowerCase();
  try { var hit = JSON.parse(localStorage.getItem(ck)); if (hit) return hit; } catch (e) {}
  var res = null, approx = null;
  var am = text.match(/(?:^|,\s*)(\d+[a-z]?\s+[^,]+,.+)$/i), addr = am ? am[1].trim() : "";
  var named = addr && addr !== text; // "ShopRite, 415 Route 208, Monroe NY"
  async function census(q) {
    try {
      var c = await getJSON(API + "/api/geo?q=" + encodeURIComponent(q), "api", 50);
      if (c && c.match && streetMatches(q, { street: c.match.label.replace(/^\s*\d+[a-z]?\s+/i, "").split(",")[0], housenumber: (c.match.label.match(/^\s*(\d+[a-z]?)/i) || [])[1] }))
        return { lat: c.match.lat, lon: c.match.lon, label: c.match.label.replace(/\b([A-Z])([A-Z]+)\b/g, function (w, f, r) { return w.length <= 2 ? w : f + r.toLowerCase(); }), source: "census" };
    } catch (e) {}
    return null;
  }
  async function photon(q, check) {
    var b = bias || myPos || [41.0, -74.0];
    var head = norm(q.split(",")[0]), isAddr = /^\s*\d/.test(q);
    var tries = isAddr ? [1, 0] : [0, 1];
    var roadWord = /\b(st|street|ave|avenue|rd|road|blvd|pkwy|parkway|hwy|highway|route|rte|turnpike|tpke|way|lane|ln|dr|drive|ct|court|pl|place)\b/i.test(q);
    for (var tIdx = 0; tIdx < tries.length; tIdx++) {
      try {
        var url = "https://photon.komoot.io/api/?limit=6&lang=en&q=" + encodeURIComponent(q) + (tries[tIdx] ? "&lat=" + b[0] + "&lon=" + b[1] : "");
        var ph = await getJSON(url, "photon", 350);
        var feats = (ph.features || []).filter(function (f) { return !f.properties.countrycode || f.properties.countrycode === "US"; });
        for (var i = 0; i < feats.length; i++) {
          var f = feats[i], pr = f.properties;
          var cand = { lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], label: photonLabel(pr), source: "photon" };
          var hay = norm([pr.name, pr.street, pr.city, pr.town, pr.village, pr.district, pr.county].join(" "));
          var ok = isAddr ? streetMatches(check, pr) : (head && hay.indexOf(head) >= 0 && (roadWord || pr.osm_key !== "highway"));
          if (ok || (named && pr.name && norm(text).indexOf(norm(pr.name)) === 0)) return cand;
          if (!approx) approx = cand;
        }
      } catch (e) {}
    }
    return null;
  }
  if (named) res = await photon(text, addr);
  if (!res && addr) res = await census(addr);
  if (!res) res = await photon(text, text);
  if (!res && named) res = await photon(addr, addr);
  if (!res) {
    try {
      var nm = await getJSON("https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=us&q=" + encodeURIComponent(addr || text), "nominatim", 1100);
      if (nm && nm[0]) res = { lat: +nm[0].lat, lon: +nm[0].lon, label: nm[0].display_name.replace(/, United States$/, ""), source: "nominatim" };
    } catch (e) {}
  }
  if (!res && addr) {
    // street not on the free maps yet: fall back to the town / ZIP, and say so
    var rest = addr.replace(/^\s*\d+[a-z]?\s+[^,]+,/, "").trim();
    try {
      var ph2 = await getJSON("https://photon.komoot.io/api/?limit=1&lang=en&q=" + encodeURIComponent(rest), "photon", 350);
      var f2 = ph2.features && ph2.features[0];
      if (f2) res = { lat: f2.geometry.coordinates[1], lon: f2.geometry.coordinates[0], label: photonLabel(f2.properties), source: "photon", approx: true, note: "street not found, using " + rest };
    } catch (e) {}
  }
  if (!res && approx) { res = approx; res.approx = true; res.note = "closest match"; }
  if (!res) throw new Error('Could not find "' + text + '". Add the town and state.');
  try { localStorage.setItem(ck, JSON.stringify(res)); } catch (e) {}
  return res;
}
async function readPlace(inputId, bias) {
  var el = $(inputId);
  if (el.dataset.gps) { var p = el.dataset.gps.split(",").map(Number); return { lat: p[0], lon: p[1], label: "My location", gps: true }; }
  return geocode(el.value, bias);
}

/* ---------- OSRM ---------- */
function coordStr(pts) { return pts.map(function (p) { return p.lon.toFixed(6) + "," + p.lat.toFixed(6); }).join(";"); }
async function osrmRoute(pts, o) {
  o = o || {};
  var q = "overview=full&geometries=geojson&annotations=duration,distance&steps=" + (o.steps ? "true" : "false") + (o.alternatives ? "&alternatives=3" : "");
  if (o.bearings) q += "&bearings=" + o.bearings.join(";");
  if (o.radiuses) q += "&radiuses=" + o.radiuses.join(";");
  var js = await getJSON(OSRM + "/route/v1/driving/" + coordStr(pts) + "?" + q, "osrm", 260);
  if (!js || js.code !== "Ok") throw new Error(js && js.code === "NoRoute" ? "No driving route found." : "Routing server busy. Try again.");
  return js;
}
async function osrmTable(pts, sources, dests) {
  var q = "annotations=duration,distance";
  if (sources) q += "&sources=" + sources.join(";");
  if (dests) q += "&destinations=" + dests.join(";");
  var js = await getJSON(OSRM + "/table/v1/driving/" + coordStr(pts) + "?" + q, "osrm", 260);
  if (!js || js.code !== "Ok") throw new Error("Routing server busy. Try again.");
  return js;
}
function routeLine(rt) { return rt.geometry.coordinates.map(function (c) { return [c[1], c[0]]; }); }

/* ---------- Google Maps / Waze links ---------- */
function gPlace(p) { return (p.gps || p.coords || p.approx || p.via || !(p.typed || p.label)) ? (p.lat.toFixed(6) + "," + p.lon.toFixed(6)) : (p.typed || p.label); }
function gmapsDir(origin, dest, ways) {
  var u = "https://www.google.com/maps/dir/?api=1&travelmode=driving";
  if (origin && !origin.gps) u += "&origin=" + encodeURIComponent(gPlace(origin));
  u += "&destination=" + encodeURIComponent(gPlace(dest));
  if (ways && ways.length) u += "&waypoints=" + ways.map(function (w) { return encodeURIComponent(gPlace(w)); }).join("%7C");
  return u;
}
function wazeTo(p) { return "https://waze.com/ul?ll=" + p.lat.toFixed(6) + "%2C" + p.lon.toFixed(6) + "&navigate=yes"; }
function gmapsSearch(q, p) { return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q + " " + p[0].toFixed(5) + "," + p[1].toFixed(5)); }
// split a long ordered trip into Google-sized parts (origin + up to 9 waypoints + destination)
function gmapsParts(seq) {
  var parts = [], s = 0;
  while (s < seq.length - 1) {
    var e = Math.min(seq.length - 1, s + 10);
    parts.push({ from: s, to: e, url: gmapsDir(seq[s], seq[e], seq.slice(s + 1, e)) });
    s = e;
  }
  return parts;
}

/* ---------- Stops: best order ---------- */
function solveOrder(D, n, mode) {
  // D[i][j] seconds, node 0 = start. mode: round | open | last (node n-1 fixed as the end)
  var end = mode === "last" ? n - 1 : -1;
  var K = []; for (var i = 1; i < n; i++) if (i !== end) K.push(i);
  var m = K.length;
  function finish(j) { return mode === "round" ? D[j][0] : (mode === "last" ? D[j][end] : 0); }
  if (m === 0) return end > 0 ? [end] : [];
  if (m <= 13) {
    var FULL = 1 << m, INF = 1e15, dp = new Float64Array(FULL * m).fill(INF), par = new Int8Array(FULL * m).fill(-1);
    for (var j = 0; j < m; j++) dp[(1 << j) * m + j] = D[0][K[j]];
    for (var mask = 1; mask < FULL; mask++) {
      for (var j2 = 0; j2 < m; j2++) {
        if (!(mask & (1 << j2))) continue;
        var cur = dp[mask * m + j2]; if (cur >= INF) continue;
        for (var k = 0; k < m; k++) {
          if (mask & (1 << k)) continue;
          var nm = mask | (1 << k), v = cur + D[K[j2]][K[k]];
          if (v < dp[nm * m + k]) { dp[nm * m + k] = v; par[nm * m + k] = j2; }
        }
      }
    }
    var best = INF, bj = -1, fm = FULL - 1;
    for (var j3 = 0; j3 < m; j3++) { var t = dp[fm * m + j3] + finish(K[j3]); if (t < best) { best = t; bj = j3; } }
    var order = [], msk = fm, cj = bj;
    while (cj >= 0) { order.push(K[cj]); var pj = par[msk * m + cj]; msk &= ~(1 << cj); cj = pj; }
    order.reverse();
    if (end > 0) order.push(end);
    return order;
  }
  // larger trips: nearest neighbour + 2-opt (asymmetric-safe)
  var left = K.slice(), path = [], at = 0;
  while (left.length) { var bi = 0; for (var q = 1; q < left.length; q++) if (D[at][left[q]] < D[at][left[bi]]) bi = q; at = left[bi]; path.push(at); left.splice(bi, 1); }
  function cost(p) { var c = D[0][p[0]]; for (var z = 1; z < p.length; z++) c += D[p[z - 1]][p[z]]; return c + finish(p[p.length - 1]); }
  var improved = true, bc = cost(path), guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (var a = 0; a < path.length - 1; a++) for (var b2 = a + 1; b2 < path.length; b2++) {
      var np = path.slice(0, a).concat(path.slice(a, b2 + 1).reverse(), path.slice(b2 + 1));
      var nc = cost(np); if (nc < bc - 1) { path = np; bc = nc; improved = true; }
    }
    for (var a2 = 0; a2 < path.length; a2++) for (var b3 = 0; b3 < path.length; b3++) { // move one stop
      if (a2 === b3) continue;
      var p2 = path.slice(), x = p2.splice(a2, 1)[0]; p2.splice(b3, 0, x);
      var c2 = cost(p2); if (c2 < bc - 1) { path = p2; bc = c2; improved = true; }
    }
  }
  if (end > 0) path.push(end);
  return path;
}
function seqCost(D, seq) { var c = 0; for (var i = 1; i < seq.length; i++) c += D[seq[i - 1]][seq[i]]; return c; }

var stopsState = null;
async function runStops() {
  var st = $("stops-status"), out = $("stops-result");
  st.classList.remove("err"); out.innerHTML = "";
  var lines = $("stops-list").value.split(/\n|\|/).map(function (s) { return s.trim(); }).filter(Boolean);
  var mode = (document.querySelector('input[name="endmode"]:checked') || {}).value || "round";
  if (!lines.length) { st.textContent = "Add at least one stop."; st.classList.add("err"); return; }
  if (lines.length > 25) { st.textContent = "Up to 25 stops in v1. Please split the list."; st.classList.add("err"); return; }
  $("stops-go").disabled = true;
  try {
    st.textContent = "Finding the start…";
    var start;
    if (!$("stops-start").value.trim() && !$("stops-start").dataset.gps) {
      try { await locate(); $("stops-start").value = "My location"; $("stops-start").dataset.gps = ll(myPos); } catch (e) { throw new Error("Type a start address, or tap 📍 to use your location."); }
    }
    start = await readPlace("stops-start"); if (!start.gps) start = Object.assign({ typed: $("stops-start").value.trim() }, start);
    var pts = [start];
    for (var i = 0; i < lines.length; i++) {
      st.textContent = "Finding address " + (i + 1) + " of " + lines.length + "…";
      var g = await geocode(lines[i], [start.lat, start.lon]);
      pts.push(Object.assign({ typed: lines[i] }, g));
    }
    st.textContent = "Comparing every order…";
    var tb = await osrmTable(pts);
    var D = tb.durations, n = pts.length;
    for (var a = 0; a < n; a++) for (var b = 0; b < n; b++) if (D[a][b] == null) throw new Error("Can't drive to: " + (pts[b].typed || pts[b].label));
    var order = solveOrder(D, n, mode);
    var seq = [0].concat(order); if (mode === "round") seq.push(0);
    var typedSeq = [0]; for (var t = 1; t < n; t++) typedSeq.push(t); if (mode === "round") typedSeq.push(0);
    var saved = seqCost(D, typedSeq) - seqCost(D, seq);
    st.textContent = "Drawing the route…";
    var rpts = seq.map(function (k) { return pts[k]; });
    var rr = await osrmRoute(rpts, {});
    var rt = rr.routes[0];
    stopsState = { pts: pts, seq: seq, route: rt, mode: mode };
    drawStops(); renderStops(saved);
    st.textContent = "";
    $("stops-result").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { st.textContent = e.message || String(e); st.classList.add("err"); }
  finally { $("stops-go").disabled = false; }
}
function drawStops() {
  var s = stopsState; layers.stops.clearLayers();
  var line = routeLine(s.route);
  L.polyline(line, { color: "#0b5cff", weight: 6, opacity: .85 }).addTo(layers.stops);
  s.seq.forEach(function (k, idx) {
    if (idx === s.seq.length - 1 && s.mode === "round") return;
    var p = s.pts[k];
    L.marker([p.lat, p.lon], { icon: numIcon(idx === 0 ? "S" : idx, idx === 0 ? "#14213d" : (p.approx ? "#d97706" : "#0b5cff")) })
      .bindPopup('<div class="pop"><b>' + (idx === 0 ? "Start" : "Stop " + idx) + "</b>" + esc(p.typed || p.label) + "</div>").addTo(layers.stops);
  });
  map.fitBounds(L.latLngBounds(line).pad(0.08));
}
function renderStops(saved) {
  var s = stopsState, rt = s.route, out = $("stops-result");
  var seqPts = s.seq.map(function (k) { return s.pts[k]; });
  var parts = gmapsParts(seqPts);
  var h = '<div class="card"><div class="summary"><span class="pill">⏱ ' + fmtMin(rt.duration) + '</span><span class="pill">' + fmtMi(rt.distance) + "</span>";
  if (saved > 60) h += '<span class="pill green">saves ' + fmtMin(saved) + " vs your order</span>";
  h += "</div><p class=\"hint\">Drive time without live traffic. " + (s.mode === "round" ? "Ends back at the start." : s.mode === "last" ? "Ends at your last stop." : "Ends at the last stop below.") + "</p>";
  if (parts.length === 1) h += '<a class="btn big primary" target="_blank" rel="noopener" href="' + esc(parts[0].url) + '">Open in Google Maps</a>';
  else {
    h += '<p class="hint"><b>Google Maps takes about 10 stops at a time</b>, so the trip is split in ' + parts.length + " parts. Open part 1 now, part 2 when you get there.</p>";
    parts.forEach(function (p, i) { h += '<a class="btn big ' + (i ? "" : "primary") + '" target="_blank" rel="noopener" href="' + esc(p.url) + '">Google Maps · part ' + (i + 1) + " (stop " + (p.from || "S") + " → " + (p.to === seqPts.length - 1 && s.mode === "round" ? "start" : p.to) + ")</a>"; });
  }
  var first = seqPts[1];
  if (first) h += '<a class="btn big" target="_blank" rel="noopener" href="' + esc(wazeTo(first)) + '">Next stop in Waze</a>';
  h += '<ol class="stops">';
  var legs = rt.legs;
  seqPts.forEach(function (p, idx) {
    var isBack = idx === seqPts.length - 1 && s.mode === "round";
    var leg = idx > 0 ? legs[idx - 1] : null;
    h += "<li><span class=\"num" + (idx === 0 || isBack ? " start" : "") + '">' + (idx === 0 || isBack ? "S" : idx) + '</span><div class="stop-main"><div class="t">' + esc(idx === 0 ? "Start: " + (p.typed || p.label) : isBack ? "Back to start" : (p.typed || p.label)) + "</div>";
    if (!isBack && p.label && p.label !== p.typed && !p.gps) h += '<div class="s">' + esc(p.label) + "</div>";
    if (p.approx) h += '<div class="s warn">⚠ Approximate: ' + esc(p.note || "check this address") + "</div>";
    if (leg) h += '<div class="s">' + fmtMin(leg.duration) + " · " + fmtMi(leg.distance) + " from the stop before</div>";
    if (idx > 0 && !isBack) h += '<div class="stop-act"><a class="btn small" target="_blank" rel="noopener" href="' + esc(gmapsDir(null, p, [])) + '">Google Maps</a><a class="btn small" target="_blank" rel="noopener" href="' + esc(wazeTo(p)) + '">Waze</a></div>';
    h += "</div></li>";
  });
  h += "</ol></div>";
  out.innerHTML = h;
}
$("stops-go").addEventListener("click", runStops);
wireGps("stops-start-gps", "stops-start", "stops-status");

/* ---------- Route: options side by side + pick my own way ---------- */
var R = { A: null, B: null, options: [], sel: -1, fastest: 0, userVias: [], history: [], picking: false, base: null };
function crossingsUsed(line) {
  var Lg = makeLine(line), used = [];
  allCrossings().forEach(function (c) {
    var pr = project(Lg, c.m);
    if (pr.d < (c.custom ? 180 : 170)) used.push({ c: c, along: pr.along });
  });
  used.sort(function (x, y) { return x.along - y.along; });
  return used.map(function (u) { return u.c; });
}
function mainRoads(rt) {
  var by = {};
  (rt.legs || []).forEach(function (lg) { (lg.steps || []).forEach(function (s) {
    var k = (s.ref || s.name || "").split(";")[0].trim(); if (!k) return; by[k] = (by[k] || 0) + s.distance; }); });
  return Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).slice(0, 3);
}
function optionName(o) {
  if (o.mine) return "My way";
  if (o.crossings.length) return "via " + o.crossings.map(function (c) { return c.short; }).join(" + ");
  return o.roads.length ? "via " + o.roads.slice(0, 2).join(" & ") : "Route";
}
function makeOption(rt, vias, extra) {
  var line = routeLine(rt);
  var o = Object.assign({ route: rt, line: line, vias: vias || [], crossings: crossingsUsed(line), roads: mainRoads(rt) }, extra || {});
  o.name = optionName(o);
  return o;
}
function viaFor(c, A) {
  if (!c.a) return { pt: { lat: c.m[0], lon: c.m[1] }, bearing: "" };
  var nearA = hav([A.lat, A.lon], c.a) < hav([A.lat, A.lon], c.b);
  var from = nearA ? c.a : c.b, to = nearA ? c.b : c.a;
  return { pt: { lat: c.m[0], lon: c.m[1] }, bearing: Math.round(bearing(from, to)) + ",60" };
}
async function routeVia(A, B, vias, bearings) {
  var pts = [A].concat(vias, [B]);
  var js = await osrmRoute(pts, { steps: true, bearings: bearings ? [""].concat(bearings, [""]) : null });
  var rt = js.routes[0];
  var snapped = js.waypoints.slice(1, -1).map(function (w, i) { return Object.assign({}, vias[i], { lat: w.location[1], lon: w.location[0], via: true }); });
  return { rt: rt, vias: snapped };
}
async function runRoute() {
  var st = $("rt-status"); st.classList.remove("err");
  $("rt-options").innerHTML = ""; $("rt-myway").hidden = true; $("rt-stop-card").innerHTML = ""; $("rt-more").innerHTML = ""; $("rt-stop-status").textContent = "";
  R.userVias = []; R.history = []; updateUndo();
  $("rt-go").disabled = true;
  try {
    if (!$("rt-from").value.trim() && !$("rt-from").dataset.gps) {
      if (settings.home) $("rt-from").value = settings.home;
      else { try { await locate(); $("rt-from").value = "My location"; $("rt-from").dataset.gps = ll(myPos); } catch (e) { throw new Error("Type where you start, or tap 📍."); } }
    }
    if (!$("rt-to").value.trim()) throw new Error("Type where you are going.");
    st.textContent = "Finding the addresses…";
    var A = await readPlace("rt-from"); var B = await geocode($("rt-to").value, [A.lat, A.lon]);
    R.A = A; R.B = B;
    st.textContent = "Getting the fastest way…";
    var base = await osrmRoute([A, B], { alternatives: true, steps: true });
    var opts = base.routes.map(function (rt, i) { return makeOption(rt, [], { alt: i }); });
    var straight = hav([A.lat, A.lon], [B.lat, B.lon]);
    if (straight > 3000) {
      var used = {}; opts.forEach(function (o) { o.crossings.forEach(function (c) { used[c.id] = 1; }); });
      var cands = allCrossings().map(function (c) {
        return { c: c, f: (hav([A.lat, A.lon], c.m) + hav(c.m, [B.lat, B.lon])) / straight };
      }).filter(function (x) { return x.f < 1.45 && !used[x.c.id]; }).sort(function (x, y) { return x.f - y.f; });
      if (settings.def) cands.sort(function (x, y) { return (y.c.id === settings.def) - (x.c.id === settings.def); });
      cands = cands.slice(0, 4);
      for (var i = 0; i < cands.length; i++) {
        st.textContent = "Checking the way via " + cands[i].c.short + "…";
        try {
          var v = viaFor(cands[i].c, A);
          var r = await routeVia(A, B, [v.pt], [v.bearing]);
          var o = makeOption(r.rt, r.vias, { forced: cands[i].c });
          if (o.crossings.some(function (c) { return c.id === cands[i].c.id; }) || cands[i].c.custom) opts.push(o);
        } catch (e) { /* skip this crossing */ }
      }
    }
    // dedupe: same crossings and nearly the same time
    opts.sort(function (a, b) { return a.route.duration - b.route.duration; });
    var keep = [];
    opts.forEach(function (o) {
      var sig = o.crossings.map(function (c) { return c.id; }).join("+") + "|" + o.roads.slice(0, 2).join("+");
      if (!keep.some(function (k) { return k.sig === sig || (k.csig === o.crossings.map(function (c) { return c.id; }).join("+") && o.crossings.length && Math.abs(k.route.duration - o.route.duration) < 120); })) {
        o.sig = sig; o.csig = o.crossings.map(function (c) { return c.id; }).join("+"); keep.push(o);
      }
    });
    var fastest0 = keep[0].route.duration;
    keep = keep.filter(function (o, i) { return i === 0 || o.route.duration - fastest0 < Math.max(2700, fastest0 * 0.5); });
    R.options = keep.slice(0, 5); R.fastest = R.options[0].route.duration;
    var pick = 0;
    if (settings.def) { var pi = R.options.findIndex(function (o) { return o.crossings.some(function (c) { return c.id === settings.def; }); }); if (pi >= 0) pick = pi; }
    st.textContent = "";
    selectOption(pick, true);
    $("rt-myway").hidden = false;
    $("rt-options").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) { st.textContent = e.message || String(e); st.classList.add("err"); }
  finally { $("rt-go").disabled = false; }
}
function avoidHit(o) { return o.crossings.filter(function (c) { return settings.avoid.indexOf(c.id) >= 0; }); }
function renderOptions() {
  var h = "";
  R.options.forEach(function (o, i) {
    var diff = o.route.duration - R.fastest, av = avoidHit(o);
    h += '<button type="button" class="opt' + (i === R.sel ? " sel" : "") + '" data-i="' + i + '" aria-pressed="' + (i === R.sel) + '"><div class="l1"><span class="name">' + esc(o.name);
    if (diff < 30) h += '<span class="badge">Fastest</span>'; else h += '<span class="badge slow">+' + Math.max(1, Math.round(diff / 60)) + " min</span>";
    if (settings.def && o.crossings.some(function (c) { return c.id === settings.def; })) h += '<span class="badge pref">★ my pick</span>';
    av.forEach(function (c) { h += '<span class="badge avoid">uses ' + esc(c.short) + "</span>"; });
    h += '</span><span class="time">' + fmtMin(o.route.duration) + '</span></div><div class="l2">' + fmtMi(o.route.distance) + (o.roads.length ? " · " + esc(o.roads.join(", ")) : "") + (o.mine ? " · through your " + o.userCount + " point" + (o.userCount > 1 ? "s" : "") : "") + "</div></button>";
  });
  h += '<p class="hint">Times are without live traffic. Tap an option to choose it.</p>';
  $("rt-options").innerHTML = h;
  $("rt-options").querySelectorAll(".opt").forEach(function (b) { b.addEventListener("click", function () { selectOption(+b.dataset.i); }); });
}
function googleViasFor(o) {
  // every point Google needs so it follows the same way: forced vias, crossings, or a split point vs the fastest route
  var vias = o.vias.slice(), Lg = makeLine(o.line);
  o.crossings.forEach(function (c) {
    if (vias.some(function (v) { return hav([v.lat, v.lon], c.m) < 1500; })) return;
    var pr = project(Lg, c.m), p = pointAt(Lg, pr.along); vias.push({ lat: p[0], lon: p[1], via: true });
  });
  if (!vias.length && R.options.length > 1 && o !== R.options[0]) {
    var F = makeLine(R.options[0].line), best = { d: 0 };
    for (var a = Lg.total * 0.15; a < Lg.total * 0.85; a += Math.max(300, Lg.total / 150)) {
      var p2 = pointAt(Lg, a), d = project(F, p2).d; if (d > best.d) best = { d: d, p: p2 };
    }
    if (best.d > 800) vias.push({ lat: best.p[0], lon: best.p[1], via: true });
  }
  vias.forEach(function (v) { v._along = project(Lg, [v.lat, v.lon]).along; });
  vias.sort(function (x, y) { return x._along - y._along; });
  return vias;
}
function selectOption(i, fit) {
  R.sel = i; var o = R.options[i];
  renderOptions(); drawRoute(fit);
  R.gvias = googleViasFor(o);
  $("rt-gmaps").href = gmapsDir(R.A, R.B, R.gvias);
  $("rt-gmaps").textContent = "Open in Google Maps" + (R.gvias.length ? " (this way)" : "");
  $("rt-waze").href = wazeTo(R.B); $("rt-waze").textContent = "Waze (picks its own way)";
  $("rt-stop-card").innerHTML = ""; $("rt-more").innerHTML = ""; $("rt-stop-status").textContent = ""; gasState = null;
}
function drawRoute(fit) {
  layers.route.clearLayers();
  R.options.forEach(function (o, i) {
    if (i === R.sel) return;
    L.polyline(o.line, { color: "#7b8794", weight: 5, opacity: .55 }).on("click", function (ev) { L.DomEvent.stop(ev); selectOption(i); }).addTo(layers.route);
  });
  var o = R.options[R.sel];
  L.polyline(o.line, { color: "#0b5cff", weight: 7, opacity: .9 }).addTo(layers.route);
  L.marker([R.A.lat, R.A.lon], { icon: numIcon("A", "#14213d") }).addTo(layers.route);
  L.marker([R.B.lat, R.B.lon], { icon: numIcon("B", "#14213d") }).addTo(layers.route);
  R.userVias.forEach(function (v, k) {
    var m = L.marker([v.lat, v.lon], { draggable: true, icon: numIcon("✋", "#e0a100", 30) }).addTo(layers.route);
    m.on("dragend", function () { var p = m.getLatLng(); R.history.push(JSON.stringify(R.userVias)); R.userVias[k] = { lat: p.lat, lon: p.lng }; updateUndo(); rerouteMine(); });
  });
  if (fit) map.fitBounds(L.latLngBounds(o.line).pad(0.08));
}
function setPicking(on) {
  R.picking = on; document.body.classList.toggle("picking", on);
  var b = $("rt-pick"); if (b) { b.setAttribute("aria-pressed", on); b.textContent = on ? "✋ Tapping is ON (tap map)" : "✋ Tap map to add a point"; }
}
function updateUndo() { $("rt-undo").disabled = !R.history.length; $("rt-clear").disabled = !R.userVias.length; }
map.on("click", function (ev) {
  if (current === "route" && R.picking && R.A) {
    R.history.push(JSON.stringify(R.userVias));
    var p = { lat: ev.latlng.lat, lon: ev.latlng.lng };
    // insert where it adds the least straight-line distance
    var chain = [R.A].concat(R.userVias, [R.B]), bi = 0, bc = Infinity;
    for (var i = 0; i < chain.length - 1; i++) {
      var c = hav([chain[i].lat, chain[i].lon], [p.lat, p.lon]) + hav([p.lat, p.lon], [chain[i + 1].lat, chain[i + 1].lon]) - hav([chain[i].lat, chain[i].lon], [chain[i + 1].lat, chain[i + 1].lon]);
      if (c < bc) { bc = c; bi = i; }
    }
    R.userVias.splice(bi, 0, p); updateUndo(); rerouteMine();
  } else if (current === "stepfree") sfMapClick(ev);
});
var mineBusy = 0;
async function rerouteMine() {
  var ticket = ++mineBusy, st = $("rt-status"); st.classList.remove("err");
  R.options = R.options.filter(function (o) { return !o.mine; });
  if (!R.userVias.length) { st.textContent = ""; selectOption(Math.min(R.baseSel || 0, R.options.length - 1)); return; }
  if (R.sel >= 0 && R.options[R.sel]) R.baseSel = R.sel;
  st.textContent = "Routing through your points…";
  try {
    var r = await routeVia(R.A, R.B, R.userVias.map(function (v) { return { lat: v.lat, lon: v.lon }; }), null);
    if (ticket !== mineBusy) return;
    var o = makeOption(r.rt, r.vias, { mine: true, userCount: R.userVias.length });
    R.options.push(o);
    var diff = o.route.duration - R.fastest;
    st.textContent = "My way: " + fmtMin(o.route.duration) + (diff >= 30 ? " (+" + Math.round(diff / 60) + " min vs fastest)" : " (as fast as the fastest)");
    selectOption(R.options.length - 1);
  } catch (e) { st.textContent = e.message; st.classList.add("err"); }
}
$("rt-go").addEventListener("click", runRoute);
$("rt-pick").addEventListener("click", function () { setPicking(!R.picking); if (R.picking) { $("map").scrollIntoView({ behavior: "smooth" }); } });
$("rt-undo").addEventListener("click", function () { if (!R.history.length) return; R.userVias = JSON.parse(R.history.pop()); updateUndo(); rerouteMine(); });
$("rt-clear").addEventListener("click", function () { R.history.push(JSON.stringify(R.userVias)); R.userVias = []; updateUndo(); rerouteMine(); });
$("rt-swap").addEventListener("click", function () {
  var f = $("rt-from"), t = $("rt-to"), fv = f.value, fg = f.dataset.gps;
  f.value = t.value; if (t.dataset.gps) f.dataset.gps = t.dataset.gps; else delete f.dataset.gps;
  t.value = fv; if (fg) t.dataset.gps = fg; else delete t.dataset.gps;
});
wireGps("rt-from-gps", "rt-from", "rt-status");

/* ---------- On my way: next gas / next rest area ---------- */
var FUEL = null, gasState = null;
async function loadFuel() {
  if (FUEL) return FUEL;
  var r = await fetch("data/fuel-ne.json"); FUEL = await r.json(); return FUEL;
}
function inBox(b, p) { return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]; }
async function liveCorridor(line) {
  // outside the bundled Northeast data: ask Overpass for the route corridor (can be slow)
  var boxes = [], step = Math.max(1, Math.floor(line.length / 18));
  for (var i = 0; i < line.length; i += step) {
    var seg = line.slice(i, i + step + 1), la = seg.map(function (p) { return p[0]; }), lo = seg.map(function (p) { return p[1]; });
    boxes.push([Math.min.apply(null, la) - .015, Math.min.apply(null, lo) - .015, Math.max.apply(null, la) + .015, Math.max.apply(null, lo) + .015].map(function (x) { return x.toFixed(4); }).join(","));
  }
  var body = boxes.map(function (b) { return 'nwr["amenity"="fuel"](' + b + ');nwr["highway"~"^(services|rest_area)$"](' + b + ");"; }).join("");
  var q = "[out:json][timeout:60];(" + body + ");out center tags;";
  for (var k = 0; k < OVERPASS.length; k++) {
    try {
      var r = await politeFetch(OVERPASS[k], { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded" }, timeout: 90000 }, "overpass", 1000);
      if (!r.ok) continue;
      var js = await r.json(), fuel = [], services = [];
      js.elements.forEach(function (e) {
        var t = e.tags || {}, la = e.lat != null ? e.lat : e.center.lat, lo = e.lon != null ? e.lon : e.center.lon;
        if (t.amenity === "fuel") fuel.push([la, lo, t.brand || t.operator || "", t.name && t.name !== t.brand ? t.name : ""]);
        else services.push([la, lo, t.name || "", t.highway === "services" ? "s" : "r", t.fuel === "yes" ? 1 : 0, t.operator || ""]);
      });
      return { fuel: fuel, services: services, live: true };
    } catch (e) {}
  }
  throw new Error("The free map-data server is busy. Try again in a minute.");
}
function durationIndex(o) {
  var cum = [0];
  (o.route.legs || []).forEach(function (lg) { var a = lg.annotation && lg.annotation.duration; if (a) a.forEach(function (d) { cum.push(cum[cum.length - 1] + d); }); });
  return cum.length === o.line.length ? cum : null;
}
function timeAhead(o, L2, pr) {
  var cum = o._cum || (o._cum = durationIndex(o));
  if (!cum) return o.route.duration * pr.along / L2.total;
  return cum[pr.i] + pr.t * (cum[pr.i + 1] - cum[pr.i]);
}
var SA_RE = /(service area|service plaza|travel plaza|service center|services|rest area|welcome center)/i;
async function findOnWay(kind) {
  var st = $("rt-stop-status"); st.classList.remove("err"); $("rt-stop-card").innerHTML = ""; $("rt-more").innerHTML = "";
  var o = R.options[R.sel]; if (!o) return;
  st.textContent = kind === "gas" ? "Looking for gas right on your highway…" : "Looking for rest areas on your way…";
  try {
    var Lg = makeLine(o.line), data = await loadFuel();
    var allIn = o.line.every(function (p, i) { return i % 25 || inBox(data.bbox, p); });
    if (!allIn) { st.textContent = "This trip leaves the saved area, asking the live map server (can take up to a minute)…"; data = await liveCorridor(o.line); }
    var la = o.line.map(function (p) { return p[0]; }), lo = o.line.map(function (p) { return p[1]; });
    var box = [Math.min.apply(null, la) - .03, Math.min.apply(null, lo) - .03, Math.max.apply(null, la) + .03, Math.max.apply(null, lo) + .03];
    var services = data.services.filter(function (s) { return inBox(box, s); });
    var fuel = data.fuel.filter(function (f) { return inBox(box, f); });
    var cands = [];
    services.forEach(function (s) {
      var pr = project(Lg, s); if (pr.d > 450 || pr.along < 400) return;
      if (kind === "gas") {
        var near = fuel.filter(function (f) { return hav(s, f) < 520; });
        if (!near.length && s[4]) near = [[s[0], s[1], s[5] || "", ""]];
        near.forEach(function (f) {
          var pt = [f[0], f[1]], pp = project(Lg, pt); if (pp.d > 600 || pp.along < 400) return;
          cands.push({ p: pt, name: f[3] || f[2] || "Gas station", brand: f[2] || "", area: s[2] || "highway service area", pr: pp });
        });
      } else {
        cands.push({ p: [s[0], s[1]], name: s[2] || (s[3] === "s" ? "Service area" : "Rest area"), brand: s[3] === "s" ? "services" : "rest area", area: true, pr: pr });
        if (s[3] === "s") fuel.forEach(function (f) { // the plaza on the other carriageway is often mapped only by its gas station
          if (hav(s, f) > 520) return; var pp = project(Lg, f); if (pp.d > 600 || pp.along < 400) return;
          cands.push({ p: [f[0], f[1]], name: "Highway service area", brand: "services", area: s[2] || true, pr: pp, viaFuel: true });
        });
      }
    });
    if (kind === "gas") fuel.forEach(function (f) { // stations named as highway plazas but not inside a mapped area
      if (!SA_RE.test(f[3] || "")) return;
      var pr = project(Lg, f); if (pr.d > 450 || pr.along < 400) return;
      if (cands.some(function (c) { return hav(c.p, f) < 600; })) return;
      cands.push({ p: [f[0], f[1]], name: f[3], brand: f[2], area: true, pr: pr });
    });
    // merge duplicates (an area mapped twice)
    cands.sort(function (a, b) { return a.pr.along - b.pr.along; });
    var uniq = []; cands.forEach(function (c) { if (!uniq.some(function (u) { return hav(u.p, c.p) < (kind === "gas" || c.viaFuel ? 60 : 250); })) uniq.push(c); });
    if (uniq.length) { st.textContent = "Checking which ones are on your side of the road…"; await addDetours(o, Lg, uniq.slice(0, 30)); }
    var ahead = [];
    uniq.filter(function (c) { return c.detour != null && c.detour <= 300; }).forEach(function (c) {
      var dup = ahead.find(function (u) { return Math.abs(u.pr.along - c.pr.along) < 700; });
      if (!dup) ahead.push(c); else if (c.detour < dup.detour) ahead[ahead.indexOf(dup)] = c;
    });
    var other = uniq.filter(function (c) { return c.detour == null || c.detour > 300; });
    ahead.forEach(function (c) { c.tAhead = timeAhead(o, Lg, c.pr); });
    gasState = { kind: kind, list: ahead, other: other, idx: 0, o: o, Lg: Lg, fuel: fuel, data: data };
    st.textContent = data.live ? "Live OpenStreetMap data." : "";
    renderStopCard();
  } catch (e) { st.textContent = e.message || String(e); st.classList.add("err"); }
}
async function addDetours(o, Lg, list) {
  // local detour: from 2.5 km before the spot, through it, to 2.5 km after, vs. staying on the route
  for (var s = 0; s < list.length; s += 30) {
    var chunk = list.slice(s, s + 30), k = chunk.length, pts = [];
    chunk.forEach(function (c) { var p = pointAt(Lg, c.pr.along - 2500); pts.push({ lat: p[0], lon: p[1] }); });
    chunk.forEach(function (c) { pts.push({ lat: c.p[0], lon: c.p[1] }); });
    chunk.forEach(function (c) { var p = pointAt(Lg, c.pr.along + 2500); pts.push({ lat: p[0], lon: p[1] }); });
    var src = [], dst = []; for (var i = 0; i < 2 * k; i++) src.push(i); for (var j = k; j < 3 * k; j++) dst.push(j);
    var tb = await osrmTable(pts, src, dst), M = tb.durations;
    chunk.forEach(function (c, i) {
      var ps = M[i][i], sq = M[k + i][k + i], pq = M[i][k + i];
      c.detour = (ps == null || sq == null || pq == null) ? null : Math.max(0, ps + sq - pq);
    });
  }
}
function viasWith(extra) {
  var Lg = makeLine(R.options[R.sel].line), all = (R.gvias || []).slice();
  extra._along = project(Lg, [extra.lat, extra.lon]).along; all.push(extra);
  all.sort(function (a, b) { return a._along - b._along; });
  return all;
}
function renderStopCard() {
  var g = gasState, box = $("rt-stop-card"), word = g.kind === "gas" ? "gas" : "rest area";
  if (!g.list.length) {
    box.innerHTML = '<div class="card">No highway ' + (g.kind === "gas" ? "service area with gas" : "rest area") + " is mapped right on this route ahead." + (g.kind === "gas" ? " Tap <b>More options</b> for stations near the route (they need an exit)." : "") + "</div>";
  } else {
    var c = g.list[g.idx], nx = g.list[g.idx + 1];
    var title = c.name + (c.brand && g.kind === "gas" && c.name.toLowerCase().indexOf(c.brand.toLowerCase()) < 0 ? " · " + c.brand : "");
    var areaLine = (g.kind === "gas" || c.viaFuel) && c.area && c.area !== true ? '<div class="meta">At the highway service area' + (c.area !== "highway service area" ? " (OpenStreetMap: " + esc(c.area) + ")" : "") + "</div>" : "";
    var det = Math.round(c.detour / 60);
    var h = '<div class="card stopcard"><div class="meta">' + (g.idx === 0 ? "Next " + word : (g.idx + 1) + (["", "st", "nd", "rd"][g.idx + 1] || "th") + " " + word + " ahead") + " · " + (g.idx + 1) + " of " + g.list.length + "</div>";
    h += '<div class="big">' + esc(title) + "</div>" + areaLine;
    h += '<div class="meta"><b>' + fmtMi(c.pr.along) + " · " + fmtMin(c.tAhead) + " ahead</b> · " + (det <= 1 ? "right on your highway (~0–1 min detour)" : "about " + det + " min detour") + "</div>";
    h += '<a class="btn big gas" target="_blank" rel="noopener" href="' + esc(gmapsDir(R.A, R.B, viasWith({ lat: c.p[0], lon: c.p[1], via: true }))) + '">Go · add as a stop in Google Maps</a>';
    if (g.kind === "gas") h += '<p class="hint">Price: <a target="_blank" rel="noopener" href="' + esc(gmapsSearch(c.brand || c.name, c.p)) + '">Check price</a> · live prices coming in v2</p>';
    h += '<div class="pager"><button type="button" class="btn" id="sc-prev"' + (g.idx ? "" : " disabled") + '>◀ Prev</button><button type="button" class="btn" id="sc-next"' + (nx ? "" : " disabled") + ">Next ▶</button></div>";
    if (nx) h += '<div class="then">then: ' + esc(nx.name) + " in " + fmtMi(nx.pr.along - c.pr.along) + " more</div>";
    h += "</div>";
    box.innerHTML = h;
    $("sc-prev").onclick = function () { if (g.idx) { g.idx--; renderStopCard(); } };
    $("sc-next").onclick = function () { if (g.idx < g.list.length - 1) { g.idx++; renderStopCard(); } };
    var sx = 0; box.firstChild.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
    box.firstChild.addEventListener("touchend", function (e) { var dx = e.changedTouches[0].clientX - sx; if (dx < -60 && g.idx < g.list.length - 1) { g.idx++; renderStopCard(); } else if (dx > 60 && g.idx) { g.idx--; renderStopCard(); } }, { passive: true });
    drawStopMarkers();
  }
  $("rt-more").innerHTML = '<button type="button" class="linkish" id="rt-more-btn">More options' + (g.kind === "gas" ? ": all gas near my route" : "") + "</button>";
  $("rt-more-btn").onclick = function () { g.kind === "gas" ? renderMoreGas() : renderMoreRest(); };
}
var stopMarkers = L.layerGroup();
function drawStopMarkers() {
  stopMarkers.clearLayers(); stopMarkers.addTo(layers.route);
  var g = gasState;
  g.list.forEach(function (c, i) {
    L.marker(c.p, { icon: numIcon(g.kind === "gas" ? "⛽" : "P", i === g.idx ? "#0e7c66" : "#6b9e93", i === g.idx ? 32 : 24) })
      .on("click", function () { g.idx = i; renderStopCard(); }).addTo(stopMarkers);
  });
  var c = g.list[g.idx]; if (c) map.setView(c.p, Math.max(map.getZoom(), 11));
}
function renderMoreRest() {
  var g = gasState, h = '<div class="card"><b>Other rest areas / service areas near the route</b><ul class="morelist">';
  if (!g.other.length) h += "<li>None.</li>";
  g.other.forEach(function (c) { h += "<li><b>" + esc(c.name) + "</b><br><span class=\"hint\">" + fmtMi(c.pr.along) + " along · " + (c.detour == null ? "can't tell the side" : "other side or needs an exit (+" + Math.round(c.detour / 60) + " min)") + "</span></li>"; });
  $("rt-more").innerHTML = h + "</ul></div>";
}
async function renderMoreGas(limitMi) {
  var g = gasState, box = $("rt-more"); limitMi = limitMi || 25;
  var near = g.fuel.map(function (f) { return { f: f, pr: project(g.Lg, f) }; })
    .filter(function (x) { return x.pr.d < 1609 && x.pr.along > 300 && x.pr.along < limitMi * MI; })
    .sort(function (a, b) { return a.pr.along - b.pr.along; });
  var list = near.slice(0, 30).map(function (x) { return { p: [x.f[0], x.f[1]], name: x.f[3] || x.f[2] || "Gas station", brand: x.f[2] || "", pr: x.pr }; });
  box.innerHTML = '<div class="card"><p class="hint">Checking detours for ' + list.length + " stations…</p></div>";
  try { if (list.length) await addDetours(g.o, g.Lg, list); } catch (e) {}
  var h = '<div class="card"><div class="row between wrap"><b>Gas within 1 mile of the route</b><label>Next <select id="more-mi" class="inp" style="width:auto;min-height:40px;padding:6px">' +
    [10, 25, 50, 100].map(function (m) { return '<option value="' + m + '"' + (m === limitMi ? " selected" : "") + ">" + m + " mi</option>"; }).join("") + "</select></label></div>";
  h += '<p class="hint">No live prices in v1 (no free price feed exists). Tap "Check price" to see it on Google Maps.</p><ul class="morelist">';
  if (!list.length) h += "<li>No stations mapped within 1 mile in the next " + limitMi + " miles.</li>";
  list.forEach(function (c) {
    var sa = SA_RE.test(c.name);
    h += "<li><b>" + esc(c.name) + "</b>" + (c.brand && c.brand !== c.name ? " · " + esc(c.brand) : "") + (sa ? ' <span class="badge">highway plaza</span>' : "") +
      '<br><span class="hint">' + fmtMi(c.pr.along) + " ahead · " + (c.detour == null ? "detour unknown" : "+" + Math.max(0, Math.round(c.detour / 60)) + " min detour") + "</span>" +
      '<div class="stop-act"><a class="btn small" target="_blank" rel="noopener" href="' + esc(gmapsDir(R.A, R.B, viasWith({ lat: c.p[0], lon: c.p[1], via: true }))) + '">Go</a><a class="btn small" target="_blank" rel="noopener" href="' + esc(gmapsSearch(c.brand || c.name, c.p)) + '">Check price</a></div></li>';
  });
  box.innerHTML = h + "</ul></div>";
  $("more-mi").onchange = function () { renderMoreGas(+this.value); };
}
$("rt-gas").addEventListener("click", function () { findOnWay("gas"); });
$("rt-rest").addEventListener("click", function () { findOnWay("rest"); });

/* ---------- StepFree (Brooklyn first) ---------- */
var SF = { init: false, layers: {}, on: { yes: 1, limited: 1, no: 1, elevator: 1, subway: 1, report: 1, curbs: 0 }, pin: null, reports: [] };
var WC = { y: ["Accessible", "#11875d"], l: ["Partly accessible", "#d97706"], n: ["Not accessible", "#d63333"], u: ["Not recorded", "#6b7280"] };
function sfPopup(it) {
  var cat = it[2], w = WC[it[3]] || WC.u, name = it[4] || (cat === "e" ? "Elevator" : cat === "s" ? "Subway" : (it[5] || "Place"));
  var h = '<div class="pop"><b>' + esc(name) + "</b>" + (it[5] && cat === "p" ? esc(it[5]) + "<br>" : "") + '<span style="color:' + w[1] + ';font-weight:700">♿ ' + w[0] + "</span>";
  if (it[6]) h += "<br>" + esc(it[6]);
  h += '<br><a target="_blank" rel="noopener" href="' + esc(gmapsDir(null, { lat: it[0], lon: it[1] }, [])) + '">Directions</a><a href="#" data-rep="' + it[0] + "," + it[1] + '">Report a problem here</a>';
  h += '<br><small>Source: OpenStreetMap</small></div>';
  return h;
}
async function initStepFree() {
  if (SF.init) return; SF.init = true;
  map.setView([40.6782, -73.9442], 13);
  var st = $("sf-status"); st.textContent = "Loading Brooklyn accessibility map…";
  ["yes", "limited", "no", "elevator", "subway", "report", "curbs"].forEach(function (k) { SF.layers[k] = L.layerGroup(); });
  try {
    var js = await (await fetch("data/stepfree-bk.json")).json();
    var rend = L.canvas({ padding: .3 });
    js.items.forEach(function (it) {
      var key = it[2] === "e" ? "elevator" : it[2] === "s" ? "subway" : ({ y: "yes", l: "limited", n: "no" }[it[3]]);
      if (!key) return;
      var col = it[2] === "s" ? "#111" : it[2] === "e" ? "#1d6fe0" : WC[it[3]][1];
      var fill = it[2] === "s" ? (WC[it[3]] || WC.u)[1] : col;
      L.circleMarker([it[0], it[1]], { renderer: rend, radius: it[2] === "p" ? 5 : 7, color: it[2] === "s" ? "#111" : "#fff", weight: it[2] === "s" ? 2.5 : 1, fillColor: fill, fillOpacity: .9 })
        .bindPopup(function () { return sfPopup(it); }).addTo(SF.layers[key]);
    });
    st.textContent = js.items.length.toLocaleString() + " places from OpenStreetMap (as of " + js.fetched + "). Green = accessible, orange = partly, red = not.";
  } catch (e) { st.textContent = "Could not load the map data. Check your connection."; st.classList.add("err"); }
  applySfLayers(); loadReports();
}
function applySfLayers() {
  Object.keys(SF.layers).forEach(function (k) { if (SF.on[k]) layers.stepfree.addLayer(SF.layers[k]); else layers.stepfree.removeLayer(SF.layers[k]); });
}
var REPORT_WORDS = { elevator_broken: "Elevator broken", no_ramp: "No ramp / steps only", blocked_path: "Sidewalk or curb cut blocked", accessible_entrance: "Step-free entrance", accessible_bathroom: "Accessible bathroom", step_free_route: "Good step-free way", other: "Other" };
async function loadReports() {
  try {
    var js = await getJSON(API + "/api/reports", "api", 50);
    SF.layers.report.clearLayers();
    (js.reports || []).forEach(function (r) {
      L.circleMarker([r.lat, r.lon], { radius: 9, color: "#fff", weight: 2, fillColor: "#7c3aed", fillOpacity: .95 })
        .bindPopup('<div class="pop"><b>' + esc(REPORT_WORDS[r.kind] || "Report") + "</b>" + (r.place ? esc(r.place) + "<br>" : "") + esc(r.note || "") + "<br><small>Community report, " + esc(String(r.at).slice(0, 10)) + ", not checked yet</small></div>")
        .addTo(SF.layers.report);
    });
  } catch (e) { /* reports are optional */ }
}
document.querySelectorAll("#sf-chips .chip").forEach(function (c) {
  c.setAttribute("aria-pressed", "true");
  c.addEventListener("click", function () { var k = c.dataset.k; SF.on[k] = SF.on[k] ? 0 : 1; c.classList.toggle("on", !!SF.on[k]); c.setAttribute("aria-pressed", !!SF.on[k]); applySfLayers(); });
});
(function addCurbChip() {
  var b = document.createElement("button"); b.className = "chip"; b.type = "button"; b.dataset.k = "curbs"; b.setAttribute("aria-pressed", "false");
  b.innerHTML = '<i class="dot g" style="width:8px;height:8px"></i>Curb ramps';
  b.addEventListener("click", async function () {
    SF.on.curbs = SF.on.curbs ? 0 : 1; b.classList.toggle("on", !!SF.on.curbs); b.setAttribute("aria-pressed", !!SF.on.curbs);
    if (SF.on.curbs && !SF.curbsLoaded) {
      SF.curbsLoaded = true; $("sf-status").textContent = "Loading curb ramps…";
      var js = await (await fetch("data/curbs-bk.json")).json(), rend = L.canvas({ padding: .3 });
      js.items.forEach(function (k) { L.circleMarker([k[0], k[1]], { renderer: rend, radius: 3, stroke: false, fillColor: (WC[k[2]] || WC.u)[1], fillOpacity: .8 }).addTo(SF.layers.curbs); });
      $("sf-status").textContent = js.items.length.toLocaleString() + " curb ramps from OpenStreetMap (green = lowered/flush).";
    }
    applySfLayers();
  });
  $("sf-chips").appendChild(b);
})();
document.addEventListener("click", function (e) {
  var a = e.target.closest && e.target.closest("a[data-rep]"); if (!a) return;
  e.preventDefault(); var p = a.dataset.rep.split(",").map(Number); map.closePopup(); openReport(p);
});
function setPin(p) {
  if (!SF.pin) { SF.pin = L.marker(p, { draggable: true, icon: numIcon("!", "#7c3aed", 30) }).addTo(layers.stepfree); SF.pin.on("dragend", function () { var q = SF.pin.getLatLng(); setPin([q.lat, q.lng]); }); }
  SF.pin.setLatLng(p); SF.pinAt = p;
  $("sf-loc-hint").textContent = "📍 Location set (" + p[0].toFixed(5) + ", " + p[1].toFixed(5) + "). Tap the map or drag the pin to move it.";
}
function openReport(p) {
  $("sf-form").hidden = false; setPin(p || [map.getCenter().lat, map.getCenter().lng]);
  $("sf-form-status").textContent = ""; $("sf-form").scrollIntoView({ behavior: "smooth", block: "start" });
}
function sfMapClick(ev) { if (!$("sf-form").hidden) setPin([ev.latlng.lat, ev.latlng.lng]); }
$("sf-report-btn").addEventListener("click", function () { openReport(); });
$("sf-cancel").addEventListener("click", function () { $("sf-form").hidden = true; if (SF.pin) { layers.stepfree.removeLayer(SF.pin); SF.pin = null; } });
$("sf-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  var fs = $("sf-form-status"), body = { kind: $("sf-kind").value, place: $("sf-place").value, note: $("sf-note").value, email: $("sf-email").value, lat: SF.pinAt[0], lon: SF.pinAt[1], website: $("sf-website").value };
  fs.textContent = "Sending…";
  try {
    var r = await fetch(API + "/api/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    var js = await r.json();
    if (!r.ok || !js.ok) throw new Error(js.error || "failed");
    fs.innerHTML = "✅ Thank you! Your report is on the map as a purple pin (marked “not checked yet”).";
    $("sf-note").value = ""; $("sf-place").value = ""; loadReports();
  } catch (err) {
    var subj = "StepFree report: " + (REPORT_WORDS[body.kind] || body.kind);
    var txt = "What: " + (REPORT_WORDS[body.kind] || body.kind) + "\nPlace: " + body.place + "\nDetails: " + body.note + "\nLocation: " + body.lat.toFixed(5) + "," + body.lon.toFixed(5) + "\nMap: https://www.openstreetmap.org/?mlat=" + body.lat.toFixed(5) + "&mlon=" + body.lon.toFixed(5) + "#map=19/" + body.lat.toFixed(5) + "/" + body.lon.toFixed(5);
    fs.innerHTML = "Could not save it online right now. <a href=\"mailto:david7578433@gmail.com?subject=" + encodeURIComponent(subj) + "&body=" + encodeURIComponent(txt) + "\"><b>Send it by email instead</b></a> (details filled in).";
  }
});
$("sf-live").addEventListener("click", async function () {
  var st = $("sf-status"); st.classList.remove("err");
  if (map.getZoom() < 15) { st.textContent = "Zoom in closer first (a few streets), then tap again."; return; }
  st.textContent = "Asking OpenStreetMap for the latest in this area…";
  var b = map.getBounds(), bb = [b.getSouth(), b.getWest(), b.getNorth(), b.getEast()].map(function (x) { return x.toFixed(5); }).join(",");
  var q = '[out:json][timeout:25];(nwr["wheelchair"](' + bb + ');node["highway"="elevator"](' + bb + '););out center tags;';
  for (var k = 0; k < OVERPASS.length; k++) {
    try {
      var r = await politeFetch(OVERPASS[k], { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "content-type": "application/x-www-form-urlencoded" }, timeout: 40000 }, "overpass", 1000);
      if (!r.ok) continue;
      var js = await r.json(), n = 0;
      js.elements.forEach(function (e) {
        var t = e.tags || {}; if (t.barrier === "kerb") return;
        var la = e.lat != null ? e.lat : e.center.lat, lo = e.lon != null ? e.lon : e.center.lon;
        var w = { yes: "y", designated: "y", limited: "l", no: "n" }[(t.wheelchair || "").split(";")[0]] || "u";
        var cat = t.highway === "elevator" ? "e" : (t.railway === "station" || t.railway === "subway_entrance") ? "s" : "p";
        if (cat === "p" && w === "u") return;
        var it = [la, lo, cat, w, t.name || t.ref || "", t.amenity || t.shop || t.tourism || "", t["wheelchair:description"] || ""];
        var key = cat === "e" ? "elevator" : cat === "s" ? "subway" : ({ y: "yes", l: "limited", n: "no" }[w]);
        L.circleMarker([la, lo], { radius: 6, color: "#fff", weight: 1, fillColor: cat === "e" ? "#1d6fe0" : WC[w][1], fillOpacity: .9 }).bindPopup(function () { return sfPopup(it); }).addTo(SF.layers[key]); n++;
      });
      st.textContent = n + " places loaded live for this area."; return;
    } catch (e) {}
  }
  st.textContent = "The live map server is busy. Try again in a minute."; st.classList.add("err");
});

/* ---------- Settings ---------- */
function renderSettings() {
  $("set-home").value = settings.home || "";
  var sel = $("set-default"); sel.innerHTML = '<option value="">No default — always show me the choices</option>';
  allCrossings().forEach(function (c) { var o = document.createElement("option"); o.value = c.id; o.textContent = c.name; if (c.id === settings.def) o.selected = true; sel.appendChild(o); });
  var av = $("set-avoid"); av.querySelectorAll("label").forEach(function (l) { l.remove(); });
  allCrossings().forEach(function (c) { var l = document.createElement("label"); l.innerHTML = '<input type="checkbox" value="' + esc(c.id) + '"' + (settings.avoid.indexOf(c.id) >= 0 ? " checked" : "") + "> " + esc(c.name); av.appendChild(l); });
  var ul = $("set-custom-list"); ul.innerHTML = "";
  settings.custom.forEach(function (c, i) { var li = document.createElement("li"); li.innerHTML = "<span>" + esc(c.name) + '</span><button class="btn small" type="button">Remove</button>'; li.querySelector("button").onclick = function () { settings.custom.splice(i, 1); saveSettings(); renderSettings(); }; ul.appendChild(li); });
}
$("set-custom-add").addEventListener("click", async function () {
  var n = $("set-custom-name").value.trim(), a = $("set-custom-addr").value.trim(), st = $("set-status"); st.classList.remove("err");
  if (!n || !a) { st.textContent = "Type a name and an address or lat,lon."; return; }
  try { var g = await geocode(a); settings.custom.push({ id: "c" + Date.now(), name: n, m: [g.lat, g.lon] }); saveSettings(); $("set-custom-name").value = ""; $("set-custom-addr").value = ""; renderSettings(); st.textContent = "Added. It will show up as a route option when it fits the trip."; }
  catch (e) { st.textContent = e.message; st.classList.add("err"); }
});
$("set-save").addEventListener("click", function () {
  settings.home = $("set-home").value.trim(); settings.def = $("set-default").value;
  settings.avoid = Array.prototype.map.call($("set-avoid").querySelectorAll("input:checked"), function (i) { return i.value; });
  saveSettings(); $("set-status").textContent = "Saved on this phone ✓";
});

/* ---------- start: URL parameters (?stops=a|b|c&start=…&end=round|open|last&embed=1, ?from=&to=) ---------- */
(function boot() {
  if (settings.home) { $("stops-start").value = settings.home; }
  var stops = params.get("stops");
  var tab = (location.hash || "").replace("#", "");
  if (stops) {
    $("stops-list").value = stops.split("|").map(function (s) { return s.trim(); }).filter(Boolean).join("\n");
    if (params.get("start")) $("stops-start").value = params.get("start");
    var end = params.get("end"); if (end) { var r = document.querySelector('input[name="endmode"][value="' + end + '"]'); if (r) r.checked = true; }
    showTab("stops");
    if (params.get("start") || settings.home) runStops();
  } else if (params.get("to")) {
    if (params.get("from")) $("rt-from").value = params.get("from");
    $("rt-to").value = params.get("to"); showTab("route"); runRoute();
  } else if (["stops", "route", "stepfree", "settings"].indexOf(tab) >= 0) showTab(tab);
  else showTab("stops");
})();
window.SmartRoute = { solveOrder: solveOrder, R: R, get stops() { return stopsState; }, get gas() { return gasState; } };
})();

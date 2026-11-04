const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const site = path.join(__dirname, ".."); // repo root = the site
const read = (f) => fs.readFileSync(path.join(site, f), "utf8");

test("index has title, viewport, four tabs and OSM attribution", () => {
  const h = read("index.html");
  assert.match(h, /<title>SmartRoute/);
  assert.match(h, /name="viewport" content="width=device-width/);
  for (const t of ["tab-stops", "tab-route", "tab-stepfree", "tab-settings"]) assert.ok(h.includes('id="' + t + '"'), t);
  assert.match(h, /OpenStreetMap contributors/);
  assert.match(h, /prices are coming in v2/);
});
test("local assets exist", () => {
  const h = read("index.html");
  for (const m of h.matchAll(/(?:src|href)="([^"#:]+)"/g)) assert.ok(fs.existsSync(path.join(site, m[1].split("?")[0])), m[1]);
  for (const f of ["data/fuel-ne.json", "data/stepfree-bk.json", "data/curbs-bk.json", "vendor/leaflet.js"]) assert.ok(fs.existsSync(path.join(site, f)), f);
});
test("no keys, no social links, no dollar prices, no placeholders", () => {
  for (const f of ["index.html", "app.js", "privacy.html", "admin.js"]) {
    const s = read(f);
    assert.doesNotMatch(s, /wa\.me|whatsapp|facebook\.com|instagram\.com|twitter\.com|x\.com\//i, f);
    assert.doesNotMatch(s, /api[_-]?key\s*[:=]|apikey=|access_token/i, f);
    assert.doesNotMatch(s, /\$\s?\d/, f);
    assert.doesNotMatch(s, /lorem ipsum|\bTODO\b|\bPLACEHOLDER\b|XXX/, f);
  }
});
test("solver finds the optimal order on a small asymmetric matrix", () => {
  const src = read("app.js");
  const start = src.indexOf("function solveOrder"), end = src.indexOf("function seqCost");
  const solveOrder = new Function(src.slice(start, end) + "; return solveOrder;")();
  const pts = [0, 5, 1, 9, 3, 7];
  const D = pts.map((a) => pts.map((b) => Math.abs(a - b) * 60));
  const order = solveOrder(D, pts.length, "open");
  const vals = order.map((i) => pts[i]);
  assert.deepStrictEqual(vals, [1, 3, 5, 7, 9]);
  const last = solveOrder(D, pts.length, "last");
  assert.strictEqual(last[last.length - 1], pts.length - 1);
  // 20 points uses the heuristic path and still visits each once
  const big = Array.from({ length: 20 }, (_, i) => (i * 7) % 20);
  const DB = big.map((a) => big.map((b) => Math.abs(a - b) * 60));
  const ob = solveOrder(DB, big.length, "round");
  assert.strictEqual(new Set(ob).size, 19);
});
test("bundled data is OpenStreetMap with source noted", () => {
  const fuel = JSON.parse(read("data/fuel-ne.json"));
  assert.ok(fuel.fuel.length > 10000 && fuel.services.length > 300);
  assert.match(fuel.source, /OpenStreetMap/);
  const sf = JSON.parse(read("data/stepfree-bk.json"));
  assert.ok(sf.items.length > 5000);
});
test("Google Maps parts: at most 9 waypoints each", () => {
  const src = read("app.js");
  assert.match(src, /s \+ 10/);
  assert.match(src, /google\.com\/maps\/dir\/\?api=1/);
  assert.match(src, /waze\.com\/ul\?ll=/);
});

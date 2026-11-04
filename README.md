# SmartRoute (v1)

Free, mobile-first map helper. Live: https://david7578433-bit.github.io/smartroute/ (copy with the report API: https://smartroute.sites.tab.bot/)

- **Stops**: up to 25 addresses, best order (exact for up to 13 stops, smart search above), round trip / end anywhere / end at last stop, opens in Google Maps (split into parts of 9 waypoints) or Waze.
- **Route**: 3 to 5 options side by side (fastest + via Tappan Zee, GWB, Verrazzano, tunnels...), each opens in Google Maps the same way. "Pick my own way": tap the map to force the route through points (undo, drag).
- **On my way**: "Next gas" / "Next rest area" right on your highway, direction-aware (local detour check), Prev / Next. "More options" lists all gas within 1 mile of the route. No live prices yet (no free feed): "Check price" opens Google Maps.
- **StepFree (Brooklyn)**: accessibility from OpenStreetMap (wheelchair tags, elevators, subway), plus community reports.

URL format: `?stops=addr1|addr2|addr3&start=ADDRESS&end=round|open|last&embed=1` and `?from=A&to=B`.

Data: © OpenStreetMap contributors (ODbL). Routing: OSRM public demo server. Geocoding: US Census, Photon, Nominatim. No API keys.


## Backup / run without Tab

- Live copies: GitHub Pages https://david7578433-bit.github.io/smartroute/ (this repo, `main`, newest) and https://smartroute.sites.tab.bot/
  (same app plus the report API; that copy is one small update older: it does not have the app.js?v=2 pinned-places fix yet).
- The app is static (`index.html`, `app.js`, `styles.css`, `vendor/` Leaflet, `data/`). Run locally: `python3 -m http.server 8000`.
- Server part: `_worker.js` is a Cloudflare Worker that also answers `/api/geo`, `/api/report` (StepFree community reports, saved in a Cloudflare D1
  database, binding `DB`), `/api/reports` and `/api/admin/reports` (admin page). To host it without Tab, use Cloudflare's free plan:
  `npx wrangler d1 create smartroute`, then a `wrangler.toml` with `main = "_worker.js"`, `[assets] directory = "."`, and
  `[[d1_databases]] binding = "DB"` with that database id, put the SHA-256 of your admin key into `ADMIN_KEY_SHA256` at the top of `_worker.js` (it is blanked on GitHub), then `npx wrangler deploy`. On GitHub Pages the reports API is not
  available (Pages has no server), everything else works.
- Tests: `node --test test/site.test.js`. No API keys anywhere.

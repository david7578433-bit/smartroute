# SmartRoute (v1)

Free, mobile-first map helper. Live: https://david7578433-bit.github.io/smartroute/ (copy with the report API: https://smartroute.sites.tab.bot/)

- **Stops**: up to 25 addresses, best order (exact for up to 13 stops, smart search above), round trip / end anywhere / end at last stop, opens in Google Maps (split into parts of 9 waypoints) or Waze.
- **Route**: 3 to 5 options side by side (fastest + via Tappan Zee, GWB, Verrazzano, tunnels...), each opens in Google Maps the same way. "Pick my own way": tap the map to force the route through points (undo, drag).
- **On my way**: "Next gas" / "Next rest area" right on your highway, direction-aware (local detour check), Prev / Next. "More options" lists all gas within 1 mile of the route. No live prices yet (no free feed): "Check price" opens Google Maps.
- **StepFree (Brooklyn)**: accessibility from OpenStreetMap (wheelchair tags, elevators, subway), plus community reports.

URL format: `?stops=addr1|addr2|addr3&start=ADDRESS&end=round|open|last&embed=1` and `?from=A&to=B`.

Data: © OpenStreetMap contributors (ODbL). Routing: OSRM public demo server. Geocoding: US Census, Photon, Nominatim. No API keys.

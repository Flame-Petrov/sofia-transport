# Day and night cycle (3D view)

The **Day and night cycle** switch in the 3D menu makes the tilted map follow Sofia's real time. It is off by default and saved as `sofia_3d_daylight` (`1` = on). Off shows the fixed afternoon the 3D view always had.

## What it changes

| Part | Behavior | Owner |
|---|---|---|
| Sun and moon | Positions for Sofia (42.698° N, 23.322° E) from the standard low-precision series, recomputed every 20 s and when the tab returns. The moon also has a phase. | `src/shared/map/daylight.js` |
| Clock | Device time, replaced by the feed's clock when the two differ by more than two minutes. Lamps use Sofia's wall-clock hour. | `daylight.js` (`clockOffset` is called from `shared/transit/live-feed.js`) |
| Sky, fog and map light | `setSky` and `setLight` follow the sun by day and the moon by night; the light colour darkens the extruded buildings. | `src/features/view3d/daylight-map.js` |
| Basemap colours | Land, water, roads, borders and labels are recoloured from their original style values in steps, a few layers a frame, only when the grade changes. Labels turn light with a dark halo at night. | `daylight-map.js` |
| Sun, moon and stars | Drawn on a canvas over the sky from the camera's bearing and pitch. They appear only when the tilt shows sky. The moon's lit side faces the sun. Stars turn once a sidereal day. | `daylight-map.js` |
| Textured façades | The wall's direction is packed in the fraction of the paint attribute; the shader lights it from the sun or moon. After dark a share of windows (by Sofia hour) glows warm, a few cool. | `solid-facades.js` |
| Bulgarian houses and metro roofs | Vertices carry a normal and a window-light draw. Glass panels light up after dark. | `bulgarian-houses.js`, `metro-canopies.js` |
| Vehicles | Lit from the same light. After dark the cabin glass glows, headlights are white and tail lights red. | `vehicle-models.js` |
| Ground shadows | Each custom layer redraws its triangles flattened onto the ground away from the sun (a point at height h moves by h·(east, south)/up, with the up component floored at 0.12). A stencil keeps overlaps to one layer of darkness. Strength follows the direct light: about 0.3 by day, none at twilight, faint by a bright moon. | `src/features/view3d/shadows.js`, drawn from `solid-facades.js`, `bulgarian-houses.js`, `vehicle-models.js` |

Shadows fall on flat ground only: they are skipped while the terrain switch is on. Plain extruded buildings (textures off) cast none, because their geometry belongs to MapLibre. They darken through the map light and have no lit windows.

## How light reaches the custom layers

`daylight.lighting()` returns `dir` (east, south, up, the axes of Mercator coordinates), `color` (sun or moon), `ambient`, `lamp` (0 by day, 1 in the dark) and `lit` (the share of lit windows). Every custom layer reads it each frame and computes `ambient + color * max(dot(normal, dir), 0)`. With the cycle off `state()` returns a fixed preset, so the same shaders draw the old afternoon.

## Verify

- `node --test tests/*.test.cjs` — `tests/daylight.test.cjs` checks solstice noon altitudes, sunrise and sunset on 10 November, azimuths, new and full moon, lamps, the off preset and when shadows exist.
- `tests/daylight-browser.py OUTPUT_DIR` (the Python 3.12 venv in `old/osm-work`) screenshots two cameras at 12:00, 16:30, 17:30, 00:00 and 06:50 with the cycle on, and off before and after. Add `--standalone` for the numbered release and `--phone` for 390 × 844 at DPR 3.
- To pin the clock by hand, open the page with `?daytime=HH:MM` (Sofia time).
- Physical-phone frame time and appearance after dark remain open.

# Rendering performance and failure tests

## Measured results

The baseline is the hosted page at `dce706d`. The final hosted HTML is 700,268 bytes, down from 4,949,208 bytes (85.9%). These are file sizes before HTTP compression. Release 102 is 4,960,658 bytes and continues to carry the vehicle models and prepared Sofia buildings in the HTML. To deploy the hosted build, serve `index.html`, `tiles/buildings/14/` and `models/` at their generated relative paths. Across all 255 tiles the uncompressed hosted files total 5,109,895 bytes. Each matched its decompressed standalone counterpart byte-for-byte. The startup saving shifts bandwidth to the areas a rider visits in 3D. Actual transfer size depends on the host’s HTTP compression.

| Workload | Before | After |
| --- | ---: | ---: |
| 200 vehicles on the flat map with ten in the viewport, attached Leaflet markers | 200 | 10 |
| 20 subpixel camera changes over the same Sofia buildings, bytes submitted by the house and canopy upload call | 99,669,600 to 104,653,080 across runs | 0 in each rebuilt version |
| 50 generated houses, 60 camera frames covering the same features, repeated uploads after the first 3,779,136-byte upload | 4 uploads, 15,116,544 bytes | 0 uploads |
| 300 settled vehicles, 240 animation ticks, vehicle registry visits | 72,000 | 0 |
| Same 240 ticks, vehicle pose evaluations | 25,500 | 0 |
| 1,002-point route shape, candidate segments for the sampled fix | 1,001 | Fewer than 80 |

The Chrome replay uses Leaflet 1.9.4, MapLibre GL JS 4.7.1, a 390 × 844 viewport at DPR 2 with SwiftShader enabled. It enters 3D through the map control, enables house designs and places a bus near 23.322 E, 42.698 N at MapLibre zoom 16.3 and pitch 55°. The street style and feed are controlled. Buildings come from the shipped Sofia tiles. Each camera step alternates longitude by 0.00000001° and waits 150 ms. The counter measures bytes passed to the building-layer WebGL upload call after warm-up. Initial uploads vary with tile arrival order. The original renderer throttled rebuilds, so small timing differences changed how many fell inside each run. Moving 0.006° east subsequently causes a fresh upload in each rebuilt version.

The hosted replay requested two prepared tiles and only the bus GLB. It requested no local 3D assets before entering 3D. Release 102 requested neither a building file nor a model file. Both versions showed a modeled bus, opened a stop sheet from a 3D map tap, accepted their first simulated GPS fix in 3D, and restored the stop and location markers on return to 2D.

## Changes and failure cases

| Area | Change and verification |
| --- | --- |
| 2D vehicles | `features/vehicles/motion.js` tracks active plans and retires them at their endpoint. `features/search/render.js` limits ordinary markers to a padded viewport. Routed and selected vehicles stay available. The tests wake a settled bus, move an offscreen bus back on screen and check its actual endpoint. |
| Vehicle projection | The motion planner indexes segments of long shapes on first use. It includes unusually long segments separately and keeps the original segment order for ties. The indexed result matched the exhaustive result for 150 combinations of position, heading and prior distance. |
| 3D buildings | `bulgarian-houses.js`, `solid-facades.js` and `metro-canopies.js` reuse visible geometry. Reordered features can reuse an upload. Geometry, height, material class on façades, terrain and a coordinate-origin change can invalidate the applicable cache. Tests cover changed heights, terrain source updates and an empty viewport. |
| 3D vehicles and labels | `view.js` skips settled fleet rebuilds, limits distant refreshes, and omits ordinary modeled vehicles from redundant GeoJSON. It caches up to 256 line badge images per map. Rail matching runs when a visible tram needs it. `vehicle-models.js` requests eligible model types, shares in-flight requests, retains decoded vertices and creates GPU buffers per context. A failed request leaves the symbol available. A regression test verifies retry and decoding after recovery. |
| Stops and GPS | `your-stop.js` supplies ordinary stop records to both maps. A newly visible ordinary 3D stop allocates its Leaflet marker on tap. Route and focused stops retain their special markers. `location.js` and `follow-camera.js` skip hidden Leaflet location updates. Chrome checked the stop sheet, simulated GPS and marker restoration across a mode switch. |
| Feed updates | `shared/transit/live-feed.js` applies vehicle positions without waiting for trip predictions. Repeated position timestamps update freshness. Late trip responses can enrich the latest records, and an older response cannot replace a newer successful one. The malformed-payload test checks that all previous trip indexes remain usable. |
| Journey planning | `features/journeys/planner.js` binary-searches unchanged scheduled trips and scans predicted trips independently. The boarding window uses effective time. In a reproduced case the first departure arrived at 7,500 seconds, while a later one arrived at 6,900. Tests cover overtaking, skipped stops, early and late trips, banned vehicles and the inclusive 90-minute boundary. A further 180 generated one-ride cases match exhaustive boarding. |
| Offline areas | `shared/storage/cache.js`, `shared/map/base-map.js` and `features/offline/areas.js` distinguish having network bytes from successfully committing the retained tile. An aborted transaction and a failed promotion leave the area incomplete. A later successful sync recovers it. |

Source paths in the table are under `src/`. The 3D rendering modules are under `src/features/view3d/`.

## Research behind the changes

- Leaflet’s Canvas renderer walks its registered draw order and checks bounds during redraw and hit testing. Detaching ordinary offscreen layers reduces that work even when several hundred dots share one canvas. [Leaflet 1.9.4 Canvas implementation](https://github.com/Leaflet/Leaflet/blob/v1.9.4/src/layer/vector/Canvas.js)
- MapLibre recommends partitioning large data geographically and separating content with different update rates. In the pinned renderer, a GeoJSON source update can also send work to a worker. This supports geographic building tile delivery, separate distant vehicles and avoiding redundant source submissions. [MapLibre large-data guide](https://maplibre.org/maplibre-gl-js/docs/guides/large-data/) · [MapLibre 4.7.1 GeoJSON source](https://github.com/maplibre/maplibre-gl-js/blob/v4.7.1/src/source/geojson_source.ts)
- WebGL batching reduces draw-call overhead. The existing building batches were already shareable across camera matrices. Reusing the uploaded vertex data addressed the measured bottleneck. Repeated line numbers fit the canvas technique of pre-rendering repeated content to a small offscreen surface. [WebGL best practices](https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices) · [Canvas optimization](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)
- RAPTOR scans transit routes round by round. Sofia’s timetable compiler separates scheduled trips that overtake into distinct patterns. Live updates can break that ordering after compilation, which requires independent evaluation of updated trips. [Original RAPTOR paper](https://www.microsoft.com/en-us/research/publication/round-based-public-transit-routing/)
- IndexedDB’s transaction can abort after an individual write request succeeds. The transaction completion event signals that its changes have committed. That is the event the offline readiness counter now uses. [IndexedDB transaction commit](https://www.w3.org/TR/IndexedDB-3/#commit-transaction)

## Reproduction

From the workspace root, run the build, consistency check and Node regression suite.

```sh
python site/build.py
python site/build.py --check
node --test site/tests/*.test.cjs
```

The verification run passed all 32 Node tests, the JavaScript syntax check on both artifacts, and the byte-for-byte build check for 257 outputs. The launcher served release 102 at both `/` and `/102_public-transport.html` with SHA-256 `c3a8abf66a4f8c62c433b65313d2fcd7392aac08961621c3f94a622ff8e74dcb`.

The optional browser comparison requires Python Playwright, an installed Chrome, and access to the app's pinned library CDNs. It uses a temporary loopback server, fresh browser contexts and in-memory instrumentation. Run it in the full workspace so the numbered page is present.

```sh
python site/tests/rendering-browser.py --baseline dce706d
python serve.py --no-open
```

## Remaining costs

A camera move can still trigger a throttled visible-feature query and serialization of footprint keys. Crossing a coverage boundary rebuilds and uploads the changed visible batch. Vehicle meshes still issue a draw per visible vehicle. Label placement still projects and draws visible badges on MapLibre renders. A physical-phone trace during a long pan or a crowded moving-fleet follow would distinguish these costs and establish frame-time percentiles and memory pressure. The byte and operation counters above measure the work removed under the stated workloads.


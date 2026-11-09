# Sofia Live Transport agent roadmap

Read the standing rules and the current handoff before editing. Paths in this guide are relative to the directory containing this file.

## Standing navigation rules

1. Start from a rider action and an entry point. Reproduce the symptom on the local launcher or the hosted page and record the viewport, map mode, and live or timetable data involved when relevant.
2. Edit the owning feature under `src/features/`. Keep its interactions, feature-specific markup, and styling together. Put behavior used by multiple features under `src/shared/`. A feature decides when to follow a vehicle. The shared camera moves the map.
3. Trace both directions before changing a cross-feature operation. Search the source for its definition and callers, including open popups, phone sheets, live refresh, and the 3D view where applicable. For example, run `rg -n "arrivalsAt|guessArrival|stopPopupHtml" src` from this directory.
4. Use `src/page.html` to see the exact markup, stylesheet cascade, and script initialization order. An include occupies a whole line, for example `{{include features/places/places.js}}`. Add each HTML, CSS, or JS source file once. JS is assembled inside one private application function to preserve the standalone phone release. Keep new feature state private and expose a small API to consumers. The saved places implementation is a working example.
5. Edit the source, then regenerate the outputs. `python build.py` builds the hosted page and, when the workspace launcher is present, the numbered local page. `python build.py --check` verifies both without writing. In a standalone checkout of this directory the command verifies the hosted page. Historical numbered releases are reference snapshots. To cut a new one, advance `LOCAL_RELEASE` in the builder.
6. Before handing off, verify the interaction through its normal entry point. Record changes to paths, behavior, and checks in the editable section below. Update standing rules only when the user asks for a policy or workflow change.

7. Every change that adds, modifies, or removes an implementation must update its documentation in the same change. Update the relevant guide, or create one under `docs/` if none exists. Describe the resulting behavior, identify the source files that own it, and explain how to verify it. Before handoff, check the guide against the code and link it from the dated handoff entry.

### Adding a feature

Define one observable success case. Extend the existing owner when the action belongs to it. For a new capability, create a folder named for the rider action, give it one entry point, and register its files in the page template. Keep listener and timer registration with its owner. Exercise opening, closing, and reopening the feature and test persistence after reload if it stores data.

### Changing a feature

Find the action handler and its rendering paths. For a vehicle card, follow initial rendering and the in-place live update. Check both desktop popup and phone sheet when they display the same data. For visual work, consult the applicable files in the workspace's `design spec/` and `design images/` directories.

### Debugging a feature

Follow one vehicle ID, stop ID, or saved place from input to stored state to displayed result. Fix the first incorrect value. For a wrong stop ETA, compare the result of `arrivalsAt` with the time rendered in the popup before changing the calculation. If the fix is shared, exercise a second consumer. Preserve stored keys and the ability to load existing records.

## Current roadmap and handoff

<!-- AGENT-HANDOFF:START -->

**2026-11-09 — [Larger residential buildings](docs/3d-building-textures.md).** Added five size-selected designs under the Bulgarian houses and apartments switch. Check the next size tier on rectangular residential blocks at zoom 18.

**2026-11-09 — [Metro carriage turns](docs/vehicle-models.md).** The 3D metro model samples its timetable path at the carriage ends and pivots on every moving frame. A controlled replay of the numbered build covered 801 frames each on left and right bends, including both termini. Live WebGL appearance remains unverified.

**2026-11-09 — [House materials](docs/3d-building-textures.md).** Modeled houses use their design palette with either building texture setting.
**Editable by future agents.** Keep this section current. After a task, update the affected owner or next step and add a dated handoff with the change, verification performed, and anything still open. Replace superseded entries. Keep durable rules above the marker.

| Work area | Start here in src/ | Follow into |
|---|---|---|
| App startup and refresh | `page.html`, `config.js`, `main.js` | `shared/transit/live-feed.js`, `shared/ui/loading.js` |
| Vehicle markers, cards, selection, movement | `features/vehicles/` | `popup.js` for rendering and refresh, `focus.js` for selection, `follow.js` for follow mode, `shared/map/follow-camera.js` for movement |
| Stops and ETAs | `features/stops/popup.js`, `features/stops/your-stop.js` | `shared/transit/arrivals.js`, `shared/transit/timetable.js`, `shared/ui/sheet.js` |
| Places, pin menus, and saved destination | `features/places/places.js` | The `savedPlaces` API, `shared/ui/name-dialog.js`, `shared/storage/preferences.js` |
| Device location and compass | `features/location/location.js` | `shared/map/follow-camera.js` |
| Journey planning and active guidance | `features/journeys/planner.js`, `features/journeys/guidance.js` | `walking.js` for street paths, `route-map.js` and `card.js` for presentation |
| Downloaded map areas and tiles | `features/offline/areas.js` | `shared/map/` for base map and viewport preloading, `shared/storage/cache.js` for IndexedDB |
| Tilted map, terrain, and 3D markers | `features/view3d/view.js` | Same feature's CSS and menu, plus the owning 2D feature for underlying data |
| Search, filters, and panel behavior | `features/search/`, `features/panel/` | `shared/ui/theme.css` for common styling |
| Diagnostics and performance | `features/diagnostics/report.js`, `features/diagnostics/performance.js` | The feature producing the reported value |

**Release workflow.** The workspace launcher serves release 102 at `/`. The hosted artifact is `index.html`. Both are built from the same source. For phone or CDN-dependent checks, report which interactions actually ran.

**Next work.** Existing vehicle, stop, and journey files still share some application-scope state. When a task touches one of these boundaries, migrate the affected operation behind its owner's API, update callers together, and verify a live refresh. Keep unrelated migrations separate.

**2026-11-06 — Feature-first migration.** Extracted release 101 into feature and shared source. Verified that the initial extraction reassembled byte for byte. Moved saved-place state behind `savedPlaces` and connected journeys, location, diagnostics, and 3D callers. Build 102 includes these changes.

**Verification for 102.** Build check and JavaScript syntax passed. Headless Chrome loaded the launcher at desktop width and the hosted artifact at phone width. Both restored a pre-existing pin, saved a rename through reload, created a second pin on the map, deleted it, and toggled a transport filter. Live arrivals, vehicle follow, GPS, and WebGL terrain still need an interactive check when work touches those paths.
**2026-11-06 — 2D and 3D frame time.** Vehicle position updates live in `features/vehicles/motion.js`, tracked route head/tail updates in `features/vehicles/runs.js`, marker attachment in `features/search/render.js`, and 3D source snapshots in `features/view3d/view.js`. The WebGL pixel-density policy is shared with the base map. With 100 stationary vehicles the four-second Chrome test went from 48,400 Leaflet marker writes and 60 fleet source submissions to zero in each view. Moving-fleet checks used a 412 × 915 viewport at DPR 3 with 4× CPU throttling. Tested live refresh, route selection, 3D Follow, return to 2D, and opening the raw diagnostics report. Screenshots are in the workspace's `debug images/Vehicle rendering FPS/`. The original 5 FPS observation still needs a measurement on the affected device.
**2026-11-06 — Mobile pinch zoom.** Touch devices keep fractional zoom in `shared/map/base-map.js`. Location follow pauses camera movement during a pinch in `shared/map/follow-camera.js`, and `features/view3d/view.js` respects the flat map's zoom precision on return. Tested the numbered release on the vector map in Chrome touch emulation (390 × 844, DPR 3). A 25% spread and its reverse previously both settled at 13. They now settle at 13.322 and 13. The +/− controls changed zoom by one level, page scale stayed at 1, simulated GPS follow stayed on, and a pinch in 3D returned to 2D at fractional zoom. Physical handset testing remains open.
**2026-11-06 — Compass transition.** The compass control in `shared/map/base-map.js` has an expandable slot styled in `features/view3d/view.css`. The mode toggle slides as the compass fades, and the closed compass is inert. Tested both mode switches through the numbered release in Chrome touch emulation at 390 × 844. Frame samples showed the toggle moving smoothly over 57 px with the location control stationary. Reduced motion switched directly to each final position.
**2026-11-06 — Page zoom during the 3D switch.** The persistent `#map` rule in `shared/ui/base.css` owns `touch-action: none` across both modes. On release 102 in Chrome touch emulation (390 × 844, DPR 3), opening 3D during a zoom animation and pinching through the switch kept the page at 100%, compared with 161% before the fix. Map pinch zoom worked in both modes and page scale stayed at 100% on return to 2D. Build and artifact checks passed. Physical handset verification remains open.

**2026-11-06 — Street map restored.** Removed the local aerial-texture prototype, crop, preparation script and debug previews. Rebuilt and checked both artifacts. In 412 × 915 Chrome emulation the former pilot URL opened Street, made zero aerial requests, and the deleted image returned HTTP 404. Tram 4 (#TM2349) stayed selected through 2D, tilted 3D and back.
**2026-11-06 — Route cancellation and phone sheet.** Ending a journey clears its matching active destination in `features/journeys/route.js`. The route sheet in `features/journeys/card.js` collapses to a bottom bar and reopens by swipe or tap. Release 102 passed a Chrome touch check at 390 × 844 with simulated GPS, including downward and upward swipes, tap controls, height-only resize, cancel, line removal, and saved pin retention. Desktop route open and close also passed. Physical handset and active transit guidance were not exercised.

**2026-11-08 — 3D building textures.** The saved menu switch, patterns and bundled Sofia building tiles live under `src/features/view3d/`. The [building texture guide](docs/3d-building-textures.md) records the OSM extract, footprint measurements, reviewed monuments and regeneration command. Verified all four materials in MapLibre, consistent classes for 3,757 footprints shared by tiles, keyboard operation, reloads, terrain, cached rendering and toggling with a followed vehicle’s popup open. The numbered release and hosted artifact passed the build check. Desktop and 390 × 844 Chrome comparisons are in the workspace’s `debug images/3D building textures/`. Frame time and memory on a physical phone remain open.
**2026-11-08 — Offscreen street tiles.** The startup preload and moving viewport use the highest native source zoom when zoomed in farther. The active 2D or 3D camera feeds a bounded, direction-aware queue in `shared/map/viewport-cache.js`. Both release artifacts passed the build check. A controlled tile I/O test covered zoom 18, switching cameras during requests and recovery from a failed request. Cold-cache and warm-cache drag comparisons on a physical phone remain open.
**2026-11-08 — Metro station timetables.** The active service-day index passes metro patterns to `features/stops/metro.js`. Station markers are available from zoom 13, or zoom 11 for a line search or a Metro-only filter. Tapping a station shows the next hour by line and destination with Sofia clock times. Time-only arrivals use the timetable style. Tested M2 at European Union in desktop 2D and 3D, M1/M4 at Serdika on a 390 × 844 phone layout, and countdown updates. The workspace report `reports/Sofia Metro station times - 2026-11-08.txt` contains that service day's 50 stations and 12,776 calls.
**2026-11-08 — Implementation documentation.** Added standing rule 7 and confirmed the workspace guide directs agents to these rules.
**2026-11-08 — Marker card timing.** Stop and vehicle marker clicks wait for camera arrival in both map modes. Both release artifacts passed the build check. Headless Chrome clicked a synthetic desktop stop marker in 2D and observed the popup closed during the click and open afterward. Live vehicle clicks, the phone sheet, and tilted-view timing still need interactive verification. The [marker camera guide](docs/marker-camera.md) lists the owners and interaction checks.
**2026-11-08 — Building palette.** Raised textured opacity to 0.92 and increased saturation for all four textures and updated the documented swatches. Earlier screenshots show the previous palette.
**2026-11-08 — Frame-rate investigation.** The workspace report `reports/Pushed build FPS/Report.md` contains live Chrome measurements, CPU sample summaries and screenshots. Cold-start stalls coincided with static GTFS decompression and eager route-shape parsing on both pushed revisions. The static-feed isolation control and settled 2D drag ran at 60 FPS in the phone layout. Start with `src/shared/transit/static-feed.js` and `src/features/vehicles/route-line.js`. Sustained frame rate on the affected handset remains open.

**2026-11-08 — Static transit startup.** The [startup data guide](docs/startup-transit-data.md) describes the worker paths for static tables, route shapes and the service-day index, including their fallbacks. Built and checked both artifacts. In a 4× CPU comparison with the map ready, the slowest sampled window during archive processing improved from 49.2 to 57.7 FPS. All 24 deterministic timetable fields matched the original. Opened the same live tram in both releases and verified the worker fallback. The workspace report is `reports/Startup fix/Report.md`. A separate unthrottled cold load still had a 167 ms frame.

**2026-11-08 — [Recenter map on Sofia](docs/recenter-map.md).** Built and checked both artifacts. In headless Chrome on release 102, the visible control returned the 2D map from zoom 16 to the startup coordinates at zoom 13. Tilted view and physical phone verification remain open.

**2026-11-08 — Vehicle models.** The tram now has a low skirt and recessed undercarriage. Restyled the three standalone GLBs as cast-pewter playing pieces. Generated a geometry preview from all three binaries and verified their GLB headers. See the [vehicle model guide](docs/vehicle-models.md).

**2026-11-08 — [Follow from stop arrivals](docs/marker-camera.md).** Stop arrival buttons now pan at the current zoom in both map modes and start vehicle follow directly, including for an already selected vehicle. Journey buttons and the explicit stop progress overview keep their previous behavior.


**2026-11-08 — [Live 3D vehicle models](docs/vehicle-models.md).** Both releases embed the three GLBs. Nearby surface vehicles use their marker color and display their line number above the mesh from MapLibre zoom 16. Build, artifact and JavaScript syntax checks passed.

**2026-11-08 — [Surface vehicle geometry and heading](docs/vehicle-models.md).** Rebuilt the three meshes and retained monochrome vehicle tints with material shading. Trams use the directed trip shape where available. Built and checked both releases, checked JavaScript syntax, and exercised all three vehicle types on the live fleet in desktop Chrome.

**2026-11-08 — [Trams on mapped rails](docs/vehicle-models.md).** Close-zoom tram models use the basemap track geometry for position and orientation. Verified both releases and JavaScript syntax. In desktop Chrome, live tram 27 moved 1.6 metres onto a mapped rail. Screenshot in the workspace under `debug images/Tram on rails/`.

**2026-11-08 — [Tram body skirt](docs/vehicle-models.md).** Removed tram wheels and hubs from the mesh generator. Rebuilt the GLB, geometry preview and both checked releases.

**2026-11-08 — [Tram articulation](docs/vehicle-models.md).** Section headings follow forward and rear rail samples; the WebGL layer rotates the front and rear around their bellows. Both releases and JS syntax passed. Controlled left/right and reverse traversal checks confirmed the calculated angles, and desktop Chrome exercised the live 3D layer.

**2026-11-08 — [Bus direction](docs/vehicle-models.md).** Bus and trolleybus models use the motion plan for orientation. Verified both builds, turns, stops and trip changes. In Chrome, bus A1209 moved 5.9 m at 220.79° and its model faced 220.80° with no feed bearing.

**2026-11-08 — [Fixed ground size for 3D vehicles](docs/vehicle-models.md).** All three meshes now use 1.8 ground metres per mesh unit. Tram articulation uses that scale and body hit targets follow the projected vehicle length. Both release artifacts and JavaScript syntax passed verification.

**2026-11-08 — [Dismiss vehicle details on Follow](docs/marker-camera.md).** The follow transition now closes the card when a vehicle is selected directly. Both builds passed verification. Simulated clicks covered dot and pill popups, the phone sheet and the 3D popup. The launcher HTTP check timed out, so live browser verification remains open.

**2026-11-09 — 3D edge smoothing.** Enabled multisample anti-aliasing on the tilted map, rebuilt all three [vehicle meshes](docs/vehicle-models.md) with smooth curved surfaces, and softened all four [building materials](docs/3d-building-textures.md). Both releases passed the build check. Verified the numbered release over HTTP and viewed textured buildings and live trams at close zoom in a 1280 × 720 browser. Frame time on a physical phone remains open.

**2026-11-09 — [3D vehicle motion](docs/vehicle-models.md).** Nearby meshes, body taps and follow anchors share a per-frame pose. Trams reuse adjacent rails between fleet updates, and GPS-only moving vehicles glide over the measured feed interval. Both releases passed build verification. A controlled 600-frame check covered buses, trolleybuses, GPS-only and route-matched trams on a bend, camera alignment and idle repaints. Physical phone frame timing remains open.

**2026-11-09 — [Moving line numbers](docs/vehicle-models.md).** The tilted map draws model and standalone line numbers from their frame positions in a shared canvas. Both release artifacts and JavaScript syntax passed verification. A controlled 120-frame check covered moving model and standalone numbers, a camera-only move and idle motion. Desktop headless Chrome opened the numbered release in 3D and rendered label pixels. Physical handset frame timing remains open.

**2026-11-09 — [3D map controls](docs/3d-controls.md).** Added an illustrated guide on each entry to 3D and Ctrl+arrow rotation and tilt on the focused canvas. Both builds and JavaScript syntax passed. Simulated input verified dismissal, focus and all four shortcuts. The launcher HTTP check could not connect, so live browser verification remains open.

**2026-11-09 — [Scheduled metro tracking](docs/marker-camera.md).** Active metro runs share the vehicle marker, 3D line number and Follow controls. Station times link to the matching trip instance. A controlled two-train check exercised the station board to Follow handler, timed positions, surface feed refresh and terminal removal. Built and checked both artifacts and verified the numbered release over HTTP. Live map and physical phone verification remain open.

**2026-11-09 — [Remaining route during GPS motion](docs/vehicle-models.md).** Fixed the tracked line and arrows doubling back behind a bus during a straight GPS glide. Both release builds passed verification. Replayed GPS and route-matched motion through the final vertex in both map modes using the numbered release served over HTTP. A separate geometry check exercised the initial route draw and seven vertex crossings against the 3D line and arrow sources. The live X9 ride was not replayed.

**2026-11-09 — [Bulgarian-style low-rise houses](docs/3d-building-textures.md).** Close zoom with building textures enabled fits a house mesh to eligible rectangular footprints. The model builder and batched WebGL layer live in `src/features/view3d/bulgarian-houses.js`. Both releases and JS syntax passed. Rendered the 190-triangle example in `models/bulgarian-house.glb` and checked the height cutoff. The launcher HTTP request timed out, so the live map toggle and terrain alignment still need a browser check.

**2026-11-09 — [Five Bulgarian house designs](docs/3d-building-textures.md).** The dropdown saves house designs separately from building coloring. Eligible footprints consistently select one of five meshes, with green façades when coloring is enabled. The guide links the five GLBs and their preview. Verified both releases, mesh geometry and JavaScript syntax. At 1280 × 800, headless Chrome opened the numbered release, restored the switch after reload, rendered 47,247 house vertices and exercised all four switch combinations using a controlled basemap style and the bundled Sofia tiles. Live basemap startup fell back to the image map during testing.

**2026-11-09 — [South Bus Station bridge clearance](docs/3d-building-textures.md).** Corrected the prepared deck elevations in the tile and generator and enabled the prepared geometry with neutral paint. Checked the decoded tile and both builds. Visual confirmation remains open.

<!-- AGENT-HANDOFF:END -->

**2026-11-09 — 3D popup overlap.** Raised the common popup layer above the tracked vehicle and location marker. See [3D map popups](docs/3d-popups.md) for ownership and the interaction check.

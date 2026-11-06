# Sofia Live Transport agent roadmap

Read the standing rules and the current handoff before editing. Paths in this guide are relative to the directory containing this file.

## Standing navigation rules

1. Start from a rider action and an entry point. Reproduce the symptom on the local launcher or the hosted page and record the viewport, map mode, and live or timetable data involved when relevant.
2. Edit the owning feature under `src/features/`. Keep its interactions, feature-specific markup, and styling together. Put behavior used by multiple features under `src/shared/`. A feature decides when to follow a vehicle. The shared camera moves the map.
3. Trace both directions before changing a cross-feature operation. Search the source for its definition and callers, including open popups, phone sheets, live refresh, and the 3D view where applicable. For example, run `rg -n "arrivalsAt|guessArrival|stopPopupHtml" src` from this directory.
4. Use `src/page.html` to see the exact markup, stylesheet cascade, and script initialization order. An include occupies a whole line, for example `{{include features/places/places.js}}`. Add each HTML, CSS, or JS source file once. JS is assembled inside one private application function to preserve the standalone phone release. Keep new feature state private and expose a small API to consumers. The saved places implementation is a working example.
5. Edit the source, then regenerate the outputs. `python build.py` builds the hosted page and, when the workspace launcher is present, the numbered local page. `python build.py --check` verifies both without writing. In a standalone checkout of this directory the command verifies the hosted page. Historical numbered releases are reference snapshots. To cut a new one, advance `LOCAL_RELEASE` in the builder.
6. Before handing off, verify the interaction through its normal entry point. Record changes to paths, behavior, and checks in the editable section below. Update standing rules only when the user asks for a policy or workflow change.

### Adding a feature

Define one observable success case. Extend the existing owner when the action belongs to it. For a new capability, create a folder named for the rider action, give it one entry point, and register its files in the page template. Keep listener and timer registration with its owner. Exercise opening, closing, and reopening the feature and test persistence after reload if it stores data.

### Changing a feature

Find the action handler and its rendering paths. For a vehicle card, follow initial rendering and the in-place live update. Check both desktop popup and phone sheet when they display the same data. For visual work, consult the applicable files in the workspace's `design spec/` and `design images/` directories.

### Debugging a feature

Follow one vehicle ID, stop ID, or saved place from input to stored state to displayed result. Fix the first incorrect value. For a wrong stop ETA, compare the result of `arrivalsAt` with the time rendered in the popup before changing the calculation. If the fix is shared, exercise a second consumer. Preserve stored keys and the ability to load existing records.

## Current roadmap and handoff

<!-- AGENT-HANDOFF:START -->
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
<!-- AGENT-HANDOFF:END -->

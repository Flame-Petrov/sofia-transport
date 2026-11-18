# UX review changes (release 109)

The changes from the 2026-11-18 UX/UI review (workspace `debug images/2026-11-18-ux-review/ux-ideas.md`), besides the [language switch](language.md). What a rider sees, where the code is, and how to check it.

## Menu

- **Order:** My places, Offline map, Език · Language, 3D view settings, Report a problem.
- **3D view settings** is one row, closed by default (saved as `sofia_3d_menu`). Open, it shows three groups: *Map* (terrain, roads and tracks, trees, day and night cycle, shadows), *Buildings* and *Vehicles* (3D vehicle models), then **How to move around in 3D**, which opens the controls guide (from the flat map it opens 3D first). Closed by default, the menu fits a 800 px desktop window without scrolling. Markup in `features/view3d/menu.html`, wiring in `view.js` (`setV3MenuOpen`, `refresh()`).
- **Buildings: Off / Simple / Detailed** replaces the three switches *3D buildings*, *3D building textures* and *Bulgarian houses and apartments*. It writes the same saved keys, so earlier choices carry over: Off = `sofia_3d_buildings` `'0'`; Simple = buildings on, textures and house designs off; Detailed = both on. An older mix with only one of the two on reads as Detailed. Detailed is hidden without `DecompressionStream`. The three checkboxes stay in the page (hidden) because the drawing code and the browser tests read them. `buildLevel()`, `showBuildLevel()`, `setBuildLevel()` in `view.js`; details in [3D show switches](3d-show-switches.md).
- **Report a problem** (was *Diagnostics*): same report and Copy button, with a line asking the rider to send it. The warning / error count on the row shows only with `?debug` in the address (`DIAG_BADGE` in `features/diagnostics/report.js`).
- **Offline map** says "1 area saved", "1 of 2 saved", "Not saved yet" or "Saving…" instead of "0/1", and nothing on the image map, where offline areas don't work (`features/offline/areas.js`).

## Search

- A search that finds 1 to 30 vehicles lists them under the search (`#results`, `renderResults()` in `features/search/render.js`): line badge, destination, fleet number, next stop with its minutes (`~` when from the timetable), and how late or early when the feed gives a delay. A tap tracks that vehicle the same way as tapping it on the map, and the list hides while a vehicle is tracked.
- The line chips say "Bus 94 · 10 running" (or "timetable" when no vehicle runs) instead of "×10". A tap still fits the map to the line's vehicles.

## Status card

- One short line: "Live · 637 vehicles". The search count is on its chip, not here.
- After 30 s without new data: yellow "Delayed · updated 40 s ago"; feed failing: red "No live data · updated 12 s ago". The age counts every second (`renderFeedStatus()` in `features/search/render.js`, also called by `shared/transit/live-feed.js` on a failure).
- A tap (or Enter) on the card opens a second line with the clock time of the last update (`#statusMore`).

## Map

- **Vehicle shapes:** dots below label zoom have a shape by type as well as colour: bus ●, tram ■, trolleybus ◆, metro ●. `DOT_SHAPE` in `render.js` sets `options.shape`; `DotCanvas._updateCircle` in `features/offline/areas.js` draws it. The filter pills and chips show the same shapes.
- **Clusters:** below zoom 12, 4 or more vehicles within a 44 px square become one white disc with the count, ringed in the commonest type's colour; a tap zooms in two levels. The tracked vehicle and your route's vehicles never cluster. `buildClusters()`, `drawClusters()` in `render.js`; `updateFlatVehicle()` skips clustered vehicles.
- **Stop signs:** a stop is a white plate on a short post whose foot is on the stop, with a bus glyph; a metro station's plate is round with an "M". On a route the plate takes the line colour. Vehicles are filled badges or dots, so the two no longer look alike. `stopIcon()` in `features/stops/markers.js`, styles in `features/stops/markers.css`.
- **Buttons on the right:** touch screens have no + / − (pinch zooms), so phones show Follow, 3D, recenter and location. Map buttons are 90 % opaque, so markers no longer show through them. An open vehicle card hides every button it runs under, including 3D, recenter and the compass (`vpClearEdge()`, `vpBottomPad()` in `features/vehicles/popup.js`).
- **Map credits on phones** fold behind an (i) button under the location button; a tap shows them (larger, with spaced links), another tap or a tap on the map hides them (`leaflet-control-credits` in `shared/map/base-map.js`, styles in `shared/ui/theme.css`). Desktop keeps the usual credits line.

## 3D controls guide

Shown the first time 3D opens on a device (`sofia_3d_help_seen`), then only from the menu. It shows the touch gestures on touch screens and Ctrl + arrows (and right-drag) with a mouse. Got it, Escape or a tap outside closes it. It sits low on the screen with a light backdrop. See [3D controls](3d-controls.md).

## Card shadows under the search

The tracking card and the search results sit in the panel's scroll area (`#panelBody`), which clips what it holds. It left 2 px above, 14 px at the sides and 18 px below its cards, while the glass shadow reaches about 20 px up, 32 px sideways and 44 px down, so the shadow ended in a hard rectangle (2026-11-18). The area now leaves 12 / 34 / 46 px, with negative margins so the cards stay where they were (`features/panel/menu-layout.css`). That room takes no taps (`pointer-events: none`, the cards take them again), so the map beside and under the cards stays usable; before, the old 14 px strip blocked it. `fitPanel()` subtracts the bottom padding less the negative margin, so the menu bubble keeps its height (measured unchanged at 390 × 844 and 1280 × 800).

## Touch targets

At 390 × 844 (the panel's `--ui` zoom 0.95): menu button 44 px, clear 44 px, filter pills 44 px tall, chips 45 px, language buttons 44 px, credits 47 px (`features/panel/menu-layout.css`, `shared/ui/base.css`, `shared/ui/theme.css`).

## App icon

A white bus front on Sofia blue with a green "live" dot. Source `src/shared/ui/app-icon.svg`. `tools/app_icon.py SITE_DIR PREVIEW_DIR` (Python 3.12 venv in `old/osm-work`) renders the 180 px home-screen PNG and a preview, and writes `shared/ui/app-icon.html`: the SVG favicon, the `apple-touch-icon` PNG (iPhone home screen) and `theme-color`, all inline so the standalone file has them too. Rerun it after changing the SVG.

## Verify

- `node --test tests/*.test.cjs` from `site/`.
- `tests/ux-language-browser.py OUTPUT_DIR` (Python 3.12 venv, Chrome, live feed and base map) checks each item above at 390 × 844 and 1280 × 800 and screenshots every step: the menu and building choice (and that it survives a reload), Report a problem without a count, the search list and a tap on a row, the status detail and a failing feed, missing zoom buttons on touch, credits behind (i), clusters at zoom 11, stop signs at zoom 17, the 3D guide shown once with the touch hint and closed by Escape, touch target sizes and the icon links.
- `tests/show-switches-browser.py` and `tests/tree-switch-browser.py` cover the 3D settings in their new place.

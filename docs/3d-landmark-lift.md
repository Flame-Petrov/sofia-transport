# Landmarks lift off when zoomed out (3D view)

Release 110. When the tilted map is zoomed out so far that only the [landmark, monument and mall models](3d-landmarks.md) stand, a model can be lifted off the ground to see it spin and read what it is.

## What the rider sees

| Where | Action | Result |
|---|---|---|
| PC (mouse) | The pointer goes over a model | It rises (its foot about 44 screen pixels, at least a third of its height), grows to about 110 px across on screen (at least 1.4 and at most 7 times its size) and spins (a turn in 3.2 s). A card above it gives its name, kind and year, and a sentence or two |
| PC | The pointer leaves it | It slows down, comes down and lands facing the way it is mapped, in 0.8 to 2.2 s. The card fades out |
| PC | A click on a lifted model | Nothing else happens (the click does not close cards or deselect a vehicle) |
| Phone (touch) | A tap on a model | The same lift, spin and card |
| Phone | A tap on it again, or on the empty map | It lands. A tap beside it only lands it, nothing else |
| Phone | A tap on another model | The first lands, the other lifts |
| Both | Zooming in until buildings stand | Every lifted model lands and the card goes |

- **When:** MapLibre zoom from 12 (where the landmark layer starts) to below `VIEW3D_BUILDING_ZOOM - 1` = 14 (app zoom 13 to 15), and only while the **Landmarks and monuments** switch (or, for malls, **3D buildings**) draws the model. At those zooms the 56 sites without a `z` in `landmark-data.js` stand: 12 hand-built landmarks, 5 stadiums, 5 universities, 19 malls and 15 monuments of 10 m or more.
- **Priority:** for taps, vehicle dots and labels and stop icons win over a model. For hover only a pointer right on a dot (within 5 px, `vehAtPoint(p, true, true)`) or a stop icon keeps a model on the ground, since at these zooms dots crowd around the models; a model already up stays up while the pointer is on it.
- **Reduced motion** (`prefers-reduced-motion`): the model rises without spinning or growing and the card appears without a fade.
- **On top of everything:** a lifted model is drawn by its own layer at the top of the map's style (`<building layer>-material-landmarks-lifted`), after a fresh depth buffer, so it covers labels, vehicle dots, stop icons and other models. `landmarks.raise()` moves that layer back to the top whenever a model lifts. HTML markers (metro stations, saved places, the tracked vehicle) sit above the map's canvas, so those under a lifted model fade out (`.lm-under`) until it lands. The card stays above the model.
- A lifted model casts no ground shadow (Day and night cycle on).
- The pointer may be up to 8 px outside a model's outline on screen (`PICK_PAD_PX`): at these zooms a model can be only 10 px tall.
- A model that is moving stays easy to hold: its pick area is the whole circle it sweeps, from the ground to its lifted top.

## Source

| File | Owns |
|---|---|
| `src/features/view3d/landmark-lift.js` | `landmarkLift`: the zoom gate, picking (each drawn model's box projected with the layer's last matrix, convex hull, nearest wins, a moving model keeps the pointer), the motion (a critically damped spring for the rise, an easing spin; a landing is a Hermite curve to the next whole turn and the ground, both at rest, chosen so the spin never runs back and slows evenly when it can), the card and its placement (above the lifted top, kept inside the map, under the foot when there is no room above), mouse hover and `tap()` |
| `src/features/view3d/landmark-info.js` | `landmarkInfo`: the card's name, kind and text in English and Bulgarian, keyed by a monument's OSM `key` or a site's name `n`. Facts from Wikipedia, the Sofia monument register (registersofia.bg) and OSM tags (`start_date`, `artist_name`). A site without a row shows its name (transliterated in English) and kind only |
| `src/features/view3d/landmarks.js` | `mesh()` records each site's box (`site.box`: u and v extent and top, metres); `vertices()` returns per-site `ranges` (first vertex, count, centre and ground in the layer's frame, scale); `frame()` keeps the layer's last projection; `shown()` lists the sites in the last upload; `poses()` asks the lift module |
| `src/features/view3d/bulgarian-houses.js` | The shared model shader takes `spin` (centre, cos, sin) and `raise` (ground, rise, scale). The fixed-model layer draws still sites in runs; `drawMoving()` clears depth and draws each moving site with its own pose, called from the top layer; every other draw passes the identity. Shadows skip moving sites |
| `src/features/view3d/building-materials.js` | Adds the top layer that calls `drawMoving()` and lists it in `landmarks.liftLayers` |
| `src/features/view3d/view.js` | `landmarkLift.attach()` on the style load (with vehicles and stops as blockers), `detach()` on close, and `landmarkLift.tap()` in `onClick()` after the vehicle and stop checks |
| `src/features/view3d/view.css` | `.lm-card` (glass card, no pointer events) |
| `src/features/view3d/strings-bg.js` | The fallback kinds (Landmark, Stadium, University, Shopping centre, Monument) |

To describe another site, add a row to `landmarkInfo` with its `key` (monuments) or `n` (others). The unit test fails when a site that stands when zoomed out has no row, or a row names no site.

## Verify

- `node --test tests/*.test.cjs`: `tests/landmark-lift.test.cjs` checks that every zoomed-out site has a name, kind and short text in both languages, that a model records its box, that a landing from any angle and speed ends at rest on the ground facing its mapped bearing, and that a spinning model slows without turning back or jumping in speed.
- `tests/landmark-lift-browser.py OUTPUT_DIR [--standalone] [--lang en|bg]` (Python 3.12 venv in `old/osm-work`; fixture basemap, bundled tiles, no feed): desktop 1280 × 800 hovers the Alexander Nevsky Cathedral at MapLibre zoom 13.4 (lift, growth of 3 to 7 times, drawn by the map's top layer, spin, card on screen, landing forward to rest, card gone), checks that nothing lifts at zoom 14.6, then on an Android phone (390 × 844, touch) taps it (lift and card on screen), taps it again (lands) and taps beside a lifted model (lands). It saves screenshots and enlarged crops around the cathedral, and fails on any page error.
- Not covered by a test: a physical Android or iPhone, a live feed (vehicle and stop priority on a crowded map), terrain on, and the Bulgarian card in a browser.

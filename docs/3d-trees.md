# Trees (3D view)

From MapLibre zoom 15 (16 on the flat map) the tilted map draws Sofia's trees: every tree mapped in OpenStreetMap, a tree every 8 m along mapped tree rows, and trees filling parks, gardens, woods and forests. The **Trees** switch in the 3D menu turns them off (`sofia_3d_trees`, on unless `0`; see [what the 3D view draws](3d-show-switches.md)). The 3D view zooms two levels closer than the flat map (MapLibre 20) so trees and monuments can be seen up close.

## What is drawn

| Source | Count (2026-11-07 extract) | Notes |
|---|---|---|
| Mapped trees (`natural=tree`) | 17,670 | `genus`, `species` and `leaf_type` pick the shape; a mapped `height` wins |
| Tree rows (`natural=tree_row`) | 201 rows, about 2,700 trees | One tree every 8 m along the way |
| Parks, gardens, woods, forests | about 210,000 | Jittered grid (12 m in parks, 7.5 m in woods) thinned by low-frequency noise, so groves and glades alternate. Buildings, roads and paths, railways, rivers, water, pitches, playgrounds, car parks, squares and cemeteries are kept clear, and no filled tree stands within 5 m of a mapped one. Woods and forests more than 7.5 km from the centre are left to the basemap, so Vitosha's forest is not packed into the page |

Eight shapes, each about 40 to 120 triangles: **broad** (lime, chestnut, plane, oak; three lumps of crown), **conifer** (spruce and fir; three tiers), **pine** (a tall trunk and a flat crown), **poplar** (a narrow column), **thuja** (cypress and juniper), **birch** (white bark, light oval crown), **willow** (a wide crown with a hanging curtain) and **small** (fruit and ornamental trees). Each tree is turned, widened or narrowed and shaded by a seed from its position.

Deciduous crowns follow Sofia's date (`trees.season()`): fresh green from 21 March, blossom on small trees in spring, deep green from May, yellowing in September, yellow, orange, red and some green in October and November, and bare branches from 1 December to 20 March. Conifers, pines and thujas keep their colour. A page opened with `?season=spring|summer|late|autumn|winter` pins the season (a test aid).

Trees take the day and night light and, with the day and night cycle and the Shadows switch on, cast ground shadows ([daylight](3d-daylight.md)).

## How it is drawn

- `tools/tree_data.py PATH/Sofia.osm.pbf` (the Python 3.12 venv in `old/osm-work`, about 2 minutes) writes `src/features/view3d/tree-tiles.js`: one gzipped, base64 entry per zoom-14 tile (146 tiles, about 1 MB gzipped). A tile holds 16 cells of about 450 m; the binary layout is in the script's docstring.
- `build.py` embeds every tile in the numbered release and writes them as `tiles/trees/14/X/Y.bin.gz` for the hosted page, which fetches each when it first comes into view.
- `src/features/view3d/trees.js` owns the tile store (load, decode), the shapes, the season and the layer. `trees.layer({ id, budget })` is added by `view.js` under the vehicle models. Every shape is one instanced draw; a row is position in metres from a local origin, height, turn and seed. With terrain on each tree is lifted to the ground at rebuild time.

## Which trees are drawn

Every tree in every cell in view is considered, so a wood is never cut off along a cell edge. (Until 2026-11-13 whole cells were taken nearest first until 12,000 trees were reached; the wood of Borisova Gradina alone has about 28,000 in one tile, so its far cells stayed empty.)

- **Two shapes a kind.** A tree nearer the camera than `eye.near` (a 12 m tree is then taller than 50 CSS pixels, `NEAR_PX`; about 320 m on a 900-pixel-high window) takes its full shape. Farther trees take the simple one: a three-sided trunk and one lump of crown, 20 to 30 triangles, with its own bare winter version. Distance is measured from the camera itself (`trees.eye()`), so a high camera sees only simple trees.
- **The budget** is counted in full trees: 12,000, or 6,000 on iPhone. A simple tree costs 0.3 (`FAR_COST`), so a view of up to 40,000 distant trees is drawn whole.
- **Thinning.** When the view costs more than the budget, `rows()` finds the distance `range` that spends it exactly: trees within `range` all stay, and one at distance `d` beyond it stays with a chance of `range / d`, decided by its seed. The foreground stays whole, the distance thins evenly, and a tree that is drawn stays drawn as the budget or range grows.
- Rows are rebuilt when the set of cells, the season, terrain or the camera changes: the camera position is rounded to an eighth of `eye.near` and its height to 6 % steps, and rebuilds are at most 200 ms apart. A rebuild of 75,000 trees in view takes about 7 ms on a desktop.
- `trees.stats().view` reports the last rebuild: `cells` and `trees` in view, `covered` (cells with a tree drawn), `drawn`, `full` (full shapes) and `range` in metres (`null` when nothing was thinned).

## Verify

- `node --test tests/trees.test.cjs`: every tile decodes inside its bounds with plausible heights, every shape (full and simple, leafy and bare) is finite, stands on the ground and stays under 160 triangles (32 for a simple one), the season follows Sofia's calendar (including the date change at midnight Sofia time), instance rows group by kind, and the fullest tile is drawn whole: all simple from a high camera, and with a small budget thinned to that budget with no cell left empty and no tree within the range dropped.
- `tests/trees-browser.py OUTPUT_DIR [--seasons summer,autumn,winter,spring] [--only forest]` (the Playwright venv) screenshots Borisova Gradina, the City Garden, South Park, the Doctors' Garden, a street, a close view and `forest` (the whole wood of Borisova Gradina, about 47,000 trees in view) in each season, prints `stats().view` for the last camera, checks the switch saves `0` and hides the layer, and fails on page errors or when a cell in the last view has no tree drawn.
- `tests/tree-switch-browser.py OUTPUT_DIR [--phone]` opens the menu (`#fold`) in the 3D view and taps the **Trees** switch as a rider would: it is listed under **Landmarks and monuments** and starts on, off hides the trees and saves `0`, the state survives a reload, and on brings them back and saves `1`.
- Not yet checked: frame time and memory on a physical phone, terrain on, and the real basemap's own park colours under the trees (the fixture style has none).

# Custom building textures for Sofia’s 3D map

## Shipped data and renderer

The tilted map uses the bundled building source with either appearance switch on or off. With both off it uses neutral paint. Mapped roof sections, including eight adjoining footprints at the Yug Bus Station entrance, along the metro use open barrel vaults from `metro-canopies.js` in every appearance mode. The 3D metro pose in `view.js` aligns each direction with its side of the covered track and blends back onto the scheduled path outside the portals. The shell has a shaded underside, steel portal frames and concrete side posts at approximately eight-metre intervals. These details are illustrative. Their eaves follow the mapped edges. The 4.5 m spring height and 5 m rise are rendering estimates. Inspect the portal at 23.36150 E, 42.66058 N in tilted view. The source contains 255 native zoom-14 tiles. Each tile includes a buffer for buildings that cross its edge. The hosted build fetches individual binary tiles from `tiles/buildings/14/`. The numbered page decompresses requested tiles individually from its embedded bundle. Outside complete extract tiles, or if a tile cannot be decoded, the same source reads the original OpenFreeMap tile through the app’s offline cache and uses a warm window pattern when either appearance switch is on.

The checked-in bundle adds 3.60 MB to the standalone HTML. The 13 façade styles are painted on the device into 39 small sheets, about 1.7 MB of pixels before mipmaps. The material class and façade style are computed during preparation. When house designs are enabled, the device still measures visible footprints to generate their meshes.

**Source and refresh.** Building geometry and classifications are derived from © OpenStreetMap contributors and distributed under ODbL 1.0. The BBBike Sofia extract used here has replication timestamp `2026-11-07T00:00:00Z`. In a Python environment with `osmium`, `shapely` (2.1+), `pyproj` and `mapbox-vector-tile`, run `python site/tools/prepare_buildings.py Sofia.osm.pbf` from the workspace root to regenerate `building-tiles.js`, then rebuild the HTML. Use the rectangular Sofia extract and recheck the reviewed outlines and tile samples when refreshing. [Extract](https://download.bbbike.org/osm/bbbike/Sofia/) · [OSM attribution and license](https://www.openstreetmap.org/copyright)

**Why a separate source.** OpenFreeMap edition `20261101_080013_pt` carries roof and base heights but merges disjoint footprints into features. At z14, tile `9253/6039` contained 3,812 polygons in 73 features. Its eastern neighbor contained 2,348 polygons in 32 features. A single native ID in the table below covers both a wide building and a small building. Joining that ID to a material would misclassify one of them.

| Checked location (lat, lon) | Prepared feature ID | Native feature ID | Observation |
|---|---:|---:|---|
| 42.69578, 23.33311 | 3375803352 | 3375803352 | Gold cathedral part. Base 15 m, roof 20 m. All 14 mapped parts share the parent’s material, including the 51 m tower. |
| 42.69720, 23.32495 | 34424833 | 34424830 | Blue National Assembly complex. The parent spans 121.6 m. Its 26 m section inherits the tall complex’s class. |
| 42.69623, 23.32513 | 230644232 | 22151910 | Purple. The complete outline spans 86.6 m and the roof is 19 m high. |
| 42.68963, 23.32351 | 651630312 | 10280000 | Green. The footprint spans 16.9 m and has the 5 m fallback roof. |
| 42.68807, 23.33453 | 278013932 | 10280000 | Purple on both sides of the 9253/9254 tile boundary. The complete outline spans 94.3 m and the roof is 5 m high. |

**Monument review.** The extract’s Alexander Nevsky Memorial Cathedral (OSM way 155447771, Wikidata Q43282) and St. George Rotunda (way 171437780, Q2598073) match the municipal listings. The classifier also accepts explicit monument tags on building outlines. Two monument nodes intersected other buildings in the extract, a bust in the veterans’ home and a monument at Planinarska Pesen Hut. Both remain POIs. The generator never assigns a monument by proximity. [Memorial Cathedral](https://www.sofia.bg/en/web/sofia-municipality/w/aleksandar-nevski-memorial-cathedral-church) · [St. George Rotunda](https://www.visitsofia.bg/en/index.php?Itemid=2021&lang=en&layer=50000&obektid=2765&option=com_cityinfrastructure&view=objectdetails)

## Rider experience

The **3D building textures** switch sits directly below **3D view: terrain (Vitosha)** in the menu. It starts off. Turning it on gives Sofia’s buildings 13 façade styles in varied wall and roof colours from the existing building zoom (15 in the app). Turning it off uses a warm window pattern if house designs are enabled, or pale height-shaded extrusions if both switches are off. A rider following a tram can try both looks from the same camera position and keep following it.

Use the existing labelled checkbox with `role="switch"`. Show a compact text key beneath the enabled switch: “Plaster, panel, brick, glass and stone façades in varied colours, with tiled and flat roofs.” A rider on the flat vector map can set the preference before entering 3D. Hide the control when 3D is unavailable. Remember the choice across mode changes and reloads using `store()` and a dedicated `sofia_3d_building_textures` key.

## Which façade a building gets

Each building group gets a **style**, a **seed** and, where OpenStreetMap records one, a wall and roof colour. The seed picks the wall tint from the style’s palette, a slight brightness shift, the roof colour and the brightness of individual windows. It comes from the feature ID, so a building looks the same after a pan or a reload. Parts of a larger building store their parent’s seed, so a tower matches its podium. The [style sheet](../models/facade-styles.png) shows every style in four of its tints.

`facade()` in `tools/prepare_buildings.py` evaluates these rows from top to bottom. The first match wins. Where several styles are listed, the seed chooses one.

| Priority | Building | Style |
|---|---|---|
| 1 | Verified monument | `stone`: dressed limestone, arched windows, heavy cornice |
| 2 | Church, chapel, mosque, synagogue or other place of worship | `church`: smooth render, lancet windows, arched portal |
| 3 | `building:material` glass or mirror | `glass`: curtain wall |
| 4 | Garage, carport, shed, kiosk, service building, roof | `garage`: blank render over lift-up doors |
| 5 | Industrial, warehouse, hangar, depot, or metal cladding | `industrial`: corrugated sheet, roller door |
| 6 | Retail, supermarket, mall, or a building holding a shop | `retail`: glazed ground floor under a fascia |
| 7 | School, kindergarten, university, hospital, government, civic | `public`: pilasters and large square windows |
| 8 | Office or commercial | `glass` from 30 m, otherwise `office` with ribbon windows |
| 9 | Hotel | `glass` from 40 m, otherwise `modern` |
| 10 | House, detached, semi-detached, bungalow, terrace | `house`: shuttered windows, stone plinth, timber eave |
| 11 | `building:material` brick | `brick` |
| 12 | Apartments, residential, dormitory | `panel` from 14 m high and 35 m long; `panel` or `modern` from 20 m; otherwise `plaster`, `brick` or `modern` |
| 13 | Untyped, from 45 m high | `glass` |
| 14 | Untyped, from 30 m high | `panel`, `glass` or `modern` |
| 15 | Untyped, ground span from 45 m | Up to 8 m high `industrial` or `retail`; from 15 m `panel`; otherwise `public`, `office` or `brick` |
| 16 | Untyped, up to 5 m high and under 60 m² | `garage` |
| 17 | Untyped, up to 8 m high and under 300 m² | `house` |
| 18 | Everything else | `plaster`, `brick` or `modern` |

The Sofia extract yields 69,910 house, 25,901 garage, 10,764 plaster, 7,108 modern, 5,712 panel, 5,598 brick, 4,166 industrial, 3,625 retail, 2,013 office, 1,716 public, 414 glass, 321 church and 19 stone footprints and parts. About two thirds of buildings carry only `building=yes`, so most styles come from rows 13 to 18 and are plausible rather than surveyed.

Roofs are flat caps. Plaster, brick, house, church and garage buildings take one of four clay-tile shades or grey sheet metal. Panel, modern, office, glass, retail, industrial and public buildings take felt, gravel or membrane greys. A mapped `roof:colour` wins, as does a mapped `building:colour` for the walls (187 and 90 buildings in the extract).

Street tiles outside the prepared extract name no style. There the broad material class below chooses among a few styles and the footprint’s position supplies the seed.

### Material class

The earlier four-way class is still stored as `material`. The house designs use it to decide which footprints may take a modelled house. Evaluate the rows from top to bottom. The first match wins.

| Priority | Building rule | Proposed material |
|---|---|---|
| 1 | A verified monument footprint, including its mapped building parts | Warm limestone with staggered stone courses |
| 2 | Height ≥ 30 m | Neutral gray glass with a glazed curtain-wall grid |
| 3 | Ground span ≥ 45 m, measured along the long side of the footprint’s minimum rotated rectangle | Muted brick with horizontal window bands |
| 4 | Remaining buildings, including those with only the map’s fallback height | Sand plaster with masonry joints and sash windows |

For example, a 50 m-long, 12 m-high hall uses muted brick even when it runs diagonally across the map. A 32 m tower on an equally wide base uses gray glass. A verified monument of either size uses limestone. Measure a multipart building once using the parent outline and its tallest roof height, then apply that class to its visible parts so a tower and its podium read as one building.

## Implementation and verification

**Bulgarian houses and apartments** is a second, independently saved dropdown switch (`sofia_3d_house_designs`, initially off). At app zoom 16 (MapLibre 15) and above, it fits five Bulgarian-inspired designs to small, ground-level, approximately rectangular footprints with walls 3–12 m high and edges 4–26 m long. Larger rectangular footprints in the green and purple building classes use five additional designs when an edge exceeds 26 m or the wall height exceeds 12 m, up to 65 m and 28 m respectively. Look for paired balconies, a brick stairwell block, a corniced residence, continuous balcony galleries, and a low-roof modernist walk-up. The footprint ID determines the design, so the same house keeps its appearance after a pan or reload. These are illustrative designs rather than surveyed façades.

| House designs | Building textures | 3D appearance |
|---|---|---|
| Off | Off | Original height-shaded extrusions |
| Off | On | The 13 façade styles with varied wall and roof colours |
| On | Off | Houses with natural plaster and terracotta roofs; plaster with sash windows in ten tints elsewhere, under plain roofs |
| On | On | Houses with natural façades and clay roofs; other buildings keep their façade styles |

The [five-design preview](../models/bulgarian-house-designs.png) shows the natural palettes. The reference meshes are [Shuttered gable](../models/house-shuttered-gable.glb), [Timber frame](../models/house-timber-frame.glb), [Brick cornice](../models/house-brick-cornice.glb), [Wooden veranda](../models/house-wooden-veranda.glb), and [Dormer cottage](../models/house-dormer-cottage.glb). The map uses the same procedural geometry in `src/features/view3d/bulgarian-houses.js`, scaled to each eligible footprint and batched for drawing.

To verify, zoom to a residential street at app zoom 16 and try each combination above. With both switches on, turn just the designs off and check that small buildings show sand plaster. Turn designs back on, disable coloring, then reload and check that natural house finishes persist. Zoom out below 16 to check the transition back to extrusions.

`src/features/view3d/facade-styles.js` paints the façade sheets and chooses each footprint’s look. `solid-facades.js` draws the walls. A flat cap at the mapped roof height carries the roof colour: varied with textures on, a muted stone-gray with only house designs on. The extrusion follows the mapped footprint. To inspect pattern contrast independently of the building silhouette, toggle textures at a fixed camera position, then rotate past a diagonal roofline.

- `tools/prepare_buildings.py` assembles OSM areas, associates mapped parts with an explicit building relation or the smallest containing outline, and measures the long side of the minimum rotated rectangle in UTM zone 34N. It assigns one material class, façade style and seed using the tallest roof in each group, then clips the individual geometries to zoom-14 Web Mercator tiles. The individual roof and base heights are retained. A feature stores `seed` only when it differs from the one the app derives from its own ID.
- `src/features/view3d/building-materials.js` owns the tile protocol, fallback, roof colour expression and layers. It copies the native extrusion styling and filters, then raises textured building opacity to 0.92 for stronger color. The native geometry stays available at zero opacity while textures are on, so switching off can restore the original paint without rebuilding the street layer.
- `src/features/view3d/menu.html`, `view.css` and `view.js` own the two switches, their hints and their saved preferences. The style-load callback and switch handler use the same material routine. Each 3D map registers the images and layers on its first use of textures. The standalone build includes the material code and tile bundle through `src/page.html`.
- For a visual check, open the menu, enable **3D building textures**, enter 3D and zoom to Alexander Nevsky Square. Compare both settings at the same pitch and bearing, then check the tile-edge sample above. Switch while following a vehicle and reload with each setting.

The shipped tiles contain 133,769 distinct footprints and parts. All 3,757 IDs repeated across buffered tiles retained the same class. Chrome rendered all four materials on desktop and in a 390 × 844 phone viewport. The tests exercised keyboard and rapid opening toggles, saved on/off states, terrain, a followed vehicle’s open popup, cached rendering and forced tile-decoding failure. That earlier failed-decode test predates the window-pattern fallback. The workspace’s `debug images/3D building textures/` contains the matching camera views. The live-feed connection dialog can cover the menu during a sustained outage. Frame time and memory on a physical phone still need measurement.

## Acceptance checks

- At four recorded Sofia locations, verify each material and its label. Include a tall-and-wide building, a multipart monument, a building with missing height and one crossing a tile edge. Pan, rotate and zoom across the edge and confirm the class stays stable.
- On desktop and phone, switch on and off while following a vehicle. Compare the off view with the original at the same bearing and zoom. Check the route line, vehicle badge, stop labels and selected vehicle through both changes.
- Toggle before entering 3D, during opening, after enabling terrain, and after reopening the map. Reload with each preference. Check the switch by keyboard and confirm the flat map and image-map fallback retain their usual presentation.
- Compare frame time on the same phone and camera path with textures off and on. Check an offline area with cached buildings and confirm the four patterns render without an extra network request. Repeat the toggle several times and check that image and layer counts stay bounded.
- From the workspace root run `python site/build.py`, `python site/build.py --check`, then `python serve.py --no-open`. Exercise the switch on the numbered release and the hosted artifact before marking the feature complete.

## Building model catalog and test preview

The [21-model test sheet](../models/building-model-tests.png) shows the ten residential designs, four material-class exemplars and seven footprint forms. The latter include a courtyard, L and U wings, a rounded footprint, an irregular polygon, a multi-height complex and a raised deck. The GLBs in `models/` are metre-scale standalone examples. The standalone map builds its residential meshes locally and extrudes the actual mapped rings at their stored base and roof heights. This retains courtyard holes, orientation and the clearance under raised decks.

Run `python site/tools/build_building_models.py` with Node, NumPy and Pillow installed. The exporter samples the residential mesh builder and one bay of the matching façade style, writes the GLBs with embedded materials, then reads and rasterizes each exported GLB for the labeled test sheet. The checked-in GLBs and test sheet predate the façade styles and still embed the earlier four materials. In the map, enable both building switches, enter 3D and zoom into Serdika to compare plaster, panel and brick blocks, glazed towers and pitched roofs.

## How a wall is drawn

Each style has three sheets, two window bays wide: a ground floor with doors or shopfronts, two alternating middle floors, and a top floor with its cornice or parapet. `solid-facades.js` gives every wall a whole number of bays and floors from the style’s nominal bay width and floor height, so no window is cut at a corner or roofline. Walls shorter than 2.2 m stay plain. Parts that start above the ground skip the ground-floor sheet. Wall pixels in a sheet are grey and take the building’s tint in the shader. Glass, frames and doors keep their own colour, and each window gets its own brightness, with about one in eight showing light curtains. The base of each wall is slightly darkened. Sheets have mipmaps and, where the device supports it, 4× anisotropic filtering. Each corner is eight floats, two more than before, which makes a wall upload a third larger.

To review the styles without the map, run `node tools/preview_facade_styles.cjs`, which rewrites `models/facade-styles.png`. To review them in the map, run `python tests/facade-shots-browser.py OUTPUT_DIR` with Playwright and Chrome installed. It saves seven fixed Sofia cameras: a close street view, the centre near and wide, a panel estate, residential blocks, an industrial zone and towers. Add `--houses` for both switches, `--plain` for house designs only, or `--standalone` for the numbered release. In the close view check that windows end cleanly at corners and rooflines, that ground floors and cornices differ from the floors between, and that neighbouring buildings differ in colour. The 2026-11-10 set is in the workspace under `debug images/Varied facades/`.

The opaque footprint extrusion supplies the roof. The wall and house layers share one query of the screen plus a margin, held in `building-view.js`, and batch the geometry by material. Camera movement inside the margin does no building work. The [performance guide](rendering-performance.md) gives the rules for repeating the query and the measured effect. To verify, follow a vehicle with both switches on and check that walls stay textured to the screen edges, then drag quickly and rotate. With only house designs enabled, the footprint ID selects one of ten plaster tints. Check a façade through fractional and integer zoom levels, then pan a new block into view.

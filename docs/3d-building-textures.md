# Custom building textures for Sofia’s 3D map

## Shipped data and renderer

The tilted map uses the bundled building source with either appearance switch on or off. With both off it uses neutral paint. At South Bus Station, the prepared footprint for way 630236462 uses an estimated 12 m underside and 14 m deck top. To check clearance, tilt the map at close zoom and rotate around the station with house designs on and off. The source contains 255 native zoom-14 tiles. Each tile includes a buffer for buildings that cross its edge. The renderer decompresses requested tiles individually. Outside complete extract tiles, or if a tile cannot be decoded, the same source reads the original OpenFreeMap tile through the app’s offline cache and uses a warm window pattern when either appearance switch is on.

The checked-in bundle adds 3.46 MB to the standalone HTML. The largest decoded building tile is approximately 143 KB. The five 32 × 32 RGBA patterns together contain 20 KiB of pixel data. No geometry measurements take place on the device.

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

The **3D building textures** switch sits directly below **3D view: terrain (Vitosha)** in the menu. It starts off. Turning it on gives Sofia’s buildings four original, lightly patterned materials from the existing building zoom (15 in the app). Turning it off uses a warm window pattern if house designs are enabled, or pale height-shaded extrusions if both switches are off. A rider following a tram can try both looks from the same camera position and keep following it.

Use the existing labelled checkbox with `role="switch"`. Show a compact text key beneath the enabled switch: “Small · green, tall · blue, wide · purple, monuments · gold.” A rider on the flat vector map can set the preference before entering 3D. Hide the control when 3D is unavailable. Remember the choice across mode changes and reloads using `store()` and a dedicated `sofia_3d_building_textures` key.

## Which material a building gets

Evaluate the rows from top to bottom. The first match wins. The bundled classifications use the thresholds and swatches below.

| Priority | Building rule | Proposed material |
|---|---|---|
| 1 | A verified monument footprint, including its mapped building parts | Warm gold `#FFBC00` with a subtle stone grain |
| 2 | Height ≥ 30 m | Blue `#0070FF` with narrow vertical bands |
| 3 | Ground span ≥ 45 m, measured along the long side of the footprint’s minimum rotated rectangle | Purple `#B82CFF` with horizontal courses |
| 4 | Remaining buildings, including those with only the map’s fallback height | Green `#0CDE55` with a fine masonry texture |

For example, a 50 m-long, 12 m-high hall is purple even when it runs diagonally across the map. A 32 m tower on an equally wide base is blue. A verified monument of either size is gold. Measure a multipart building once using the parent outline and its tallest roof height, then apply that class to its visible parts so a tower and its podium read as one building.

## Implementation and verification

**Bulgarian houses and apartments** is a second, independently saved dropdown switch (`sofia_3d_house_designs`, initially off). At app zoom 16 (MapLibre 15) and above, it fits five Bulgarian-inspired designs to small, ground-level, approximately rectangular footprints with walls 3–12 m high and edges 4–26 m long. Larger rectangular footprints in the green and purple building classes use five additional designs when an edge exceeds 26 m or the wall height exceeds 12 m, up to 65 m and 28 m respectively. Look for paired balconies, a brick stairwell block, a corniced residence, continuous balcony galleries, and a low-roof modernist walk-up. The footprint ID determines the design, so the same house keeps its appearance after a pan or reload. These are illustrative designs rather than surveyed façades.

| House designs | Building textures | 3D appearance |
|---|---|---|
| Off | Off | Original height-shaded extrusions |
| Off | On | Four building classes in their existing colors and patterns |
| On | Off | Houses with natural plaster and terracotta roofs; window-patterned extrusions elsewhere |
| On | On | Houses with natural façades and clay roofs; other buildings retain their class colors |

The [five-design preview](../models/bulgarian-house-designs.png) shows the natural palettes. The reference meshes are [Shuttered gable](../models/house-shuttered-gable.glb), [Timber frame](../models/house-timber-frame.glb), [Brick cornice](../models/house-brick-cornice.glb), [Wooden veranda](../models/house-wooden-veranda.glb), and [Dormer cottage](../models/house-dormer-cottage.glb). The map uses the same procedural geometry in `src/features/view3d/bulgarian-houses.js`, scaled to each eligible footprint and batched for drawing.

To verify, zoom to a residential street at app zoom 16 and try each combination above. With both switches on, turn just the designs off and check that small buildings stay green. Turn designs back on, disable coloring, then reload and check that natural house finishes persist. Zoom out below 16 to check the transition back to extrusions.

The pattern generator in `src/features/view3d/building-materials.js` feathers the green mortar joints, uses low-contrast periodic gradients for the blue and purple bands, and halves the gold grain amplitude. The extrusion follows the mapped footprint. To inspect pattern contrast independently of the building silhouette, toggle textures at a fixed camera position, then rotate past a diagonal roofline.

- `tools/prepare_buildings.py` assembles OSM areas, associates mapped parts with an explicit building relation or the smallest containing outline, and measures the long side of the minimum rotated rectangle in UTM zone 34N. It assigns one material using the tallest roof in each group, then clips the individual geometries to zoom-14 Web Mercator tiles. The individual roof and base heights are retained.
- `src/features/view3d/building-materials.js` owns the tile protocol, fallback, deterministic pattern images and layers. It copies the native extrusion styling and filters, then raises textured building opacity to 0.92 for stronger color. The native geometry stays available at zero opacity while textures are on, so switching off can restore the original paint without rebuilding the street layer.
- `src/features/view3d/menu.html`, `view.css` and `view.js` own the two switches, their hints and their saved preferences. The style-load callback and switch handler use the same material routine. Each 3D map registers the images and layers on its first use of textures. The standalone build includes the material code and tile bundle through `src/page.html`.
- For a visual check, open the menu, enable **3D building textures**, enter 3D and zoom to Alexander Nevsky Square. Compare both settings at the same pitch and bearing, then check the tile-edge sample above. Switch while following a vehicle and reload with each setting.

The shipped tiles contain 133,769 distinct footprints and parts. All 3,757 IDs repeated across buffered tiles retained the same class. Chrome rendered all four materials on desktop and in a 390 × 844 phone viewport. The tests exercised keyboard and rapid opening toggles, saved on/off states, terrain, a followed vehicle’s open popup, cached rendering and forced tile-decoding failure. That earlier failed-decode test predates the window-pattern fallback. The workspace’s `debug images/3D building textures/` contains the matching camera views. The live-feed connection dialog can cover the menu during a sustained outage. Frame time and memory on a physical phone still need measurement.

## Acceptance checks

- At four recorded Sofia locations, verify each material and its label. Include a tall-and-wide building, a multipart monument, a building with missing height and one crossing a tile edge. Pan, rotate and zoom across the edge and confirm the class stays stable.
- On desktop and phone, switch on and off while following a vehicle. Compare the off view with the original at the same bearing and zoom. Check the route line, vehicle badge, stop labels and selected vehicle through both changes.
- Toggle before entering 3D, during opening, after enabling terrain, and after reopening the map. Reload with each preference. Check the switch by keyboard and confirm the flat map and image-map fallback retain their usual presentation.
- Compare frame time on the same phone and camera path with textures off and on. Check an offline area with cached buildings and confirm the four patterns render without an extra network request. Repeat the toggle several times and check that image and layer counts stay bounded.
- From the workspace root run `python site/build.py`, `python site/build.py --check`, then `python serve.py --no-open`. Exercise the switch on the numbered release and the hosted artifact before marking the feature complete.

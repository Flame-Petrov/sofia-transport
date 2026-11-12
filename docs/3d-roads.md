# 3D roads and tracks in the tilted view

From app zoom 16 the 3D view replaces the basemap's flat street and rail lines with modelled ground:

- carriageways with joined junctions, pedestrian streets and squares in paving
- sidewalks raised 15 cm with a kerb face, cut out around buildings
- centre lines, dashed lane lines and zebra crossings
- tram tracks with two rails, set into the road or on their own bed with sleepers
- railway lines on a ballast bed with sleepers and rails

The **3D roads and tracks** switch in the 3D menu turns it off (on by default, saved as `sofia_3d_roads`, on unless `0`).

The flat lines stay, exactly as before, wherever the meshes cannot cover the whole view: below the zoom gate, with terrain on, outside the prepared Sofia area, where a tile is missing or still loading, when the horizon is in view, and in browsers without `DecompressionStream` (the switch is hidden there). The numbered standalone release embeds only the 34 tiles within 3 km of Serdika; outside them it shows the flat lines.

Not modelled: bridges and underpasses are drawn at ground level (vehicles, stops and route lines are all at ground level too), tunnels are left to the basemap, and roads do not follow terrain.

## How it stays fast

All geometry is made offline. At run time a tile is downloaded, unpacked, uploaded to the GPU once and then only drawn. Nothing is tessellated, no map features are queried and no buffer is rebuilt when the camera moves.

| Cost | How it is bounded |
|---|---|
| CPU per frame | A frustum test and one draw call per visible tile. `render()` allocates nothing. The wanted tiles are planned again only after the camera moved 25 m, turned 3°, tilted 2° or zoomed 0.08 |
| Draw calls | One vertex buffer, one index buffer and one vertex array object per tile, one shader, no textures. At most 16 tiles a frame, nearest first |
| Triangles | At most 150,000 a frame. Sleepers, lane dashes and zebra stripes are drawn by the fragment shader from the distance along the line, so they cost no triangles. The index buffer is ordered by detail (surface; sidewalks and kerbs; track beds; markings; rails) and a far tile draws a shorter prefix: sidewalks and beds to 900 m, markings to 380 m, rails to 260 m |
| Fill | Opaque, lit per vertex, no depth writes. Inside a tile the index order paints back to front (kerb faces before the sidewalk tops that hide the far ones) |
| Uploads | `STATIC_DRAW`, at most one tile a frame |
| Memory | Tiles drawn longest ago are freed above 24 MB of buffers (12 MB on iOS). A tile's unpacked data is dropped once it is on the GPU. An out-of-memory upload lowers the budget |
| Arrival | Tiles under the view plus a margin, and one more ring in the direction of travel, are requested nearest first, four at a time |
| Slow devices | The governor in `road-store.js`: while the 95th-percentile frame stays over 20 ms for a second, the detail distances shrink (×0.7, ×0.5, ×0.35), then the draw distance (×0.7, ×0.5). Under 14 ms they step back. A device that caps its frame rate near 30 Hz therefore stays at the lowest detail |

While the meshes cover the view, the basemap's line layers on the `transportation` source layer are set to `line-opacity` 0 (MapLibre skips drawing a line layer whose opacity is 0, and no tile reloads). Layers whose id contains `tunnel`, `path`, `pedestrian`, `ferry`, `pier` or `aeroway` are left alone. While they are hidden every drawn tile includes its track beds, so distant tram and railway lines do not vanish.

Trams: while the meshes cover the view, `refreshRails` in `view.js` builds the rail graph from the tram centrelines stored in the road tiles instead of `querySourceFeatures` on the street tiles. A tram model then sits exactly on the drawn rails. Otherwise the previous query is used.

## Files

| File | Role |
|---|---|
| `tools/prepare_roads.py` | The generator. Reads roads, tracks, crossings and building outlines from the OSM extract and writes `road-tiles.js` |
| `src/features/view3d/road-tiles.js` | Generated: `sofiaRoadBounds` (the prepared tile range) and `sofiaRoadTiles` (gzipped tiles in base64; a leading `-` marks a tile the standalone page leaves out) |
| `build.py` | Hosted build: writes each tile to `tiles/roads/15/x/y.bin.gz` and puts the paths in the page. Standalone build: keeps the embedded tiles and gives the left-out ones an empty entry |
| `src/features/view3d/road-store.js` | Tile decoding, which tiles are wanted, downloads, the upload queue, the memory budget, centrelines, the governor. No WebGL, so `tests/roads.test.cjs` runs it in Node |
| `src/features/view3d/road-layer.js` | The MapLibre custom layer `v3-roads`, its shader, culling, detail selection and the hiding of the flat lines |
| `src/features/view3d/view.js` | Adds the layer under the route lines and buildings, wires the switch, the tram rails and the diagnostics row **3D roads** |
| `src/features/view3d/menu.html` | The switch `#v3Roads` in `#v3ShowRow` |
| `src/config.js` | `VIEW3D_ROAD_ZOOM` (app zoom 16, MapLibre zoom 15) |

The layer is a 2D custom layer placed before the first building extrusion. MapLibre gives it a read-only depth test at its place in the style, so opaque layers above it still cover it, and buildings, ground shadows, route lines, stops, vehicles and labels draw over it unchanged. Colours come from a material table in the shader, multiplied by the same day and night grade the basemap colours get (`daylight.state()`), so the roads darken with the map. Kerb faces are lit by the sun's direction.

Vertex positions are whole steps from the tile's origin. The origin is multiplied by the map matrix in double precision on the CPU and the steps by a scaled matrix in the shader, the method `solid-facades.js` uses, so there is no jitter at close zoom.

## Tile format

Tiles are Web Mercator zoom 15 (about 900 m across in Sofia). One step is 1/49152 of a tile (about 1.8 cm on the ground), and a vertex may lie up to 8192 steps outside its tile, so positions fit `uint16`. Steps are global, which makes a point shared by two tiles identical in both.

The file is gzipped. Little endian:

| Part | Content |
|---|---|
| Header, 44 bytes | `SRD1`, `uint16` version (1), `uint16` flags (bit 0: 32-bit indices), `uint32` vertex count, `uint32` index count, five `uint32` cumulative index counts (one per detail level), `int16` lowest and highest height in cm, `uint32` centreline bytes |
| Vertex columns | x, y, height and distance as `uint16` wrapping differences from the previous vertex, then material and flags as bytes, padded to 4 bytes |
| Indices | wrapping differences, `uint16` or `uint32`, padded to 4 bytes |
| Centrelines | `uint16` line count, then per line: kind (0 tram, 1 railway), point count, first x and y, then `int16` differences |

Columns of differences compress about twice as well as interleaved vertices. `roadStore.decode` adds them up into the vertex the GPU reads, 12 bytes: `uint16` x, `uint16` y, `int16` height in cm, `uint8` material, `uint8` flags, `uint16` distance in dm, 2 bytes unused.

Materials: 0 carriageway, 1 paving, 2 sidewalk, 3 kerb face, 4 tram track in the road, 5 tram bed, 6 ballast, 7 dashed line, 8 solid line, 9 zebra, 10 rail. Flags: 0 flat, 1 slope, 2 to 254 a vertical face and the direction it looks. Distances repeat every 63 m, a whole number of every stripe period.

## Generator rules

`python tools/prepare_roads.py ../old/osm-work/Sofia.osm.pbf --embed-radius 3` in the Python 3.12 venv in `old/osm-work` (osmium, shapely, numpy), then `python build.py`. It takes about two minutes and prints the tile count, total and largest tile bytes and the triangles per detail level. `--only X/Y` builds one tile and writes nothing.

- Roads: `highway` motorway to service, their links, and pedestrian. Tracks: `railway` tram, rail, light_rail, subway. Ways with `tunnel`, `covered=yes`, a negative `layer`, `location=underground` or `indoor=yes` are dropped.
- Width: `width`, else `lanes` × 3.25 m, else a default per class (see `WIDTH`).
- Carriageways are buffered centrelines, united per tile and simplified to 12 cm. Sidewalks are a 2 m wider buffer minus the carriageway minus building outlines, for primary to residential roads unless `sidewalk` says no.
- Markings stop 7 m plus half the road width from a junction. Major two-way roads get a solid centre line, tertiary roads a dashed one, multi-lane roads dashed lane lines. Crossing nodes get a 3 m zebra unless tagged unmarked.
- Tram gauge is 1009 mm unless `gauge` is mapped. A tram track piece whose middle lies on a carriageway is set into the road; otherwise it gets its own bed.
- Work is done in Web Mercator with widths multiplied by the local scale (under 0.2 % from true metres across Sofia) rather than in UTM.

Current output (BBBike Sofia, 2026-11-07): 1,039 tiles, 10.3 MB gzipped, largest tile 74 KB and 14,000 triangles, median tile 676 triangles. The hosted page grows by 86 KB (the tile index); the standalone page by 1.8 MB.

## Verify

- `node --test tests/*.test.cjs`: `tests/roads.test.cjs` decodes every published tile, checks levels, materials, heights and centreline joins across tiles, and exercises requests, coverage, the memory budget, retry after a failure and the governor.
- `python tests/roads-browser.py OUTPUT_DIR [--phone] [--standalone]` (the venv in `old/osm-work`, Chrome): renders six cameras with the meshes and five close details without buildings, checks that the flat lines are hidden only while covered and that a tunnel layer is untouched, the switch and its persistence, the zoom gate, a night render, then replays a follow drift and a 240 m drag with the switch on and off under 4× CPU throttling, a long pan against a 3 MB budget, and a page without `DecompressionStream`. It writes `report.json` beside the screenshots.
- Headless Chrome draws with SwiftShader: its frame times only compare on against off. On a phone, open the performance overlay and compare a long pan and a crowded follow with the switch on and off; the Diagnostics row **3D roads** shows tiles, memory, draws, triangles and any governor step.

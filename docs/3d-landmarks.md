# Landmark, monument and mall models (3D view)

The tilted map draws hand-built models of Sofia's best-known buildings and monuments, a parametric model of every other monument, statue, bust and memorial, and a footprint-based model of every large mall. They appear from MapLibre zoom 12 in every appearance mode, take the day and night light, light their windows after dark and cast ground shadows like the other custom layers.

## Sites

| Kind | Sites | Model |
|---|---|---|
| Landmark buildings | Alexander Nevsky Cathedral, National Palace of Culture, Ivan Vazov National Theatre, Sveta Nedelya, Banya Bashi Mosque, Russian Church, the Largo's former Party House, the old TV tower, the Synagogue | One builder each in `landmarks.js`: gilded and copper domes, bell tower, portico with pediment, minaret, tent spire and onion domes, stepped tower with spire, glazed platforms and mast |
| Monuments | Tsar Liberator, Sveta Sofia, Vasil Levski | Pedestal with horseman, column with figure, obelisk |
| Stadiums | Vasil Levski National, Bulgarian Army (CSKA), Georgi Asparuhov (Levski), Lokomotiv, Slavia | One `stadium` builder from the mapped outline: striped pitch with markings and goals, a running track at the National and Lokomotiv, seating tiers in club colours rising to the outline, a lit concourse band, a cantilevered roof where the ground has one, floodlight masts. Stand height and colours per ground are in the builder's table |
| Universities | Sofia University rectorate, Technical University block 1, UACEG, New Bulgarian University building 3, National Academy of Arts | One `university` builder from the mapped outline: stone with tall windows, cornice, six-column portico and pediment for Sofia University (plus its copper dome) and the Academy of Arts; banded concrete and glass with roof plant and a glass entrance for the others, and a slab over UACEG's podium. Each flies the Bulgarian flag |
| Malls | 19 buildings mapped as malls with at least 2,000 m² | The mapped outline with glazed shopfronts, panelled walls under a colour band, a glass entrance on the longest side, a skylight and roof plant where they fit. Wall and band colours vary by site |

Positions, outlines and long-axis bearings come from OpenStreetMap. Heights of the hand-built models follow published figures (bell tower 53 m, TV tower 106 m, Sveta Nedelya's dome 31 m, Sveta Sofia 24 m, Levski obelisk 13 m). Details such as window counts, column spacing and the horseman are illustrative. A mall takes its mapped height, or 5.5 m a level, or 14 m.

## Monuments

Every three-dimensional monument in the OpenStreetMap extract gets a model: `historic=monument`, `historic=memorial` (except plaques, Stolpersteine, benches and graves) and `tourism=artwork` (except murals, graffiti, paintings, mosaics, reliefs and poems), outdoors only, plus any object that has a spec (the Monument to the Soviet Army, mapped as `was:historic=monument` since its figures were removed in 2023, is drawn as its bare shaft). The flat Alley of Glory is skipped. Hand-built landmarks keep their own builder, and the same monument mapped twice within 3 m is drawn once.

Each monument site (`k: "monument"`) carries a spec `s` that `src/features/view3d/monument-models.js` turns into a low-poly model of a few hundred triangles:

| Field | Values |
|---|---|
| `form` | `statue`, `seated`, `bust`, `head`, `equestrian`, `group`, `obelisk`, `stele`, `column`, `cross`, `stone`, `wall`, `arch`, `pylon`, `abstract`, `animal`, `bird`, `flame`, `aircraft`, `fountain`, `bells` (The Bells: four leaning pylons and a ring of bells, `ring_d` across) |
| `pose` | Figures: `stand`, `stride`, `arm` (raised), `robe`, `soldier`, `book`, `sword`, `child`, `dancer`, `sport` |
| `pedestal` | `none`, `low`, `block`, `tall`, `stepped`, `rock`, `herm` |
| `figure_h`, `pedestal_h`, `total_h`, `width`, `depth`, `shaft_w` | Metres. A `width` much wider than the figure's pedestal is drawn as a low platform under it. For an obelisk, column or pylon a `pedestal_h` over 1.5 m is the shaft, and `shaft_w` sets the shaft's base |
| `material`, `pedestal_material` | `bronze`, `dark_bronze`, `green_bronze`, `gilded`, `white_stone`, `limestone`, `granite`, `dark_granite`, `marble`, `concrete`, `steel`, `painted`; `color` overrides with `#rrggbb` |
| `figures`, `top`, `animal`, `lying`, `features` | Group size; what stands on a column or pylon (`figure`, `lion`, `star`, `cross`, `eagle`); the animal; extras such as `lion`, `relief`, `wings`, `rearing` |

Each site also keeps its OSM `key` (`n…`, `w…`, `r…`). The spec comes from `tools/monument_specs*.json` when the monument was inspected (photos, Wikipedia and other sources; each row records its `source`, `refs` and `confidence`), and otherwise from the OSM tags and name (`spec_from_tags()` in `tools/monument_sites.py`): the memorial or artwork type picks the form, words in the name pick saints' robes, soldiers, animals and groups, and `material` and `height` are used when mapped. The front faces the spec's `facing`, else the nearest street or path within 40 m. Tiny building features under a monument (a pedestal mapped as a building) are replaced by the model.

Monuments under 10 m appear from MapLibre zoom 15 (`z` on the site; 16 on the flat map); larger ones from zoom 12 like the landmarks. The 3D view now zooms to MapLibre 20, two levels past the flat map, so a 3 m statue can be seen; returning to the flat map eases back to its limit first.

## How it is drawn

- `src/features/view3d/landmark-data.js` is generated: one row per site with its centre, bearing, outline in the site's own frame (u along the long axis, v to its left, metres), height and the ids of the bundled building features it replaces. Regenerate it with `python tools/landmark_data.py PATH/Sofia.osm.pbf` (needs osmium, shapely and mapbox_vector_tile, as in the `old/osm-work` venv); it reads the monument specs and calls `tools/monument_sites.py`. Add a landmark by adding it to `LANDMARKS` there and a builder of the same name in `landmarks.js`.
- `src/features/view3d/landmarks.js` holds the drawing kit (boxes, outline prisms, tubes, domes, gables, window grids, rods between any two points, balls, rocks, and `placed()` for a part built in its own turned frame) and the builders. `monument-models.js` registers the `monument` builder through `landmarks.define()`. Meshes are built once per site and cached.
- The models are drawn by the fixed-model mode of the layer in `bulgarian-houses.js`, the same one that draws the metro roofs. `building-materials.js` adds it as `<material layer>-landmarks`.
- `landmarks.filter()` removes the replaced building features from the extrusion layer, in legacy or expression filter syntax to match the style. Walls and house designs read that layer, so they skip those buildings too. Mall parts taller than the mall, such as office towers above it, are kept.

The **Landmarks and monuments** switch turns the landmark and monument models off, and malls follow **3D buildings**: see [what the 3D view draws](3d-show-switches.md).

## Verify

- `node --test tests/*.test.cjs`: `tests/monuments.test.cjs` checks that every monument has a known form and a finite mesh on the ground near its point and within its height, that small ones wait for zoom 15 and that the switch hides them. `tests/landmarks.test.cjs` checks that every mesh is finite and stays on its site, landmark heights, mall heights and lit windows, both filter syntaxes and view culling.
- `tests/monuments-browser.py OUTPUT_DIR` screenshots ten monument sites close up with trees off.
- `tests/landmarks-browser.py OUTPUT_DIR` (the Python 3.12 venv in `old/osm-work`) screenshots ten cameras by day and after dark, once with the Shadows switch off, and checks the eased Ctrl+arrow turn.
- Terrain lifts each model by the elevation at its centre only. Appearance on a physical phone remains open.

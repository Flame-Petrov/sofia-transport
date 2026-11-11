# Landmark and mall models (3D view)

The tilted map draws hand-built models of Sofia's best-known buildings and monuments and a footprint-based model of every large mall. They appear from MapLibre zoom 12 in every appearance mode, take the day and night light, light their windows after dark and cast ground shadows like the other custom layers.

## Sites

| Kind | Sites | Model |
|---|---|---|
| Landmark buildings | Alexander Nevsky Cathedral, National Palace of Culture, Ivan Vazov National Theatre, Sveta Nedelya, Banya Bashi Mosque, Russian Church, the Largo's former Party House, the old TV tower, the Synagogue | One builder each in `landmarks.js`: gilded and copper domes, bell tower, portico with pediment, minaret, tent spire and onion domes, stepped tower with spire, glazed platforms and mast |
| Monuments | Tsar Liberator, Sveta Sofia, Vasil Levski | Pedestal with horseman, column with figure, obelisk |
| Malls | 19 buildings mapped as malls with at least 2,000 m² | The mapped outline with glazed shopfronts, panelled walls under a colour band, a glass entrance on the longest side, a skylight and roof plant where they fit. Wall and band colours vary by site |

Positions, outlines and long-axis bearings come from OpenStreetMap. Heights of the hand-built models follow published figures (bell tower 53 m, TV tower 106 m, Sveta Nedelya's dome 31 m, Sveta Sofia 24 m, Levski obelisk 13 m). Details such as window counts, column spacing and the horseman are illustrative. A mall takes its mapped height, or 5.5 m a level, or 14 m.

## How it is drawn

- `src/features/view3d/landmark-data.js` is generated: one row per site with its centre, bearing, outline in the site's own frame (u along the long axis, v to its left, metres), height and the ids of the bundled building features it replaces. Regenerate it with `python tools/landmark_data.py PATH/Sofia.osm.pbf` (needs osmium, shapely and mapbox_vector_tile, as in the `old/osm-work` venv). Add a landmark by adding it to `LANDMARKS` there and a builder of the same name in `landmarks.js`.
- `src/features/view3d/landmarks.js` holds the drawing kit (boxes, outline prisms, tubes, domes, gables, window grids) and the builders. Meshes are built once per site and cached.
- The models are drawn by the fixed-model mode of the layer in `bulgarian-houses.js`, the same one that draws the metro roofs. `building-materials.js` adds it as `<material layer>-landmarks`.
- `landmarks.filter()` removes the replaced building features from the extrusion layer, in legacy or expression filter syntax to match the style. Walls and house designs read that layer, so they skip those buildings too. Mall parts taller than the mall, such as office towers above it, are kept.

The **Landmarks and monuments** switch turns the landmark and monument models off, and malls follow **3D buildings**: see [what the 3D view draws](3d-show-switches.md).

## Verify

- `node --test tests/*.test.cjs`: `tests/landmarks.test.cjs` checks that every mesh is finite and stays on its site, landmark heights, mall heights and lit windows, both filter syntaxes and view culling.
- `tests/landmarks-browser.py OUTPUT_DIR` (the Python 3.12 venv in `old/osm-work`) screenshots ten cameras by day and after dark, once with the Shadows switch off, and checks the eased Ctrl+arrow turn.
- Terrain lifts each model by the elevation at its centre only. Appearance on a physical phone remains open.

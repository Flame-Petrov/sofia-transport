# What the 3D view draws: vehicles, buildings, landmarks, trees

Four switches in the 3D section of the menu choose what stands on the tilted map. Each is on by default and saved on its own.

| Switch | Off hides | Saved as (on unless `0`) |
|---|---|---|
| **3D vehicle models** | The tram, bus, trolleybus and metro meshes at close zoom. Vehicles stay on the map as their usual markers with line numbers | `sofia_3d_vehicle_models` |
| **3D buildings** | Every ordinary building: extrusions, textured walls, house designs, metro roofs and mall models. The texture and house switches are hidden while it is off | `sofia_3d_buildings` |
| **Landmarks and monuments** | The landmark buildings, stadiums and universities, and every monument, statue, bust and memorial ([landmarks](3d-landmarks.md)). With buildings on, each landmark returns as its plain mapped building | `sofia_3d_landmarks` |
| **Trees** | Mapped trees, tree rows, and the trees filling parks and woods ([trees](3d-trees.md)) | `sofia_3d_trees` |

Combinations: buildings off with landmarks on leaves the landmarks, monuments and vehicles on an open map. Both off leaves only the vehicles. The landmarks and trees switches are hidden in browsers without `DecompressionStream`, where those models are not drawn at all.

## How it works

- `src/features/view3d/menu.html` holds the switches in `#v3ShowRow`. `view.js` restores them, saves changes and calls `applyBuildingTextures()` or `view3d.vehicleSceneChanged()`.
- Vehicles: the fleet pass in `view.js` gives a vehicle a model only when the switch is on (`close`), so markers, line numbers, taps and follow fall back to the same paths used below model zoom.
- Buildings: `buildingMaterials.apply(map, textures, houses, show, prepared)` sets the visibility of the style's building extrusion and of its `-material` copy. The wall layer (`solid-facades.js`), the house layer and the metro roofs sleep while the material layer is hidden. Where the prepared tiles cannot be read, only the style's own extrusion is toggled. A layer the style itself hides is left alone.
- Trees: `trees.setShown(on)` puts the tree layer to sleep; nothing else changes.
- Landmarks: `landmarks.setShown(landmarks, malls)` decides which sites `visible()` returns and which building ids `filter()` removes. Malls follow the buildings switch. The landmark layer decides for itself whether to draw through `awake()`, so it stays up while the building layer is hidden. `apply` updates the material layer's filter only when it changes, because that reloads the tiles.

## Verify

- `node --test tests/*.test.cjs`: `tests/landmarks.test.cjs` checks the sites and filter for each combination.
- `tests/show-switches-browser.py OUTPUT_DIR` (the Python 3.12 venv in `old/osm-work`) flips the buildings and landmarks switches at NDK, checks layer visibility, drawn features, the filter and the hidden texture switches, screenshots each state and confirms all three switches survive a reload.
- The fixture has no live fleet. Check the vehicle switch on a live map: at zoom 17 or closer the meshes give way to markers, and Follow still works.

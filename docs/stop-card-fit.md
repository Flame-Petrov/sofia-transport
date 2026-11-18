# A stop's card stays inside the map

On desktop a stop's card (the Leaflet popup in 2D, the MapLibre card in 3D) keeps a 12 px gap between its edge and the map's top edge, so the browser's toolbar never covers the stop's name and the first lines.

## Behaviour

- The card's height is capped at 55% of the window, as before (`stopCardCap()`).
- When the stop sits too high for the full card (the map was dragged up, the window is short, a live update added lines, or automatic focus is off), only the card list gets shorter and scrolls; the head with the name and the close button stays visible. The card is never shorter than 160 px.
- When there is room again it grows back, up to the cap.
- A 2D popup always opens upwards, so only the gap above it counts. A 3D card anchored at its top (MapLibre opens it below the stop when there is no room above) keeps the gap at the map's bottom edge instead.
- The fit is recalculated when the card opens, when its content changes on a live update (the list keeps its scroll position), after every map move or zoom (`moveend`) and when the window is resized. It is not recalculated during a drag, only when the drag ends.
- The phone sheet is not affected.

## Source

- `src/shared/ui/sheet.js`: `STOP_CARD_GAP`, `STOP_CARD_MIN`, `stopCardCap()`, `fitStopCard(el)`, `fitStopCards()` (2D `moveend`, window `resize`) and the calls in `refreshStopViews()`.
- `src/features/stops/markers.js`: the 2D popup's content function sets the cap; `popupopen` fits it.
- `src/features/view3d/view.js`: `openPop('stop')` sets the cap and fits; the 3D `moveend` handler refits an open stop card.

## Verify

`tests/stop-card-fit-browser.py OUTPUT_DIR` (Python 3.12 venv in `old/osm-work`, Chrome, live feed) opens the busiest stop near NDK at 870 × 840 and 1280 × 700, once with the fit switched off (`before`) and once on (`after`), then drags the map up by 150 px. It records the card's top relative to the map in `report.json`; `pass` requires every `after` card to start at least 12 px below the map's top.

By hand: on a desktop window about 850 px tall, open a stop with several lines and drag the map up until the stop is in the upper half. The card's head should stay in view with a small gap, and its list should scroll.

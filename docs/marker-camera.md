# Marker clicks and camera arrival

Clicking a stop or vehicle frames the marker before revealing its details. The flat map waits for Leaflet camera arrival in `src/shared/map/focus.js`. Stop markers bind their click in `src/features/stops/markers.js`. On phones, `src/shared/ui/sheet.js` measures the stop sheet before moving the camera so that the stop stays visible above it. The tilted view uses MapLibre movement events in `src/features/view3d/view.js`.

To verify, click an off-center stop and then a vehicle in each view. Watch the marker reach its target before the card appears. Repeat at phone width and tap a second marker during the first move. Only the last marker's details should appear.

Selecting a live or estimated arrival in a stop card closes the card and starts following that vehicle at zoom 15. The stop stays selected for progress and ETA updates. Stop buttons are rendered in `src/features/stops/popup.js`; `src/features/vehicles/focus.js` hands their selection to `src/features/vehicles/follow.js`. To verify, pick a distant arrival, check that Follow is active, and watch the vehicle move. Tap the stop progress indicator for a route overview, then pick the same arrival again to resume follow.

# Marker clicks and camera arrival

Clicking a stop or vehicle frames the marker before revealing its details. The flat map waits for Leaflet camera arrival in `src/shared/map/focus.js`. Stop markers bind their click in `src/features/stops/markers.js`. On phones, `src/shared/ui/sheet.js` measures the stop sheet before moving the camera so that the stop stays visible above it. The tilted view uses MapLibre movement events in `src/features/view3d/view.js`.

To verify, click an off-center stop and then a vehicle in each view. Watch the marker reach its target before the card appears. Repeat at phone width and tap a second marker during the first move. Only the last marker's details should appear.

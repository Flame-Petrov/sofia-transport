# Marker clicks and camera arrival

Clicking Follow on a vehicle dismisses its popup or phone sheet and keeps the camera on that vehicle. The transition lives in `src/features/vehicles/follow.js`. To check it, open a vehicle directly from the map, click Follow, and confirm the card closes and Follow stays active. Tap the vehicle again to reopen its details.

Clicking a stop or vehicle frames the marker before revealing its details. The flat map waits for Leaflet camera arrival in `src/shared/map/focus.js`. Stop markers bind their click in `src/features/stops/markers.js`. On phones, `src/shared/ui/sheet.js` measures the stop sheet before moving the camera so that the stop stays visible above it. The tilted view uses MapLibre movement events in `src/features/view3d/view.js`.

To verify, click an off-center stop and then a vehicle in each view. Watch the marker reach its target before the card appears. Repeat at phone width and tap a second marker during the first move. Only the last marker's details should appear.

Selecting a live or estimated arrival in a stop card closes the card and starts following that vehicle at the current map zoom. The stop stays selected for progress and ETA updates. Stop buttons are rendered in `src/features/stops/popup.js`; `src/features/vehicles/focus.js` hands their selection to `src/features/vehicles/follow.js`. To verify, pick a distant arrival in each map mode, confirm the zoom stays steady throughout the pan, check that Follow is active, and watch the vehicle move. Tap the stop progress indicator for a route overview, then pick the same arrival again to resume follow.

## Metro trains from the station board

During a scheduled run, tap its time on a metro station board to follow that train with the station selected. Later runs become selectable at their first scheduled call. A train card identifies the position as a timetable estimate. The marker leaves the map at the final call.

`src/features/stops/metro.js` matches the service-day trip instance to its station times and projects successive stations onto its directed GTFS shape. If the shape is missing or cannot be matched at every station, it uses the line through the station coordinates. Motion covers the distance between calls in their scheduled interval. The 3D route head and arrows are rebuilt from the tracked position when the route sources change. To check, follow a moving metro train, switch to 3D and verify the highlight starts under the train as it crosses route vertices. The board uses the same instance for its Follow button. In close 3D view the train uses the existing rail vehicle mesh and floating line number.

To check, open a station during service, tap an active time, and compare the selected line, destination and station countdown. Open the train card, then follow across a station call in both map modes. Verify another departure on the same line selects its own train.

Metro trips use distance-weighted track geometry from `src/features/vehicles/route-line.js` for tracking, timetable motion, journey legs and previews. The timetable fallback applies the same filter to station coordinates. Vehicle selection skips road matching for metro. To verify, follow M1 or M4 through Konstantin Velichkov and M2 through NDK at close zoom and compare the line, arrows and train in both views.

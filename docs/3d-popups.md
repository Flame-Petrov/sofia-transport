# 3D map popups

On desktop, stop, vehicle and place popups sit above every map marker. Marker priorities are assigned in src/features/view3d/view.js; src/features/view3d/view.css sets the shared popup priority above them.

To check, track a metro train in 3D, open a nearby station and pan until the train overlaps the timetable. The card should cover the train and its controls should remain clickable.

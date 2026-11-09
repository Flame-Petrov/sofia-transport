# 3D map controls

Each time the 3D button opens the tilted map, an illustrated guide appears. Okay dismisses it and focuses the map. With the map focused, Ctrl+Left/Right turns the camera by 10° and Ctrl+Up/Down adjusts tilt by 5° within the map's pitch limits. The shortcuts belong to the 3D canvas so they leave search and the flat map alone.

The dialog and its city drawing live in `src/features/view3d/controls-dialog.html`, included from `src/page.html`. The feature's `view.css` styles it and `view.js` handles opening, dismissal and keyboard input.

To verify, open 3D, press Okay, and try all four shortcuts once the map appears. Switch to 2D and open 3D again: the guide should return. On touchscreens, dismiss it and rotate the map with a two-finger twist.

While following a vehicle, right-drag, twist with two fingers, or press Ctrl+Left/Right to orbit it. Release the control and check that the camera keeps the chosen bearing as the vehicle moves. Tap the compass to resume the previous heading-up or north-up setting. A one-finger pan can still leave Follow. The vehicle camera and gesture handlers live in `src/features/view3d/view.js`.

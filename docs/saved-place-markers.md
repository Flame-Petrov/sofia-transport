# Saved place markers

Click or tap a saved marker, then choose Flag, Home, Work, or Star under **Map marker**. The choice applies immediately to that place in the flat map, tilted map and My places list. Existing places start with Flag. The destination keeps its highlight.

The picker, icon definitions and local storage update live in `src/features/places/places.js`. Its styles are in `src/features/places/pins.css`. The tilted map reuses the icon renderer in `src/features/view3d/view.js`.

To verify, open a flag, choose Home and reopen the popup after a reload. Check the Home button is selected and the marker matches it. Switch map modes and check the same place.

Open **Marker color** to choose a custom color for this place. The icon uses that color in both map modes and in My places. The map label background matches the custom color, including for the active destination. Its name and distance use contrasting black or white text. Check both a light and a dark color. **Reset** restores the automatic marker color. To verify, choose a color, reload, switch map modes, and use Reset in the popup.

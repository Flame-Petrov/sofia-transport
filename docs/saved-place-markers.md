# Saved place markers

Tap a saved pin to open its Metro Ticket popup. Start route opens journey planning. Set as destination (or Clear destination) changes the active place. The three-dot button opens Edit marker, Rename, Move pin and Delete saved place. Deletion requires a second tap within three seconds.

Edit marker shows Flag, Home, Work and Star, a color picker, and Reset. Changes preview on the pin. Reset selects the automatic color, which follows destination status. Save changes applies the draft to the flat map, tilted map and My places list. Back, Escape or closing the popup discards it. Older places without a marker setting use Flag. A custom color also tints the map label with contrasting text.

The popup, saved data and Leaflet marker rendering live in `src/features/places/places.js`. The ticket styles live in `src/features/places/pins.css`. The tilted map reuses the renderer and draft appearance in `src/features/view3d/view.js`.

To verify, open a saved pin, choose More options and Edit marker, select another icon and color, then use Back. Reopen the editor and check the previous settings. Repeat with Save changes, reload, and confirm the new icon and color. Switch map modes and repeat with Reset. Also check the destination toggle and the two-tap delete prompt.

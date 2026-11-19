# Hover in 3D: vehicles and stops grow under the mouse

Release 110. On the tilted map, as on the flat one, the vehicle or stop under the mouse grows a little, comes to the front and the pointer becomes a hand. Before this the 3D map did nothing on hover: its vehicles and stops are drawn by MapLibre layers and a canvas, so the flat map's CSS `:hover` (`src/features/stops/markers.css`) never reached them.

## What the rider sees

| Under the mouse | Result (over 0.2 s, back the same way when the mouse leaves) |
|---|---|
| A vehicle's line number (MapLibre zoom 14 and closer, or a searched line) | 1.3 times bigger, redrawn sharp at that size, with a soft shadow, drawn over the other numbers |
| A vehicle dot (farther out, and the far dots toward the horizon) | 1.8 times bigger (5 to 9 px at app zoom 16, as in 2D), drawn over the other dots |
| A 3D vehicle model's body | Its line number grows as above |
| A stop icon (the all-stops layer, `v3-stops`) | 1.3 times bigger, drawn over the other stops. An open (selected) stop stays at its 1.6 times |
| A stop drawn as an HTML marker (your stop, a searched line's stops) | The flat map's CSS hover already applies |

- **Order:** the same as a click: a vehicle's number or dot first, then a stop icon, then a model's body. So what grows is what a click opens.
- **Mouse only:** only where `(hover: hover)` matches. On a phone or tablet (Android, iPhone) a tap leaves nothing enlarged.
- **A drag grows nothing:** a pressed button or MapLibre's `dragstart` clears the hover.
- **Moving vehicles:** a vehicle that drives under a resting pointer, or a camera that glides, is looked at again at most 10 times a second.

## Source

| File | Owns |
|---|---|
| `src/features/view3d/view.js` | `hov` (the hovered key `v:<vehicle>` or `s:<stop id>` and the one shrinking back, 0 to 1 each, eased out), `hoverKeyAt()`, `hoverSet()`, `hoverTick()`, `hoverApply()` (rewrites `circle-radius` of `v3-veh-dot` and `v3-veh-far` with `dotRadius()` and `icon-size` of `v3-stops` with `stopSize()` while they grow, and the sort keys `dotOrder()` and `stopOrder()` on a change), the number overlay's `paint()` (a hovered badge from the 1.3x `numberBadge(…, big)`, drawn last), and the `mousemove`, `mouseout`, `dragstart` and `move` handlers. `stopItemAt()` is the stop lookup shared with `stopAtPoint()`. Stop features carry their id as `sid` |
| Constants | `HOVER_GROW` 1.3, `HOVER_DOT` 1.8, `HOVER_MS3` 200 ms |

## Verify

- `tests/3d-hover-browser.py OUTPUT_DIR` (Python 3.12 venv in `old/osm-work`; live feed and the real basemap). On a desktop (1280 × 800), it hovers a stop icon (1.3 times, hand cursor, back to normal after leaving it), a vehicle number (MapLibre zoom 15.6) and a vehicle dot (zoom 13.2, 1.8 times), and checks that a drag grows nothing. On an Android phone (390 × 844, touch), it checks that a mouse event grows nothing. It saves crops before and after each hover and fails on any page error.
- Not covered by a test: a physical PC mouse on a real GPU and a physical Android or iPhone.

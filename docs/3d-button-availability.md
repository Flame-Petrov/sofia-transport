# When the 3D button is shown

The **3D** button (bottom right) appears only on the vector map. It also stays hidden for a day (`VIEW3D_RETRY_MS` in `src/config.js`) after the 3D view crashed on the device. This guard exists because an iPhone can kill a page that uses too much graphics memory, and reopening 3D would only crash it again. While the button is hidden, the map menu shows a note with the time and reason and a **Try 3D again** button (`#v3Box` in `src/features/view3d/menu.html`). Diagnostics shows the same reason under 3D → Status.

Owner: `src/features/view3d/view.js` (`memo()`, `available()`, `refresh()`, `onLost()` and the `visibilitychange` listener).

## What counts as a crash

| Event | Result |
|---|---|
| The 3D map's WebGL context is lost **while the page is on screen** | 3D closes, memo `graphics memory lost`, button hidden for a day |
| The page starts and finds `sofia_3d_open` set less than 10 min ago | memo `the page reloaded while 3D was open`, button hidden for a day |
| The context is lost **while the page is in the background**, or within 3 s of it returning (`BACKGROUND_LOSS_MS`) | No memo. 3D closes and reopens as soon as the page is visible again, without the controls guide |
| The tab is discarded in the background and opened again | No memo: `sofia_3d_open` is removed when the page goes hidden |
| 10 min or more in the background | 3D closes (iOS kills hidden tabs that hold a lot of graphics memory). No memo, and it does not reopen by itself |

`sofia_3d_open` holds the time 3D was last on screen. It is written when 3D opens and when the page becomes visible with 3D on (`markOpen()`). It is removed on `pagehide`, when the page goes hidden, and when 3D closes.

### Why the background cases are excluded (2026-11-16)

On phones the 3D button disappeared after the rider used another app and came back. Two background events were being counted as crashes:

1. **Android Chrome and iOS take a background tab's WebGL context back** when another app needs GPU memory. The loss was treated as running out of memory in 3D.
2. **A phone discards a background tab without `pagehide`.** The next start found `sofia_3d_open` still set and assumed the page had died in 3D.

Neither event comes from the 3D view's own memory use, so neither hides the button now.

## Verify

```
old/osm-work/venv/Scripts/python site/tests/view3d-background-browser.py "debug images/<date>-3d-button"
```

The script runs headless Chrome with an Android user agent at 390 × 844 and a 3× pixel ratio. It loses the 3D context while the page is hidden, crashes the renderer while hidden (`chrome://crash`) and does both again on screen. The first two must keep the button, and 3D must come back after a background context loss. The last two must still hide the button. To bring the button back on a device by hand, use **Try 3D again** in the menu.

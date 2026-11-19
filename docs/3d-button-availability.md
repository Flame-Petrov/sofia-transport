# When the 3D button is shown

The **3D** button (bottom right) appears only on the vector map (on the image map it stays hidden: 3D needs the vector style).

After the 3D view crashed on the device, 3D is **paused** for a day (`VIEW3D_RETRY_MS` in `src/config.js`). This guard exists because an iPhone can kill a page that uses too much graphics memory, and reopening 3D would only crash it again. Since 2026-11-19 the button **stays** while 3D is paused: its label turns grey and it gets a **red dot** (`.leaflet-control-3d.issue`). A tap on it does not open 3D; it opens a dialog (`#v3Issue`, `src/features/view3d/issue-dialog.html`) that says exactly what happened, when, and when 3D comes back by itself, with **Try 3D again** (clears the pause and opens 3D) and **Not now**. The map menu shows the same text and button (`#v3Box` in `menu.html`), and Diagnostics shows the reason under 3D → Status ("Paused (red dot): …").

| Pause reason (`sofia_3d_memo.why`) | Text in the dialog |
|---|---|
| `graphics memory lost` | The device ran out of graphics memory while the 3D view was on screen, so the browser stopped drawing it (WebGL context lost). |
| `the page reloaded while 3D was open` | The page restarted while the 3D view was open. The browser most likely closed it because 3D used too much memory. |
| `could not start` (with `err`) | The 3D view could not start: *the browser's message* (for example no WebGL). New on 2026-11-19: this used to be a toast only. |

Owner: `src/features/view3d/view.js` (`memo()`, `canDraw()`, `available()`, `issueText()`, `showIssue()`, `retry3d()`, `refresh()`, `onLost()`, `view3d.toggle` and the `visibilitychange` listener); dot and dialog styles in `view.css`.

## What counts as a crash

| Event | Result |
|---|---|
| The 3D map's WebGL context is lost **while the page is on screen** | 3D closes, memo `graphics memory lost`, paused for a day (red dot) |
| The page starts and finds `sofia_3d_open` set less than 10 min ago | memo `the page reloaded while 3D was open`, paused for a day (red dot) |
| `new maplibregl.Map` throws when 3D opens | memo `could not start`, paused for a day (red dot) |
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

The script runs headless Chrome with an Android user agent at 390 × 844 and a 3× pixel ratio. It loses the 3D context while the page is hidden, crashes the renderer while hidden (`chrome://crash`) and does both again on screen. The first two must keep the button without a dot, and 3D must come back after a background context loss. The last two must pause 3D: the button stays with the red dot; after the on-screen loss a tap on it must open the dialog with the graphics-memory reason, and **Try 3D again** must open 3D with the pause cleared (8 checks).

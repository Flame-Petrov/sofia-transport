# Live feed checks

The app checks the vehicle-positions file every second while the page is visible, and downloads trip updates every 15 seconds. Before release 105 both files were downloaded together every 5 seconds.

## What the feed does

Measured against `gtfs.sofiatraffic.bg` on 13 November 2026, 07:59–08:04 UTC (about 610 vehicles):

| | Vehicle positions | Trip updates |
|---|---|---|
| Size | ~70 KB | ~960 KB |
| Response time | median 46 ms, p90 71 ms | 340–720 ms |
| Rebuilt | every second (`header.timestamp` is the current second) | every request differs |

Each vehicle reports every 5 seconds (13,767 of 13,875 intervals were exactly 5 s) at its own second, so about 120 vehicles have a new report in each one-second file. A report is in the file about a second after the vehicle made it. The server sends no `ETag`, `Last-Modified` or compression, so a conditional or smaller request is not possible: the only lever is how often each file is fetched.

With a 5-second check, a report reached the app 1 to 6 seconds after the vehicle made it. With a 1-second check it arrives 1 to 2 seconds after.

## Behavior

- **Positions** are checked every `REFRESH_MS` (1 s). The next check starts one interval after the previous one started, or right after it ends if it took longer. Only one check runs at a time.
- **Data Saver** (`navigator.connection.saveData`, Chrome on Android) keeps the old 5-second pace (`REFRESH_SAVE_DATA_MS`). iPhone Safari has no such signal and uses 1 s.
- **Failures** double the wait from the base interval up to `REFRESH_MAX_MS` (15 s): 2, 4, 8, 15 s. The first successful check returns to the base pace. Coming back online forces a check at once.
- **A hidden page** stops checking. Showing it again checks at once and restarts the timer.
- **Trip updates** (ETAs, delays, the stop index) are downloaded every `TU_REFRESH_MS` (15 s), one download at a time, after a successful position check. A forced update (startup, the schedule finishing loading, back online) asks at once unless one is already downloading. Every live position carries its own trip ID, so vehicles never wait for trip updates to show their line.
- **Glide length.** Each new report plans a move that lasts until the vehicle's next report is expected (`feedInterval` in `motion.js`). It is now learned from the time between two sightings of a new report from the same vehicle (the median for each file, smoothed, 4–25 s). With 1-second checks that is about 5 s; with Data Saver or a failing feed it follows the slower checks. The time between checks would have said 1 s and the previous rule ignored gaps under 2 s, which would have left every glide at 10 s.
- **Unchanged vehicles** are cheap: `upsert` re-plans a vehicle only when its position or report time changed, and open vehicle and stop cards rebuild only when their HTML changed.

## Measured effect

`tests/live-feed-browser.py`, 13 November 2026 10:13–10:18 Sofia time, live feed (~640 vehicles), headless Chrome at 412 × 915 with an Android user agent, CPU throttled 4× after load, 45 s per run, releases alternated 104, 105, 104, 105:

| | 104 (5 s, together) | 105 (1 s / 15 s) |
|---|---|---|
| Age of a report when the app receives it (median; p90) | 2.97 s; 4.97 s · 2.70 s; 5.59 s | 1.01 s; 1.92 s · 1.40 s; 1.61 s |
| Position / trip-update requests in 45 s | 9 / 9 · 9 / 9 | 45 / 3 · 44 / 3 |
| Data per hour | 731 MB · 731 MB | 471 MB · 464 MB |
| Main thread busy | 15.7% · 19.1% | 16.4% · 23.2% |
| Frames per second | 39.8 · 38.9 | 38.5 · 36.9 |
| Long tasks (> 50 ms) | 12 · 16 | 3 · 12 |
| Learned glide length | 5,067 ms · 5,067 ms | 5,037 ms · 5,036 ms |

Positions reach the map about 2 s sooner and the worst case drops from 5–6 s to under 2 s. Data use falls by about a third, because the ~1 MB trip-update download no longer comes with every check. Main-thread time is a few points higher (the fleet is applied five times as often), within the run-to-run spread but probably real; long tasks fell. Screenshots of every run, the Diagnostics panel and `report.json` are in the workspace under `debug images/2026-11-13-faster-vehicle-checks/`.

## Where it lives

| File | Owns |
|---|---|
| `src/config.js` | `REFRESH_MS`, `REFRESH_SAVE_DATA_MS`, `REFRESH_MAX_MS`, `TU_REFRESH_MS` |
| `src/shared/transit/live-feed.js` | `update()` (one position check), `maybeRefreshTripUpdates()`, `learnReportInterval()`, `pollDelay()`, `poll()`, `startPolling()` |
| `src/main.js` | Starts the first forced check and the polling loop |
| `src/features/vehicles/motion.js` | `feedInterval`, the glide that uses it |
| `src/features/diagnostics/report.js` | **Checks** row and `checks:` line in the raw report |

## How to verify

1. `node --test tests/*.test.cjs` from `site/`. `tests/live-feed.test.cjs` covers the 1-second and 15-second cadences, a slow trip-update download, the learned glide length at 1-second and 15-second checks, Data Saver, failure backoff and a hidden page.
2. Open the numbered release, then **Diagnostics**. **Checks** reads "positions every 1 s · trip updates every 15 s" and **Report interval** settles at about 5 s. The status bar clock advances every second.
3. In the browser's network panel, `vehicle-positions` appears once a second and `trip-updates` once every 15 s. Switch to another tab: requests stop; switch back: one request at once.
4. For a before-and-after comparison on the live feed, run `tests/live-feed-browser.py` with the Playwright venv (see the script's header). It alternates two releases on a throttled phone layout and writes screenshots and `report.json` to the workspace's `debug images/<date>-faster-vehicle-checks/`.

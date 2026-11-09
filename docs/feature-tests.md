# Feature tests

From the app repository (`site/`), run the suite with Node.js 22.19 or later. It uses the built-in test runner and needs no package installation or network access.

```sh
node --test tests/*.test.cjs
```

To save a run, use a new dated filename.

```sh
node --test --test-reporter=tap --test-reporter-destination=tests/YYYY-MM-DD.tap tests/*.test.cjs
```

| Suite | Rider behavior covered |
| --- | --- |
| `tests/transit.test.cjs` | Builds a timetable from interleaved service rows, applies calendar exceptions, and checks overnight and daylight-saving ETAs. Plans a bus-to-metro journey, handles missed and prohibited transfers, rebuilds an old cache, and merges live arrivals with the metro station board. |
| `tests/rider-actions.test.cjs` | Searches by line, fleet number and plate, toggles a transport type, restores saved places and destinations after reload, accepts and releases a GPS watch, and completes walking guidance. |
| `tests/map.test.cjs` | Moves a vehicle through a bend and into its terminus, switches the 3D follow camera, decodes the shipped vehicle meshes, retries an offline download, and checks the phone performance overlay. |

`tests/app.cjs` loads whole production scripts into a fresh Node VM for each fixture. The tests supply the clock, decoded feed messages, storage and device interfaces. Map geometry, timetable compilation, routing, arrivals and persistence decisions run from the application source. The mesh test reads the three GLBs in `models/`.

The [rendering and asynchronous regression guide](rendering-performance.md) covers the additional stress tests and optional Chrome replay.

## November 9, 2026 run

The initial eight transit tests produced three failures. On a UTC device the tracked night bus lost its remaining stop, and an explicit spring transition date placed its service-day base three hours late. Both failures came from the tracked-stop calculation using the device's time zone. The third failure produced a two-ride journey through a transfer explicitly prohibited by the feed.

`src/features/stops/stops.js` now uses the feed's Sofia service date or the indexed service-day offset. `src/shared/transit/timetable.js` generates nearby walking links only when the transfers file is absent. The timetable cache version was advanced so existing riders receive the corrected transfer rules. The suite checks both the rebuild and the following cache read.

The [saved TAP log](../tests/2026-11-09.tap) records each test and its result. Both build artifacts passed the build check. The local launcher served release 102 byte-for-byte at both `/` and `/102_public-transport.html`. Live feed availability, physical GPS sensors and visual WebGL output require separate device checks.

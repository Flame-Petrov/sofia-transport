# Metro trains stop at stations

Sofia's metro has no live positions, so the app moves each metro train from the timetable (`src/features/stops/metro.js`, `updateTrains`). The feed gives one time per station: arrival and departure are equal for every metro stop (checked on the 2026-11-18 feed, 29,978 station gaps, all with zero dwell). Before release 108 a train therefore glided through every station at one constant speed.

## What a train does now

Between two stations the timetable gap (85 to 220 s on the current feed) is split into three parts:

1. **Standing.** The train stands at each station for 15 to 20 s. The dwell is centred on the timetable time: the train pulls in half a dwell before it and leaves half a dwell after it. A rider at the platform sees the train arrive before the time on the station board and leave after it.
2. **Running.** The rest of the gap is a trapezoid speed profile: it accelerates at 1.0 m/s², cruises, and brakes at 1.0 m/s², reaching the next station exactly when its half dwell begins. Cruise speed depends on the distance and the gap: about 30 to 70 km/h on the current timetable. When a gap is too short for that, the train accelerates and brakes harder with no cruise.
3. **Timetable kept.** Each motion plan still starts at its station's timetable time and ends at the next one's (`t0`, `dur` unchanged), so station boards, ETAs and journey plans do not change.

Each train and station gets its own dwell, from a hash of the train's key and the station's position in its trip (`dwellSec`), so trains don't all leave together and a train's dwell stays the same across refreshes. Together the two halves never take more than 60% of a gap.

## Source

- `src/features/stops/metro.js`: `DWELL_MIN`, `DWELL_MAX`, `ACCEL`, `BRAKE`, `dwellSec(run, i)` and `stationPlan(...)`, which returns a motion plan with its own `at(k)` profile. `updateTrains` builds one per timetable gap. Both are exposed on `metroTimetable` for tests.
- `src/features/vehicles/motion.js`: `routeS` uses a plan's `at(k)` when it has one, so the 2D markers, the 3D models, the follow camera and the selected-train route line all read the same position.

## How to check

- `node --test tests/transit.test.cjs`: the metro test checks the 15 to 20 s dwell range, that a train stands still at both ends of a gap, reaches the next station on its timetable time, never reverses, stays under 90 km/h and changes speed by at most about 1 m/s².
- `tests/metro-dwell-browser.py` (Playwright venv, needs the live schedule and metro service): loads a numbered release at phone size, samples every metro train four times a second for 150 s and reports how long each was seen standing at stations, whether every plan starts and ends on its timetable times, the top speed, screenshots of one train arriving, standing and leaving, and its speed chart. With `--expect-dwell` it fails unless every stop seen whole lasted 14 to 21 s.

```sh
../old/osm-work/venv/Scripts/python tests/metro-dwell-browser.py --release 108 --expect-dwell
```

By eye: open the map at a metro station at zoom 17 and watch a train come in. It slows down, stands for 15 to 20 s on the station, and pulls away gently.

## Results (2026-11-18)

`tests/metro-dwell-browser.py`, 150 s around 13:00 on a weekday, phone layout, about 33 trains. Shots and `*-report.json` are in the workspace under `debug images/2026-11-18-metro-dwell/`.

| | Release 107 (before) | Release 108 (after) |
| --- | --- | --- |
| Stops seen from arrival to departure | 0 (trains never stood still) | 32, standing 15.3 to 19.8 s |
| Plans on their timetable times | 71 of 71 | 67 of 67 |
| Top speed | 47 km/h | 69 km/h |
| Page errors | none | none |

The speed chart of the watched M3 train shows 107 holding a flat 27 km/h straight through a station (near NDK) and 108 braking to 0, standing about 16 s at Teatralna, then accelerating to a 30 km/h cruise.

Not verified: a physical Android or iPhone, and the 3D view. The 3D models read the same position, but no 3D run was made.

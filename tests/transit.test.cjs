const test = require('node:test');
const assert = require('node:assert/strict');
const { app, fixedDate, noop } = require('./app.cjs');

// Simulate a rider whose device clock uses a different zone from the agency.
process.env.TZ = 'UTC';
const today = '20261109';
const yesterday = '20261108';
const base = Date.parse('2026-11-08T22:00:00Z');

async function network(transfers) {
  const a = app(['features/stops/stops', 'features/vehicles/route-line',
    'features/stops/metro', 'shared/transit/timetable', 'features/journeys/planner',
    'shared/transit/live-feed', 'shared/transit/arrivals'], {
    Date: fixedDate('2026-11-08T22:00:00Z'), routes: { bus: { type: 3 }, rail: { type: 1 } },
    trips: { night: { sid: 'sun', route_id: 'bus' }, train: { sid: 'mon', route_id: 'rail' },
      suspended: { sid: 'removed', route_id: 'bus' } },
    vehicles: {}, activeTypes: { 1: true }, searchRoutes: null, twinsOf: id => [id],
    stopGrid: {}, STOP_GRID_DEG: 0.01, decode: message => message
  });
  const points = { A: 23.31, B: 23.35, C: 23.3504, D: 23.39 };
  for (const [id, lon] of Object.entries(points)) {
    const stop = { id, lat: 42.7, lon };
    a.stops[id] = stop;
    const cell = Math.floor(stop.lat / 0.01) + ':' + Math.floor(lon / 0.01);
    (a.stopGrid[cell] ??= []).push(stop);
  }
  const files = {
    'calendar.txt': 'service_id,monday,start_date,end_date\nremoved,1,20260101,20261231',
    'calendar_dates.txt': 'service_id,date,exception_type\nsun,20261108,1\nmon,20261109,1\nremoved,20261109,2',
    // Interleave trips and put the night bus rows in reverse sequence.
    'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n' +
      'night,24:10:00,,B,2\ntrain,00:13:00,,C,1\nsuspended,00:01:00,,A,1\n' +
      'night,24:05:00,,A,1\ntrain,00:20:00,,D,2\nsuspended,00:02:00,,D,2'
  };
  if (transfers !== null) {
    files['transfers.txt'] = 'from_stop_id,to_stop_id,transfer_type,min_transfer_time\n' + transfers;
  }
  a.zipLines = async (name, onLine) => {
    if (!(name in files)) return false;
    files[name].split('\n').forEach(onLine);
    return true;
  };
  const index = await a.ttBuild(today, 'fixture', base, yesterday, -86400);
  a.ttUse(index);
  return a;
}

function journey(a) {
  return a.raptor([{ s: a.ttStopIx.A, sec: 20 }], [{ s: a.ttStopIx.D, sec: 30 }], 0, {}, null);
}

test('service-day index restores split rows in order and excludes a cancelled service', async () => {
  const a = await network('B,C,2,60');
  assert.equal(a.ttTripDay('night'), -1);
  assert.equal(a.ttTripStops('suspended'), null);
  assert.deepEqual(Array.from(a.ttTripStops('night'), s => [s.stopId, s.arr]),
    [['A', 86700], ['B', 87000]]);
});

test('journey includes both rides, the published transfer, and the final walk', async () => {
  const a = await network('B,C,2,60');
  const run = journey(a);
  assert.equal(run.results.length, 1);
  const way = a.makeWay(run, run.results[0]);
  assert.deepEqual(Array.from(way.legs, l => l.kind === 'ride' ? l.tid : l.sec),
    [20, 'night', 60, 'train', 30]);
  assert.equal(way.arr, 1230);
});

test('a prohibited transfer between nearby stops cannot make a journey possible', async () => {
  const a = await network('B,C,3,');
  assert.equal(journey(a).results.length, 0);
});

test('without a transfers table the planner can walk to a nearby connection', async () => {
  const a = await network(null);
  assert.equal(journey(a).results[0].arr, 1230);
});

test('planning to a saved place offers two rides and switches to walking after a missed connection', async () => {
  const a = await network('B,C,2,60');
  const origin = { lat: a.stops.A.lat, lng: a.stops.A.lon };
  const plan = () => a.planWays(origin, a.stops.D);
  const first = (await plan()).ways[0];
  assert.deepEqual(Array.from(first.legs).filter(l => l.kind === 'ride').map(l => l.tid), ['night', 'train']);
  a.applyTripUpdates({ entity: [{ trip_update: { trip: { trip_id: 'night' }, delay: 300 } }] });
  const missed = (await plan()).ways;
  assert.deepEqual(Array.from(missed, way => way.sig), ['walk']);
});

test('a cached timetable with old transfer rules is rebuilt once and reused on reload', async () => {
  const a = await network('B,C,3,');
  let cached = { v: 2, day: today, id: '' }, builds = 0;
  Object.assign(a, {
    tt: null, staticState: 'ok', staticZip: { file: () => [] },
    render: noop, renderDiag: noop, refreshStopViews: noop,
    idb: { get: async () => cached, put: (table, key, value) => { cached = value; } },
    buildTimetable(day, id) {
      builds++;
      return a.ttBuild(day, id, base, yesterday, -86400);
    }
  });
  await a.ttEnsure();
  assert.equal(a.ttInfo.from, 'built');
  assert.equal(journey(a).results.length, 0);
  a.tt = null;
  await a.ttEnsure();
  assert.equal(a.ttInfo.from, 'saved');
  assert.equal(journey(a).results.length, 0);
  assert.equal(builds, 1);
});

test('tracked night bus shows the Sofia service-day ETA on a UTC device', async () => {
  const a = await network('B,C,2,60');
  a.tripStopsCache.night = a.ttTripStops('night');
  const rows = a.computeRouteStops({ d: { tripRef: 'night', curSeq: 2 } });
  assert.deepEqual(Array.from(rows, r => [r.stop.id, r.eta, r.realtime]), [['B', base + 600000, false]]);
});

test('explicit service dates use Sofia noon on both daylight-saving transitions', async () => {
  const a = await network(null);
  for (const [day, expected] of [
    ['20260329', '2026-03-28T21:00:00Z'], ['20261025', '2026-10-24T22:00:00Z']
  ]) {
    a.tuByTrip.night = { startDate: day };
    assert.equal(a.serviceBase('night'), Date.parse(expected), day);
  }
});

test('live arrivals resolve a vehicle, omit skipped stops, and merge with metro times', async () => {
  const a = await network('B,C,2,60');
  a.twinsOf = () => ['B', 'C'];
  a.vehicles.vehicle1 = {};
  a.applyTripUpdates({ entity: [{ trip_update: { trip: { trip_id: 'night' }, vehicle: { id: 'vehicle1' },
    stop_time_update: [
      { stop_id: 'A', schedule_relationship: 1, stop_sequence: 1 },
      { stop_id: 'B', stop_sequence: 2, arrival: { time: base / 1000 + 620 } }
    ] } }] });
  assert.equal(a.stopIndex.A, undefined);
  assert.deepEqual(Array.from(a.arrivalsAt('B'), r => [r.sid, r.key, r.t]),
    [['B', 'vehicle1', base + 620000], ['C', null, base + 780000]]);
  a.searchRoutes = { rail: true };
  assert.deepEqual(Array.from(a.arrivalsAt('B'), r => r.tripId), ['train']);
  a.activeTypes[1] = false;
  assert.equal(a.arrivalsAt('B').length, 0);
});

test('metro station board includes the hour boundary, marks the terminus and drops departed trains', async () => {
  const a = await network(null);
  const arrival = base + 1200000;
  const board = now => a.metroTimetable.upcoming('D', now, null);
  assert.equal(board(arrival - 3600001).length, 0);
  assert.equal(board(arrival - 3600000)[0].terminates, true);
  assert.equal(board(arrival)[0].t, arrival);
  assert.equal(board(arrival + 1).length, 0);
});

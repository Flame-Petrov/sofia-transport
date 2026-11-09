const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { app, noop, site } = require('./app.cjs');

test('IndexedDB request success followed by a transaction abort never counts as saved', async () => {
  const txs = [];
  const db = { transaction() {
    const request = {result: 'tile'};
    const tx = {request, objectStore: () => ({put: () => request})};
    txs.push(tx);
    return tx;
  }};
  const a = app(['shared/storage/cache'], { setTimeout: noop, indexedDB: {open() {
    const request = {result: db};
    queueMicrotask(() => request.onsuccess());
    return request;
  }}});
  for (const commit of [false, true]) {
    let settled = false;
    const result = a.idb.put('tiles', null, {url: 'tile'}).then(key => { settled = true; return key; });
    await new Promise(resolve => setImmediate(resolve));
    const tx = txs.at(-1);
    tx.request.onsuccess?.();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false);
    if (commit) tx.oncomplete();
    else tx.onabort();
    assert.equal(await result, commit ? 'tile' : null);
  }
});

test('a slow trip response cannot overwrite a later successful response or replay vehicle positions', async () => {
  const a = app(['shared/transit/live-feed'], { TU_URL: 'trips', TU_TIMEOUT_MS: 8000,
    decode: msg => msg, ovCache: {}, console: { warn: noop } });
  const pending = [], refreshes = [];
  a.fetchFeed = () => new Promise(resolve => pending.push(resolve));
  a.enrichPositions = () => false;
  a.refreshFeedViews = changed => refreshes.push(changed);
  a.applyPositions = () => assert.fail('Trip response replayed GPS');
  const msg = id => ({entity: [{trip_update: {trip: {trip_id: id}, vehicle: {id: 'bus'},
    stop_time_update: [{stop_id: 'A', arrival: {time: 200}}]}}]});
  const slow = a.refreshTripUpdates(1), fast = a.refreshTripUpdates(2);
  pending[1](msg('new'));
  await fast;
  pending[0](msg('old'));
  await slow;
  assert.equal(a.tuByVehicle.bus.trip_id, 'new');
  assert.equal(a.stopIndex.A[0].tripId, 'new');
  assert.deepEqual(refreshes, [false]);
  const broken = msg('partial');
  broken.entity.push({trip_update: {trip: {trip_id: 'bad'},stop_time_update: [null]}});
  const bad = a.refreshTripUpdates(3);
  pending[2](broken);
  await bad;
  assert.equal(a.lastTripSequence, 2);
  assert.deepEqual(Object.keys(a.tuByTrip), ['new']);
  assert.equal(a.stopIndex.A[0].tripId, 'new');
});

test('positions render while trip updates are pending and repeated GPS timestamps skip fleet rendering', async () => {
  const a = app(['shared/transit/live-feed'], { FEED_URL: 'positions', TU_URL: 'updates',
    FEED_TIMEOUT_MS: 8000, TU_TIMEOUT_MS: 8000, lastNewDataAt: 0, feedInterval: 9000,
    STALE_FEED_MS: 90000, decode: msg => msg, showReload: noop, setProgress: noop });
  let positions = 0, views = 0, statuses = 0;
  a.fetchFeed = url => url === 'positions' ? Promise.resolve({header: {timestamp: 100}}) : new Promise(noop);
  a.applyPositions = () => positions++;
  a.refreshFeedViews = () => views++;
  a.renderFeedStatus = () => statuses++;
  await a.update(false);
  assert.equal(a.busy, false);
  assert.deepEqual([positions, views], [1, 1]);
  await a.update(false);
  assert.deepEqual([positions, views, statuses], [1, 1, 1]);
});

test('failed model loads coalesce, respect retry time and decode a recovered asset only once', async () => {
  const bytes = readFileSync(path.join(site, 'models', 'bus.glb'));
  const requests = [], alarms = [];
  let now = 100, dirtied = 0;
  const a = app(['features/view3d/vehicle-models'], {
    TextDecoder, Date: {now: () => now}, setTimeout: (fn, ms) => alarms.push({fn, ms}),
    view3d: {vehicleSceneChanged: () => dirtied++},
    fetch: async url => {
      requests.push(url);
      return requests.length === 1 ? {ok: false, status: 503} :
        {ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)};
    }
  });
  a.vehicleMeshes[3] = 'models/bus.glb';
  assert.equal(a.availableVehicleMesh(3), undefined);
  assert.equal(a.availableVehicleMesh(3), undefined);
  await a.meshRequests[3];
  now += 29999;
  assert.equal(a.availableVehicleMesh(3), undefined);
  assert.equal(requests.length, 1);
  now += 2;
  assert.equal(alarms[0].ms, 30001);
  alarms[0].fn();
  a.availableVehicleMesh(3);
  await a.meshRequests[3];
  const mesh = a.availableVehicleMesh(3);
  assert.ok(mesh.length > 100 && mesh.every(Number.isFinite));
  assert.equal(a.availableVehicleMesh(3), mesh);
  assert.deepEqual(requests, ['models/bus.glb', 'models/bus.glb']);
  assert.equal(dirtied, 2);
});


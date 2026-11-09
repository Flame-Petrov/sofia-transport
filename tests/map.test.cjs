const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { app, noop, site } = require('./app.cjs');

test('a vehicle moves along its route and holds at the terminus after the segment ends', () => {
  const a = app(['features/vehicles/route-line', 'features/vehicles/direction-arrows',
    'features/vehicles/motion'], { window: {} });
  const track = a.pathMeta([[42.70, 23.30], [42.71, 23.30], [42.71, 23.32]]);
  const v = { mo: { kind: 'route', m: track, s0: 0, s1: track.total, t0: 1000, dur: 10000 } };
  assert.deepEqual(Array.from(a.posAt(v, 0)), [42.70, 23.30]);
  const corner = a.posAt(v, 1000 + 10000 * track.cum[1] / track.total);
  assert.ok(Math.abs(corner[0] - 42.71) < 1e-8 && Math.abs(corner[1] - 23.30) < 1e-8);
  assert.deepEqual(Array.from(a.posAt(v, 12000)), [42.71, 23.32]);
  assert.equal(v.along, track.total);
});

test('following a vehicle hands the camera to 3D and releases it when toggled off', () => {
  const calls = [];
  const selected = { pos: [42.7, 23.3], dot: { isPopupOpen: () => false } };
  const a = app(['features/vehicles/follow'], {
    selected, sheetVeh: null, followCam: {}, glLayer: null,
    setLocFollow: on => calls.push(['location', on]), refreshVehPopup: noop,
    view3d: { on: true, followChanged: on => calls.push(['follow', on]),
      flyFollow: vehicle => calls.push(['fly', vehicle]) },
    map: { options: {}, on: noop, _getMapPanePos: () => ({ x: 0, y: 0 }), fire: noop }
  });
  const button = a.document.getElementById('follow');
  button.onclick();
  assert.equal(a.map.options.touchZoom, 'center');
  assert.equal(a.following, true);
  button.onclick();
  assert.equal(a.following, false);
  assert.equal(a.map.options.touchZoom, true);
  assert.deepEqual(calls, [['location', false], ['follow', true], ['fly', selected], ['follow', false]]);
});

test('3D vehicle model decoder produces finite triangle data for each shipped model', () => {
  const a = app(['features/view3d/vehicle-models'], { TextDecoder, atob });
  assert.equal(a.vehicleMeshType(1), a.vehicleMeshType(0));
  for (const [type, name] of [[0, 'tram'], [3, 'bus'], [11, 'trolleybus']]) {
    assert.equal(a.vehicleMeshType(type), type);
    const model = readFileSync(path.join(site, 'models', name + '.glb'));
    const vertices = a.vehicleMeshVertices(model.toString('base64'));
    assert.ok(vertices.length > 0, name);
    assert.equal(vertices.length % 21, 0, name); // three vertices, seven floats each
    assert.ok(vertices.every(Number.isFinite), name);
  }
});

test('offline sync retries a failed tile, records the ready area, and reuses it on the next sync', async () => {
  const stored = new Map(), kept = {}, downloads = [];
  const area = { id: 'home', name: 'Home', b: [23.32, 42.69, 23.32, 42.69] };
  stored.set('sofia_offline_areas', JSON.stringify([area]));
  const a = app(['shared/ui/format', 'shared/ui/place-icons', 'shared/storage/preferences',
    'features/vehicles/route-line', 'shared/map/preload', 'features/offline/areas'], {
    localStorage: { getItem: k => stored.get(k), setItem: (k, v) => stored.set(k, v) },
    builtStyle: { sources: { streets: { type: 'vector', maxzoom: 9, tiles: ['ofm://tiles.test/{z}/{x}/{y}'] } } },
    keepUrls: {}, verSwap: false, mapMode: 'vector', storageOn: true, mapVer: 'fixture', mapVerAt: 0,
    renderDiag: noop, useVectorMap: noop, navigator: {}, setTimeout: noop,
    idb: { keptKeys: async () => ({ keys: { ...kept } }), get: async () => null, dropTiles: async () => {} },
    fetchTile: async url => {
      downloads.push(url);
      if (downloads.length === 1) throw new Error('offline');
      kept[url] = true;
      return new Uint8Array(64);
    }
  });
  await a.offline.sync();
  assert.equal(a.offline.info().ready, 0);
  assert.equal(JSON.parse(stored.get('sofia_offline_state')).home.failed, 1);
  const failedUrl = downloads[0];
  await a.offline.sync();
  assert.equal(a.offline.info().ready, 1);
  assert.equal(a.offline.info().bytes, 128);
  assert.deepEqual(downloads, ['https://tiles.test/8/144/94', 'https://tiles.test/9/289/188', failedUrl]);
  await a.offline.sync();
  assert.equal(downloads.length, 3);
});

test('performance overlay reports frame gaps and visible 3D markers on the phone layout', () => {
  const a = app(['features/diagnostics/performance'], {
    store: noop, isPhone: () => true, viewZoom: () => 17, searchStops: null,
    STOP_ZOOM: 16, LABEL_ZOOM: 16, VIEW3D_BUILDING_ZOOM: 15, mapMode: 'vector',
    view3d: { on: true, counts: () => ({ dots: 4, labels: 2, stops: 3 }) }
  });
  a.setPerf(true);
  for (const t of [1000, 1020, 1040, 1060, 1080]) a.perfFrames.push(t);
  a.perfText(1080);
  assert.equal(a.pf.pfFps.textContent, '50 fps · 20 ms');
  assert.equal(a.pf.pfCnt.textContent, 'v4 l2 s3');
  a.setPerf(false);
  assert.equal(a.perfEl.hidden, true);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { readFileSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { app, site } = require('./app.cjs');

const ROOT = path.join(site, 'tiles/roads/15');
const read = key => {
  const data = zlib.gunzipSync(readFileSync(path.join(ROOT, key + '.bin.gz')));
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
};
function fresh(table = {}, bounds = [100, 100, 110, 110]) {
  const context = app(['features/view3d/road-store'], { sofiaRoadTiles: table, sofiaRoadBounds: bounds, DecompressionStream: function () {} });
  return vm.runInContext('roadStore', context);
}
const settle = () => new Promise(resolve => setTimeout(resolve, 5));
const SERDIKA = '18506/12078';

test('a prepared tile decodes into 12-byte vertices, ordered detail levels and joined centrelines', () => {
  const store = fresh();
  const tile = store.decode(read(SERDIKA), 18506, 12078);
  assert.equal(tile.vertices.byteLength, tile.vertexCount * 12);
  assert.ok(tile.vertexCount > 1000 && tile.vertexCount < 65536);
  for (let i = 1; i < 5; i++) assert.ok(tile.prefix[i] >= tile.prefix[i - 1], 'levels only add triangles');
  assert.equal(tile.prefix[4], tile.indices.length);
  assert.equal(tile.indices.length % 3, 0);
  assert.ok(tile.prefix.every(n => n % 3 === 0));
  const words = new Uint16Array(tile.vertices), heights = new Int16Array(tile.vertices), bytes = new Uint8Array(tile.vertices);
  const materials = new Set();
  let low = Infinity, high = -Infinity;
  for (let v = 0; v < tile.vertexCount; v++) {
    materials.add(bytes[v * 12 + 6]);
    low = Math.min(low, heights[v * 6 + 2]); high = Math.max(high, heights[v * 6 + 2]);
    assert.ok(words[v * 6] <= 65535 && words[v * 6 + 1] <= 65535);
  }
  assert.ok(low >= 0 && high <= 60, 'everything lies within 60 cm of the ground: ' + low + '..' + high);
  for (const material of [0, 2, 3, 7, 9, 10]) assert.ok(materials.has(material), 'material ' + material);
  assert.ok([...materials].every(m => m <= 10));
  // The surface level holds only carriageway and paving.
  for (let i = 0; i < tile.prefix[0]; i++) assert.ok(bytes[tile.indices[i] * 12 + 6] <= 1);
  // Tram centrelines lie inside or next to the tile.
  const trams = tile.lines.filter(line => line.kind === 0);
  assert.ok(trams.length > 0);
  for (const line of trams) for (const [lng, lat] of line.points) {
    assert.ok(lng > 23.30 && lng < 23.34 && lat > 42.68 && lat < 42.71, lng + ',' + lat);
  }
});

test('centreline points shared by neighbouring tiles are identical, so tram rails join across tiles', () => {
  const store = fresh();
  const points = key => {
    const [x, y] = key.split('/').map(Number), seen = new Set();
    for (const line of store.decode(read(key), x, y).lines) for (const p of line.points) seen.add(p.join(','));
    return seen;
  };
  const here = points(SERDIKA);
  const shared = ['18505/12078', '18507/12078', '18506/12077', '18506/12079'].reduce((n, key) => {
    let hits = 0;
    try { for (const p of points(key)) if (here.has(p)) hits++; } catch (e) { if (e.code !== 'ENOENT') throw e; }
    return n + hits;
  }, 0);
  assert.ok(shared >= 2, 'shared points: ' + shared);
});

test('every published tile decodes and stays inside the triangle budget of a frame', () => {
  const store = fresh();
  let tiles = 0, most = 0;
  for (const x of readdirSync(ROOT)) for (const file of readdirSync(path.join(ROOT, x))) {
    const tile = store.decode(read(x + '/' + file.replace('.bin.gz', '')), +x, parseInt(file));
    most = Math.max(most, tile.indices.length / 3);
    tiles++;
  }
  assert.ok(tiles > 900, 'tiles ' + tiles);
  assert.ok(most <= 20000, 'largest tile ' + most + ' triangles');
});

test('a damaged tile is rejected', () => {
  const store = fresh();
  const good = read(SERDIKA);
  assert.throws(() => store.decode(good.slice(0, 2000), 18506, 12078));
  const bad = good.slice(0); new Uint8Array(bad)[0] = 0;
  assert.throws(() => store.decode(bad, 18506, 12078));
});

test('the store requests the tiles under the view nearest first, uploads one at a time and reports coverage', async () => {
  const table = {}, asked = [];
  for (let x = 100; x <= 110; x++) for (let y = 100; y <= 110; y++) if (!(x === 104 && y === 105)) table[x + '/' + y] = 'x';
  table['109/109'] = '';   // left out of this build
  const store = fresh(table);
  const tile = read(SERDIKA);
  store.setLoader((packed, entry) => { asked.push(entry.key); return Promise.resolve(tile.slice(0)); });
  const box = [104.2, 104.2, 105.8, 105.8];
  store.plan(box, [105.5, 105.5], [0, 0], 1000);
  await settle();
  assert.equal(asked[0], '105/105', 'nearest first');
  assert.ok(!asked.includes('104/105'), 'a tile without roads is never requested');
  assert.equal(store.covered(box), false, 'nothing is on the GPU yet');
  let uploads = 0;
  for (let entry; (entry = store.takeUpload()); uploads++) store.uploaded(entry, { id: uploads }, 1000);
  await settle();
  for (let entry; (entry = store.takeUpload()); uploads++) store.uploaded(entry, { id: uploads }, 1000);
  assert.equal(uploads, asked.length);
  assert.equal(store.covered(box), true, 'ready tiles plus the empty one cover the view');
  assert.equal(store.covered([108.2, 108.2, 109.8, 109.8]), false, 'a tile left out of the build is not covered');
  assert.equal(store.covered([110.5, 105, 111.5, 105.5]), false, 'outside the prepared area');
  // The same view again asks for nothing.
  const before = asked.length;
  store.plan(box, [105.5, 105.5], [0, 0], 1200);
  await settle();
  assert.equal(asked.length, before);
  assert.ok(store.centrelines().lines.length > 0);
  assert.equal(store.centrelines(), store.centrelines(), 'the centreline list is rebuilt only when tiles change');
});

test('the memory budget frees the tiles drawn longest ago and never one that is wanted', async () => {
  const table = {};
  for (let x = 100; x <= 110; x++) table[x + '/100'] = 'x';
  const store = fresh(table);
  const tile = read(SERDIKA), freed = [];
  const size = store.decode(tile.slice(0), 18506, 12078).bytes;
  store.setLoader(() => Promise.resolve(tile.slice(0)));
  store.bind(handle => freed.push(handle.key), null);
  store.budget(size * 3.5);
  for (let x = 100; x <= 108; x++) {
    const now = 1000 * (x - 99);
    store.plan([x + 0.3, 100.3, x + 0.6, 100.6], [x + 0.5, 100.5], [0, 0], now);
    await settle();
    for (let entry; (entry = store.takeUpload());) store.uploaded(entry, { key: entry.key }, now);
    assert.ok(store.usedBytes() <= size * 3.5, 'within the budget at ' + x);
    assert.ok(store.ready.some(entry => entry.key === x + '/100'), 'the tile in view stays');
  }
  assert.deepEqual(freed.slice(0, 3), ['100/100', '101/100', '102/100']);
  assert.equal(store.ready.length, 3);
  store.reset();
  assert.equal(store.usedBytes(), 0);
  assert.equal(store.ready.length, 0);
});

test('a failed download leaves the tile uncovered and is retried later', async () => {
  const store = fresh({ '100/100': 'x' });
  let calls = 0;
  store.setLoader(() => { calls++; return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(read(SERDIKA)); });
  const box = [100.2, 100.2, 100.8, 100.8];
  store.plan(box, [100.5, 100.5], [0, 0], 0);
  await settle();
  assert.equal(store.stats.failures, 1);
  assert.equal(store.covered(box), false);
  store.plan(box, [100.5, 100.5], [0, 0], 5000);
  await settle();
  assert.equal(calls, 1, 'not retried straight away');
  store.plan(box, [100.5, 100.5], [0, 0], 31000);
  await settle();
  assert.equal(calls, 2);
  assert.ok(store.takeUpload());
});

test('the governor sheds detail on slow frames, then draw distance, and recovers', () => {
  const { governor } = fresh();
  let now = 0;
  const run = (ms, seconds) => { for (const end = now + seconds * 1000; now < end; now += ms) governor.frame(now); };
  run(16, 3);
  assert.equal(governor.step(), 0);
  assert.equal(governor.detail(), 1);
  run(30, 3.2);
  assert.ok(governor.step() >= 2 && governor.detail() < 1 && governor.draw() === 1, 'detail first: step ' + governor.step());
  run(30, 4);
  assert.equal(governor.step(), 5);
  assert.ok(governor.draw() < 1);
  run(10, 7);
  assert.equal(governor.step(), 0);
  // A long gap between frames (the map was idle) is not a slow frame.
  governor.frame(now += 5000);
  run(16, 2);
  assert.equal(governor.step(), 0);
});

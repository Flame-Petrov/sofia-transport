const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { app } = require('./app.cjs');

const context = app(['features/view3d/tree-tiles', 'features/view3d/trees'], { Intl, location: { search: '' } });
const trees = vm.runInContext('trees', context);
const table = vm.runInContext('sofiaTreeTiles', context);
const unpack = key => { const b = zlib.gunzipSync(Buffer.from(table[key], 'base64')); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };

test('every tree tile decodes into 16 cells inside the tile with plausible heights', () => {
  let total = 0;
  for (const key of Object.keys(table)) {
    const [tx, ty] = key.split('/').map(Number), cells = trees.decode(unpack(key), tx, ty);
    assert.equal(cells.length, 16);
    for (const cell of cells) {
      for (let i = 0; i < cell.x.length; i++) {
        assert.ok(cell.x[i] >= cell.x0 && cell.x[i] <= cell.x0 + cell.size + 1e-12, key);
        assert.ok(cell.y[i] >= cell.y0 && cell.y[i] <= cell.y0 + cell.size + 1e-12, key);
        assert.ok(cell.kind[i] < trees.kinds.length);
        assert.ok(cell.height[i] >= 3 && cell.height[i] <= 27);
      }
      total += cell.x.length;
    }
  }
  assert.ok(total > 100000, 'trees ' + total);
});

test('every shape is finite, stands on the ground and reaches about one metre', () => {
  for (const season of [new Date('2026-07-01T12:00:00Z'), new Date('2026-01-15T12:00:00Z')]) {
    for (const kind of trees.kinds) {
      const m = trees.mesh(kind, season);
      assert.ok(m.length > 0 && m.length % 21 === 0, kind);
      let low = 1, top = 0, wide = 0;
      for (let i = 0; i < m.length; i += 7) {
        for (let j = 0; j < 7; j++) assert.ok(Number.isFinite(m[i + j]), kind);
        assert.ok(Math.abs(Math.hypot(m[i + 3], m[i + 4], m[i + 5]) - 1) < 0.05 || m[i + 6] === 0, kind + ' normal');
        low = Math.min(low, m[i + 2]); top = Math.max(top, m[i + 2]); wide = Math.max(wide, Math.hypot(m[i], m[i + 1]));
      }
      assert.ok(low >= -0.01 && low < 0.15, kind + ' low ' + low);
      assert.ok(top > 0.85 && top <= 1.01, kind + ' top ' + top);
      assert.ok(wide < 0.5, kind + ' wide ' + wide);
      assert.ok(m.length / 21 <= 160, kind + ' triangles ' + m.length / 21);
    }
  }
});

test('deciduous crowns follow the Sofia season and evergreens keep theirs', () => {
  const at = iso => new Date(iso);
  assert.equal(trees.season(at('2026-07-01T10:00:00Z')), 'summer');
  assert.equal(trees.season(at('2026-11-13T10:00:00Z')), 'autumn');
  assert.equal(trees.season(at('2026-01-20T10:00:00Z')), 'winter');
  assert.equal(trees.season(at('2026-04-10T10:00:00Z')), 'spring');
  assert.equal(trees.season(at('2026-11-30T22:30:00Z')), 'winter');   // already 1 December in Sofia
  const winter = at('2026-01-20T10:00:00Z');
  assert.notEqual(trees.mesh('broad', winter), trees.mesh('broad', at('2026-07-01T10:00:00Z')));
  assert.equal(trees.mesh('conifer', winter), trees.mesh('conifer', at('2026-07-01T10:00:00Z')));
  assert.deepEqual(JSON.parse(JSON.stringify(trees.palette('pine', winter))), JSON.parse(JSON.stringify(trees.palette('pine', at('2026-07-01T10:00:00Z')))));
});

test('cells are picked nearest first up to the budget and rows group by kind', async () => {
  const key = Object.keys(table).sort((a, b) => table[b].length - table[a].length)[0];
  const [tx, ty] = key.split('/').map(Number);
  const cells = trees.decode(unpack(key), tx, ty).map((cell, i) => ({ key: key + '#' + i, cell, d: i }));
  const origin = { x: (tx + 0.5) / 16384, y: (ty + 0.5) / 16384, unit: 1 / (40075016.7 * Math.cos(42.7 * Math.PI / 180)) };
  const made = trees.rows(cells, origin, null);
  const n = cells.reduce((s, c) => s + c.cell.x.length, 0);
  assert.equal(made.data.length, n * 6);
  assert.equal(made.groups.reduce((s, g) => s + g.count, 0), n);
  for (let i = 0; i < made.data.length; i += 6) {
    assert.ok(Math.abs(made.data[i]) < 1500 && Math.abs(made.data[i + 1]) < 1500, 'metres from the tile centre');
    assert.ok(made.data[i + 3] >= 2.7);
  }
});

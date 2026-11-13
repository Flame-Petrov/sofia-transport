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

test('every shape, near and far, is finite, stands on the ground and reaches about one metre', () => {
  for (const season of [new Date('2026-07-01T12:00:00Z'), new Date('2026-01-15T12:00:00Z')]) {
    for (const kind of trees.kinds) for (const far of [false, true]) {
      const m = trees.mesh(kind, season, far), name = kind + (far ? ' far' : '');
      assert.ok(m.length > 0 && m.length % 21 === 0, name);
      let low = 1, top = 0, wide = 0;
      for (let i = 0; i < m.length; i += 7) {
        for (let j = 0; j < 7; j++) assert.ok(Number.isFinite(m[i + j]), name);
        assert.ok(Math.abs(Math.hypot(m[i + 3], m[i + 4], m[i + 5]) - 1) < 0.05 || m[i + 6] === 0, name + ' normal');
        low = Math.min(low, m[i + 2]); top = Math.max(top, m[i + 2]); wide = Math.max(wide, Math.hypot(m[i], m[i + 1]));
      }
      assert.ok(low >= -0.01 && low < 0.15, name + ' low ' + low);
      assert.ok(top > 0.85 && top <= 1.01, name + ' top ' + top);
      assert.ok(wide < 0.5, name + ' wide ' + wide);
      assert.ok(m.length / 21 <= (far ? 32 : 160), name + ' triangles ' + m.length / 21);
    }
  }
  // The budget prices a far tree at farCost of a full one: the commonest shape must not cost more than that.
  const summer = new Date('2026-07-01T12:00:00Z');
  assert.ok(trees.mesh('broad', summer, true).length <= trees.mesh('broad', summer).length * (trees.farCost + 0.03));
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

// The fullest tile (the wood of Borisova Gradina, about 28,000 trees) as picked cells, and a camera over it.
function wood() {
  const key = Object.keys(table).sort((a, b) => table[b].length - table[a].length)[0];
  const [tx, ty] = key.split('/').map(Number);
  const cells = trees.decode(unpack(key), tx, ty).map((cell, i) => ({ key: key + '#' + i, cell })).filter(c => c.cell.x.length);
  const unit = 1 / (40075016.7 * Math.cos(42.7 * Math.PI / 180));
  const origin = { x: (tx + 0.5) / 16384, y: (ty + 0.5) / 16384, unit };
  const eye = (height, near) => ({ x: origin.x, y: origin.y + 300 * unit, height, near, unit });
  return { cells, origin, eye, n: cells.reduce((s, c) => s + c.cell.x.length, 0) };
}

test('without a camera every tree gets a row and rows group by kind', () => {
  const { cells, origin, n } = wood();
  const made = trees.rows(cells, origin, null);
  assert.equal(made.data.length, n * 6);
  assert.equal(made.groups.reduce((s, g) => s + g.count, 0), n);
  assert.ok(made.groups.every(g => !g.far || !g.count));
  for (let i = 0; i < made.data.length; i += 6) {
    assert.ok(Math.abs(made.data[i]) < 1500 && Math.abs(made.data[i + 1]) < 1500, 'metres from the tile centre');
    assert.ok(made.data[i + 3] >= 2.7);
  }
});

test('a wood larger than the budget is drawn whole: far trees are simple, then thinned, and no cell is left empty', () => {
  const { cells, origin, eye, n } = wood();
  assert.ok(n > 20000, 'trees ' + n);
  const cost = made => made.view.full + (made.view.drawn - made.view.full) * trees.farCost;
  // A high camera: every tree is small on screen, so all are simple and all fit the desktop budget.
  const high = trees.rows(cells, origin, null, eye(900, 320), 12000);
  assert.equal(high.view.drawn, n);
  assert.equal(high.view.full, 0);
  assert.equal(high.view.range, null);
  assert.equal(high.groups.filter(g => g.far).reduce((s, g) => s + g.count, 0), n);
  // A low camera with a small budget: full shapes nearby, the rest thinned to the budget, every cell still has trees.
  const low = trees.rows(cells, origin, null, eye(120, 320), 3000);
  assert.ok(low.view.full > 0 && low.view.full < low.view.drawn);
  assert.ok(low.view.drawn < n && low.view.range > 0);
  assert.ok(Math.abs(cost(low) - 3000) < 300, 'cost ' + cost(low));
  assert.equal(low.view.covered, cells.length);
  assert.equal(low.data.length, low.view.drawn * 6);
  assert.equal(low.groups.reduce((s, g) => s + g.count, 0), low.view.drawn);
  // Trees within the range are never dropped, and a larger budget only adds trees.
  const at = made => { const set = new Set(); for (let i = 0; i < made.data.length; i += 6) set.add(made.data[i] + ',' + made.data[i + 1]); return set; };
  const few = at(low), more = at(trees.rows(cells, origin, null, eye(120, 320), 6000));
  assert.ok(more.size > few.size);
  for (const p of few) assert.ok(more.has(p));
  const e = eye(120, 320);
  let near = 0;
  for (const c of cells) for (let i = 0; i < c.cell.x.length; i++)
    if (Math.hypot((c.cell.x[i] - e.x) / e.unit, (c.cell.y[i] - e.y) / e.unit, e.height) < low.view.range - 1) {
      near++;
      assert.ok(few.has(Math.fround((c.cell.x[i] - origin.x) / origin.unit) + ',' + Math.fround((c.cell.y[i] - origin.y) / origin.unit)));
    }
  assert.ok(near > 50, 'near ' + near);
});

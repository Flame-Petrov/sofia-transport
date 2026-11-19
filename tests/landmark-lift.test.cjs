const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { app } = require('./app.cjs');

const context = app(['features/view3d/landmark-data', 'features/view3d/landmarks', 'features/view3d/monument-models',
  'features/view3d/landmark-info', 'features/view3d/landmark-lift'], { window: {} });
const landmarks = vm.runInContext('landmarks', context);
const info = vm.runInContext('landmarkInfo', context);
const lift = vm.runInContext('landmarkLift', context);
const TURN = 2 * Math.PI;

test('every landmark that stands when zoomed out has a name, kind and text in English and Bulgarian', () => {
  const far = landmarks.sites.filter(s => !s.z);
  assert.ok(far.length >= 50, 'sites ' + far.length);
  for (const s of far) {
    const row = info[s.key] || info[s.n];
    assert.ok(row, 'no card text for ' + (s.key || s.n));
    for (const field of ['name', 'kind', 'text']) {
      assert.equal(row[field].length, 2, s.n + ' ' + field);
      row[field].forEach(v => assert.ok(typeof v === 'string' && v.trim().length > 1, s.n + ' ' + field));
    }
    assert.ok(/[А-Яа-я]/.test(row.name[1] + row.text[1]), s.n + ' Bulgarian text is Cyrillic');
    assert.ok(row.text[0].length <= 220 && row.text[1].length <= 240, s.n + ' text is short');
  }
  const names = new Set(landmarks.sites.map(s => s.key || s.n));
  for (const key of Object.keys(info)) assert.ok(names.has(key), 'row without a site: ' + key);
});

test('a model knows its box once built, for picking it on screen', () => {
  const nevsky = landmarks.sites.find(s => s.k === 'nevsky');
  landmarks.mesh(nevsky);
  const [u0, u1, v0, v1, top] = nevsky.box;
  assert.ok(u0 < -30 && u1 > 30 && v0 < -20 && v1 > 20, 'box ' + nevsky.box);
  assert.ok(top > 40 && top < 70, 'top ' + top);   // the bell tower is 53 m
});

// Fly a landing to the end in frames of `dt`, as the frame loop does.
function land(angle, spin, level, vel, dt = 1 / 60) {
  const states = lift._states;
  states.clear();
  const st = { level, vel, angle, spin, riseM: 50, grow: 1.5, land: null };
  states.set(0, st);
  lift._setDown(0);
  const path = [];
  let t = 0;
  while (t < 5) {
    const now = lift._landing(st, dt);
    st.land.t = now.t; st.angle = now.angle; st.spin = now.spin; st.level = now.level; st.vel = now.levelVel;
    path.push(now);
    t += dt;
    if (now.done) break;
  }
  states.clear();
  return { st, path, T: st.land.T };
}

test('a landing ends at rest, on the ground, facing the way the model is mapped', () => {
  for (const spin of [0, 0.3, 1.2, TURN / 3.2, 3]) {
    for (const angle of [0, 0.01, 1, 3, 5.5, 6.27, 20.2]) {
      const { st, path, T } = land(angle, spin, 1, 0);
      const end = path[path.length - 1];
      assert.ok(end.done, 'landing finished');
      assert.ok(T >= 0.8 - 1e-9 && T <= 2.2 + 1e-9, 'takes ' + T + ' s');
      assert.ok(Math.abs(end.level) < 1e-9 && Math.abs(end.spin) < 1e-6, 'at rest on the ground');
      const off = ((st.angle % TURN) + TURN) % TURN;
      assert.ok(Math.min(off, TURN - off) < 1e-6, 'faces its mapped bearing: ' + off + ' from ' + angle + ' at ' + spin);
      for (const p of path) assert.ok(p.level >= 0 && p.level <= 1 + 1e-9, 'never below the ground');
    }
  }
});

test('a spinning model slows to a stop without turning back, and its speed does not jump', () => {
  for (const angle of [0, 0.2, 2, 4, 6.2]) {
    const spin = TURN / 3.2;
    const { path } = land(angle, spin, 1, 0);
    assert.ok(Math.abs(path[0].spin - spin) < 0.2, 'first frame keeps the speed: ' + path[0].spin);
    assert.ok(Math.max(...path.map(p => p.spin)) < spin * 2.2, 'no wild whirl before landing');
    for (const p of path) assert.ok(p.spin >= -1e-9, 'turning back at ' + angle);
    for (let i = 1; i < path.length; i++) assert.ok(Math.abs(path[i].spin - path[i - 1].spin) < 0.6, 'smooth speed');
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { app } = require('./app.cjs');

const context = app(['features/view3d/landmark-data', 'features/view3d/landmarks', 'features/view3d/monument-models']);
const landmarks = vm.runInContext('landmarks', context);
const monuments = landmarks.sites.filter(s => s.k === 'monument');
const FORMS = ['statue', 'seated', 'bust', 'head', 'equestrian', 'group', 'obelisk', 'stele', 'column', 'cross', 'stone', 'wall', 'arch',
  'pylon', 'abstract', 'animal', 'bird', 'flame', 'aircraft', 'bells', 'mound', 'fountain'];

function measure(mesh) {
  let top = 0, low = Infinity, reach = 0;
  for (let i = 0; i < mesh.length; i += 10) {
    for (let j = 0; j < 10; j++) assert.ok(Number.isFinite(mesh[i + j]));
    top = Math.max(top, mesh[i + 2]); low = Math.min(low, mesh[i + 2]);
    reach = Math.max(reach, Math.hypot(mesh[i], mesh[i + 1]));
  }
  return { top, low, reach, triangles: mesh.length / 30 };
}

test('Sofia has hundreds of 3D monuments, each with a known form', () => {
  assert.ok(monuments.length >= 600, 'monuments ' + monuments.length);
  for (const s of monuments) assert.ok(FORMS.includes(s.s.form), s.n + ' form ' + s.s.form);
});

test('every monument builds a small finite mesh that stands on the ground near its point', () => {
  for (const s of monuments) {
    const m = measure(landmarks.mesh(s));
    assert.ok(m.triangles >= 20 && m.triangles <= 6000, s.n + ' triangles ' + m.triangles);
    assert.ok(m.low >= -0.01 && m.low < 0.5, s.n + ' low ' + m.low);
    assert.ok(m.reach <= s.reach + 15, s.n + ' reach ' + m.reach + ' > ' + s.reach);
    if (s.h) assert.ok(m.top <= s.h * 1.35 + 1.5, s.n + ' top ' + m.top + ' for ' + s.h);
  }
});

test('small monuments wait for close zoom, landmarks do not', () => {
  const small = monuments.find(s => s.z);
  const bounds = { getWest: () => small.at[0] - 0.01, getEast: () => small.at[0] + 0.01, getSouth: () => small.at[1] - 0.01, getNorth: () => small.at[1] + 0.01 };
  const index = landmarks.sites.indexOf(small);
  assert.ok(!landmarks.visible(bounds, 14).has(index));
  assert.ok(landmarks.visible(bounds, 15.2).has(index));
  const nevsky = landmarks.sites.findIndex(s => s.k === 'nevsky'), near = landmarks.sites[nevsky].at;
  const around = { getWest: () => near[0] - 0.01, getEast: () => near[0] + 0.01, getSouth: () => near[1] - 0.01, getNorth: () => near[1] + 0.01 };
  assert.ok(landmarks.visible(around, 12.5).has(nevsky));
});

test('the Landmarks switch hides the monuments too', () => {
  const s = monuments[0], i = landmarks.sites.indexOf(s);
  const b = { getWest: () => s.at[0] - 0.01, getEast: () => s.at[0] + 0.01, getSouth: () => s.at[1] - 0.01, getNorth: () => s.at[1] + 0.01 };
  landmarks.setShown(false, true);
  assert.ok(!landmarks.visible(b, 17).has(i));
  landmarks.setShown(true, true);
  assert.ok(landmarks.visible(b, 17).has(i));
});

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { app } = require('./app.cjs');

const context = app(['features/view3d/landmark-data', 'features/view3d/landmarks', 'features/view3d/monument-models'], { clearInterval() {} });
const landmarks = vm.runInContext('landmarks', context);
const site = kind => landmarks.sites.find(s => s.k === kind);
function measure(mesh) {
  let top = 0, low = 0, reach = 0, lit = 0;
  for (let i = 0; i < mesh.length; i += 10) {
    for (let j = 0; j < 10; j++) assert.ok(Number.isFinite(mesh[i + j]));
    assert.ok(Math.abs(Math.hypot(mesh[i + 6], mesh[i + 7], mesh[i + 8]) - 1) < 1e-3, 'unit normal');
    top = Math.max(top, mesh[i + 2]); low = Math.min(low, mesh[i + 2]);
    reach = Math.max(reach, Math.hypot(mesh[i], mesh[i + 1]));
    if (mesh[i + 9] > 0) lit++;
  }
  return { top, low, reach, lit, triangles: mesh.length / 30 };
}

test('every landmark and mall builds a finite mesh that stays on its site', () => {
  assert.ok(landmarks.sites.length >= 30);
  for (const s of landmarks.sites.filter(site => site.k !== 'monument')) {   // monuments: tests/monuments.test.cjs
    const m = measure(landmarks.mesh(s));
    assert.ok(m.triangles >= 40, s.n + ' triangles ' + m.triangles);
    assert.equal(m.low, 0, s.n);
    assert.ok(m.reach <= s.reach + 12, s.n + ' reach ' + m.reach);
  }
});

test('landmarks stand at their real heights', () => {
  const top = kind => measure(landmarks.mesh(site(kind))).top;
  assert.ok(top('nevsky') > 50 && top('nevsky') < 54);       // bell tower 53 m
  assert.ok(Math.abs(top('tvtower') - 106) < 1);
  assert.ok(top('levski') === 13);
  assert.ok(top('nedelya') > 29 && top('nedelya') < 33);     // dome 31 m
  assert.ok(top('sofia') > 21 && top('sofia') < 25);         // 24 m with the column
});

test('malls follow their mapped outline and height and have windows that light up', () => {
  const malls = landmarks.sites.filter(s => s.k === 'mall');
  assert.ok(malls.length >= 15);
  for (const s of malls) {
    const m = measure(landmarks.mesh(s));
    assert.ok(m.top >= s.h && m.top <= s.h + 9, s.n + ' top ' + m.top);
    assert.ok(m.lit > 0, s.n);
    assert.ok(s.ids.length > 0, s.n);
  }
});

test('the replaced buildings are filtered out in the layer filter\'s own syntax', () => {
  const id = site('ndk').ids[0];
  const plain = value => JSON.parse(JSON.stringify(value));   // arrays from the app's own realm
  const legacy = plain(landmarks.filter(['!has', 'hide_3d']));
  assert.deepEqual(legacy.slice(0, 2), ['all', ['!has', 'hide_3d']]);
  assert.deepEqual(legacy[2].slice(0, 2), ['!in', '$id']);
  assert.ok(legacy[2].includes(id));
  const expression = plain(landmarks.filter(['==', ['get', 'kind'], 'x']));
  assert.equal(expression[2][0], '!');
  assert.ok(expression[2][1][2][1].includes(id));
  assert.deepEqual(plain(landmarks.filter(undefined)).slice(0, 2), ['!in', '$id']);
  // The live style's own filter is an expression without get or literal.
  const live = plain(landmarks.filter(['!', ['has', 'hide_3d']]));
  assert.deepEqual(live.slice(0, 2), ['all', ['!', ['has', 'hide_3d']]]);
  assert.deepEqual(live[2].slice(0, 1), ['!']);
  assert.deepEqual(live[2][1].slice(0, 2), ['in', ['id']]);
  for (const legacyFilter of [['has', 'x'], ['==', 'kind', 'a'], ['in', 'kind', 'a', 'b'], ['all', ['!has', 'x'], ['==', '$type', 'Polygon']]]) {
    assert.deepEqual(plain(landmarks.filter(legacyFilter))[2].slice(0, 2), ['!in', '$id'], JSON.stringify(legacyFilter));
  }
  for (const expressionFilter of [['==', ['get', 'a'], 1], ['all', ['!', ['has', 'x']], ['has', 'y']], ['in', ['get', 'a'], ['literal', [1]]]]) {
    assert.equal(plain(landmarks.filter(expressionFilter))[2][0], '!', JSON.stringify(expressionFilter));
  }
});

test('only sites near the view are drawn', () => {
  const bounds = (w, s, e, n) => ({ getWest: () => w, getSouth: () => s, getEast: () => e, getNorth: () => n });
  const centre = landmarks.visible(bounds(23.330, 42.694, 23.336, 42.698));
  const index = kind => landmarks.sites.indexOf(site(kind));
  assert.ok(centre.has(index('nevsky')) && centre.has(index('levski')));
  assert.ok(!centre.has(index('ndk')) && !centre.has(index('tvtower')));
  assert.equal(landmarks.visible(bounds(23.0, 42.9, 23.01, 42.91)).size, 0);
});

test('switching landmarks or malls off stops drawing them and gives their buildings back', () => {
  const plain = value => JSON.parse(JSON.stringify(value));
  const ids = f => (f ? plain(f)[2] : []);
  const ndk = site('ndk').ids[0], mall = site('mall').ids[0];
  const all = { getWest: () => 23.2, getEast: () => 23.5, getSouth: () => 42.6, getNorth: () => 42.8 };
  const kinds = () => [...landmarks.visible(all)].map(i => landmarks.sites[i].k);
  try {
    landmarks.setShown(true, false);   // buildings off: landmarks and monuments only
    assert.ok(landmarks.awake());
    assert.ok(kinds().includes('tsar') && kinds().includes('ndk') && !kinds().includes('mall'));
    assert.ok(ids(landmarks.filter(['!has', 'hide_3d'])).includes(ndk) && !ids(landmarks.filter(['!has', 'hide_3d'])).includes(mall));
    landmarks.setShown(false, true);   // landmarks off: malls stay, the cathedral is an ordinary building again
    assert.ok(kinds().every(k => k === 'mall') && kinds().length >= 15);
    assert.ok(!ids(landmarks.filter(['!has', 'hide_3d'])).includes(ndk) && ids(landmarks.filter(['!has', 'hide_3d'])).includes(mall));
    landmarks.setShown(false, false);
    assert.ok(!landmarks.awake());
    assert.equal(landmarks.visible(all).size, 0);
    assert.deepEqual(plain(landmarks.filter(['!has', 'hide_3d'])), ['!has', 'hide_3d']);
  } finally { landmarks.setShown(true, true); }
});

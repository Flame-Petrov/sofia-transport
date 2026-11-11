const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('./app.cjs');

const { daylight } = app(['shared/map/daylight'], { clearInterval() {} });
const at = iso => daylight.at(Date.parse(iso));
function extreme(day, pick) {
  let best = null;
  for (let m = 0; m < 1440; m += 5) {
    const s = at(day + 'T00:00:00Z'.replace('T00:00', 'T' + String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')));
    best = best === null ? s.sunAlt : pick(best, s.sunAlt);
  }
  return best;
}
function crossing(day, rising) {
  for (let m = 1; m < 1440; m++) {
    const a = at(`${day}T${String(Math.floor((m - 1) / 60)).padStart(2, '0')}:${String((m - 1) % 60).padStart(2, '0')}:00Z`).sunAlt;
    const b = at(`${day}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00Z`).sunAlt;
    if (rising ? a < 0 && b >= 0 : a >= 0 && b < 0) return m / 60;
  }
}

test('the sun peaks at 90° minus latitude plus or minus the tilt at the solstices', () => {
  assert.ok(Math.abs(extreme('2026-06-21', Math.max) - 70.74) < 0.5);
  assert.ok(Math.abs(extreme('2026-12-21', Math.max) - 23.86) < 0.5);
});

test('sunrise and sunset in Sofia on 10 November fall in the published windows', () => {
  const rise = crossing('2026-11-10', true), set = crossing('2026-11-10', false);   // UTC hours; Sofia is UTC+2
  assert.ok(rise > 4.8 && rise < 5.3, 'sunrise ' + rise);
  assert.ok(set > 14.7 && set < 15.2, 'sunset ' + set);
});

test('the sun is south at midday and east then west of it', () => {
  const noon = at('2026-11-10T10:00:00Z'), morning = at('2026-11-10T07:30:00Z'), evening = at('2026-11-10T13:00:00Z');
  assert.ok(Math.abs(noon.sunAz - 180) < 8);
  assert.ok(morning.sunAz > 90 && morning.sunAz < 180);
  assert.ok(evening.sunAz > 180 && evening.sunAz < 270);
});

test('the moon is new and full near the almanac dates', () => {
  assert.ok(at('2026-11-09T21:00:00Z').moonFraction < 0.06);
  assert.ok(at('2026-11-24T15:00:00Z').moonFraction > 0.94);
  const quarter = at('2026-11-17T12:00:00Z').moonFraction;
  assert.ok(quarter > 0.35 && quarter < 0.65);
});

test('lamps come on after dark and stay off at noon', () => {
  const night = at('2026-11-10T22:00:00Z'), noon = at('2026-11-10T10:00:00Z');
  assert.equal(noon.lighting.lamp, 0);
  assert.ok(night.lighting.lamp > 0.99 && night.lighting.lit > 0.05);
  assert.ok(night.night > 0.99 && noon.night === 0);
  assert.ok(night.lighting.ambient[0] < 0.3 && noon.lighting.ambient[0] > 0.7);
});

test('the map light follows the sun by day and the moon at night', () => {
  const noon = at('2026-11-10T10:00:00Z'), full = at('2026-11-24T21:00:00Z');   // ~23:00 Sofia, moon high in the east or south
  assert.equal(noon.light.position[1], noon.sunAz);
  assert.ok(full.moonAlt > 10 && full.sunAlt < -10);
  assert.equal(full.light.position[1], full.moonAz);
});

test('switched off, every reader gets the fixed afternoon', () => {
  const off = daylight.state();
  assert.equal(daylight.enabled(), false);
  assert.equal(off.lighting.lamp, 0);
  assert.equal(off.night, 0);
  assert.deepEqual(Array.from(off.light.position), [1.5, 225, 35]);
});

test('previewing a Sofia time pins the clock to it', () => {
  daylight.setEnabled(true);
  daylight.preview(23 * 60 + 30);
  assert.equal(daylight.clock(), '23:30');
  assert.ok(daylight.state().night > 0.9);
  daylight.preview(12 * 60);
  assert.equal(daylight.clock(), '12:00');
  assert.ok(daylight.state().night === 0);
  daylight.preview(null);
  daylight.setEnabled(false);
});

test('dusk dims the scene around sunset and is absent at noon and deep night', () => {
  const noon = at('2026-11-10T10:00:00Z'), sunset = at('2026-11-10T15:00:00Z'), night = at('2026-11-10T22:00:00Z');
  assert.equal(noon.dusk, 0);
  assert.equal(night.dusk, 0);
  assert.ok(sunset.dusk > 0.9, 'dusk ' + sunset.dusk);
  assert.ok(sunset.lighting.ambient[0] < 0.55 && sunset.lighting.ambient[0] > night.lighting.ambient[0]);
  let last = 1;
  for (let m = 12 * 60; m <= 18 * 60; m += 5) {   // brightness only falls through the afternoon and evening
    const s = at(`2026-11-10T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00Z`);
    assert.ok(s.lighting.ambient[1] <= last + 1e-9, 'ambient rose at ' + m);
    last = s.lighting.ambient[1];
  }
});

test('a low sun stretches shadows to at most three heights', () => {
  const { daylight: clock, shadows } = app(['shared/map/daylight', 'features/view3d/shadows'], { clearInterval() {} });
  clock.setEnabled(true);
  clock.preview(12 * 60);
  const s = clock.state(), noon = Math.hypot(...shadows.reach()), real = 1 / Math.tan(s.sunAlt * Math.PI / 180);
  assert.ok(noon <= real + 1e-9 && noon > 1.2, 'noon reach ' + noon);
  let longest = 0;
  for (let m = 6 * 60; m <= 18 * 60; m += 10) { clock.preview(m); longest = Math.max(longest, Math.hypot(...shadows.reach())); }
  assert.ok(longest > 2.5 && longest <= 3 + 1e-9, 'longest reach ' + longest);
  clock.preview(null);
  clock.setEnabled(false);
});

test('ground shadows exist only with the cycle on, in direct light and on flat ground', () => {
  const { daylight: clock, shadows } = app(['shared/map/daylight', 'features/view3d/shadows'], { clearInterval() {} });
  assert.equal(shadows.strength(null), 0);
  clock.setEnabled(true);
  clock.preview(12 * 60);
  assert.ok(shadows.strength(null) > 0.2);
  assert.equal(shadows.strength({ getTerrain: () => ({}) }), 0);
  shadows.setEnabled(false);   // the Shadows switch alone
  assert.equal(shadows.strength(null), 0);
  assert.ok(clock.state().lighting.color[1] > 0.2);
  shadows.setEnabled(true);
  assert.ok(shadows.enabled() && shadows.strength(null) > 0.2);
  clock.preview(0);
  assert.ok(shadows.strength(null) < 0.12);
  clock.preview(17 * 60 + 40);   // after sunset, before the moon matters
  assert.ok(shadows.strength(null) < 0.12);
  clock.preview(null);
  clock.setEnabled(false);
});

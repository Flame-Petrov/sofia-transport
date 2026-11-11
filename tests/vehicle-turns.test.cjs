// Simulates 3D vehicle models through turns with the heading code taken from the app's own sources.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = file => readFileSync(path.join(__dirname, '..', 'src', file), 'utf8');
// One top-level function (or `var NAME = ...;` line) out of a source file, by its indentation.
function take(source, name) {
  const fn = new RegExp('^( *)function ' + name + '\\([\\s\\S]*?^\\1\\}', 'm').exec(source);
  if (fn) return fn[0];
  const line = new RegExp('^ *var ' + name + ' = .*$', 'm').exec(source);
  assert.ok(line, 'missing ' + name);
  return line[0];
}
const view = src('features/view3d/view.js'), lines = src('features/vehicles/route-line.js'), arrows = src('features/vehicles/direction-arrows.js');
const context = vm.createContext({});
vm.runInContext([take(lines, 'toRad'), take(lines, 'bearingDeg'), take(arrows, 'pointAt'),
  take(view, 'MODEL_TURN_MS'), take(view, 'shapeHeading'), take(view, 'easedHeadings')].join('\n'), context);
const { shapeHeading, easedHeadings, bearingDeg } = context;

// A trip shape: 100 m north, a right-angle corner, 100 m east, as [lat, lon] points.
function shape(points) {
  const m = { pts: points, cum: [0], bear: [] };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const metres = Math.hypot((b[0] - a[0]) * 110574, (b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));
    m.cum.push(m.cum[i - 1] + metres); m.bear.push(bearingDeg(a, b));
  }
  m.bear.push(m.bear[m.bear.length - 1]);
  m.total = m.cum[m.cum.length - 1];
  return m;
}
const north = 100 / 110574, east = 100 / (111320 * Math.cos(42.7 * Math.PI / 180));
const corner = shape([[42.7, 23.3], [42.7 + north, 23.3], [42.7 + north, 23.3 + east]]);
const turnBy = (a, b) => ((b - a) % 360 + 540) % 360 - 180;

// Drive along the shape at 8 m/s and 60 frames a second; return the heading drawn on each frame.
function drive(route, ease) {
  const v = {}, drawn = [];
  for (let frame = 0, t = 0; ; frame++, t += 1000 / 60) {
    const s = 60 + 8 * t / 1000;
    if (s > 140) break;
    const target = ease === 'old' ? context.pointAt(route, s).deg : shapeHeading(route, s);
    drawn.push(ease === 'new' ? easedHeadings(v, [target], t)[0] : target);
  }
  return drawn;
}
const steps = drawn => drawn.slice(1).map((h, i) => Math.abs(turnBy(drawn[i], h)));

test('a bus swings through a right-angle corner instead of snapping', () => {
  const before = drive(corner, 'old'), after = drive(corner, 'new');
  assert.ok(Math.max(...steps(before)) > 89, 'the old heading jumped the whole corner in one frame');
  const worst = Math.max(...steps(after));
  assert.ok(worst < 3, 'largest turn in one frame ' + worst.toFixed(2) + '°');
  assert.ok(Math.abs(turnBy(after[0], 0)) < 0.5 && Math.abs(turnBy(after[after.length - 1], 90)) < 1, 'starts north, ends east');
  const turning = after.filter(h => h > 2 && h < 88).length / 60;   // seconds spent mid-turn
  assert.ok(turning > 0.8 && turning < 2.5, 'turn lasted ' + turning.toFixed(2) + ' s');
  for (let i = 1; i < after.length; i++) assert.ok(turnBy(after[i - 1], after[i]) > -1e-6, 'never turns back');
});

test('a new GPS heading eases in, across north too', () => {
  const v = {};
  easedHeadings(v, [350], 0);
  const drawn = [];
  for (let t = 16; t <= 1400; t += 16) drawn.push(easedHeadings(v, [30], t)[0]);
  assert.ok(Math.abs(turnBy(350, drawn[0])) < 3, 'first frame moves a little');
  assert.ok(Math.abs(turnBy(drawn[30], 30)) < 8, 'most of the way after half a second');
  assert.ok(Math.abs(turnBy(drawn[drawn.length - 1], 30)) < 0.3, 'settles on the target');
  assert.ok(drawn.every(h => h >= 350 || h <= 30.001), 'takes the short way through north');
});

test('an articulated model eases all three sections', () => {
  const v = {};
  easedHeadings(v, [80, 90, 100], 0);
  const next = easedHeadings(v, [100, 110, 120], 100);
  next.forEach((h, i) => assert.ok(h > [80, 90, 100][i] + 3 && h < [100, 110, 120][i] - 3));
  assert.equal(v.turn.moving, true);
});

test('reversals and long gaps snap', () => {
  const v = {};
  easedHeadings(v, [10], 0);
  assert.equal(easedHeadings(v, [190], 16)[0], 190);    // terminus turn-round: no pirouette
  assert.equal(easedHeadings(v, [250], 5000)[0], 250);  // back on screen after a gap
});

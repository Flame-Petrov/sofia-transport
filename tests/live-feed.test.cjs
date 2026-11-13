const test = require('node:test');
const assert = require('node:assert/strict');
const { app, noop } = require('./app.cjs');

// Live checks: positions every second, trip updates every 15 s, glides as long as a vehicle's
// own report interval (see docs/live-feed-polling.md).
const CHECKS = { REFRESH_MS: 1000, REFRESH_SAVE_DATA_MS: 5000, REFRESH_MAX_MS: 15000, TU_REFRESH_MS: 15000 };

function feedApp(extra = {}) {
  const clock = { now: 1_000_000 };
  const a = app(['shared/transit/live-feed'], {
    ...CHECKS, FEED_URL: 'positions', TU_URL: 'updates', FEED_TIMEOUT_MS: 8000, TU_TIMEOUT_MS: 8000,
    lastNewDataAt: 0, feedInterval: 10000, STALE_FEED_MS: 30000, decode: msg => msg,
    showReload: noop, setProgress: noop, setStatus: noop, renderDiag: noop, renderFeedStatus: noop,
    console: { warn: noop },
    Date: { now: () => clock.now }, ...extra
  });
  return { a, clock };
}

test('positions are checked every second while the ~1 MB trip updates follow every 15 s', async () => {
  const { a, clock } = feedApp();
  const asked = [];
  let header = 0;
  a.fetchFeed = url => {
    asked.push(url);
    return Promise.resolve(url === 'positions' ? { header: { timestamp: ++header } } : { entity: [] });
  };
  a.applyPositions = noop;
  a.refreshFeedViews = noop;
  for (let s = 0; s < 31; s++) {
    await a.update(s === 0);
    await new Promise(resolve => setImmediate(resolve));
    clock.now += 1000;
  }
  assert.equal(asked.filter(u => u === 'positions').length, 31);
  // at 0 s (forced start), 15 s and 30 s: not with every position check as before
  assert.equal(asked.filter(u => u === 'updates').length, 3);
});

test('a slow trip-update download is never doubled by later position checks', async () => {
  const { a, clock } = feedApp();
  const pending = [];
  let header = 0, updates = 0;
  a.fetchFeed = url => {
    if (url === 'positions') return Promise.resolve({ header: { timestamp: ++header } });
    updates++;
    return new Promise(resolve => pending.push(resolve));
  };
  a.applyPositions = noop;
  a.refreshFeedViews = noop;
  await a.update(true);
  clock.now += 20000;
  await a.update(false);
  await a.update(true);
  assert.equal(updates, 1);
  pending[0]({ entity: [] });
  await new Promise(resolve => setImmediate(resolve));
  await a.update(false);
  assert.equal(updates, 2);
});

test('glides last as long as a vehicle reports, not as long as one check takes', () => {
  // 50 vehicles, each reporting every 5 s at its own second, checked once a second
  const vehicles = {};
  const { a } = feedApp({
    vehicles, describe: ent => ent.d, PARK_MAX_MS: 0, nearEndOfRun: () => false, setParked: noop,
    upsert: d => { if (vehicles[d.key]) vehicles[d.key].d = d; else vehicles[d.key] = { d }; }
  });
  const fleet = n => Array.from({ length: 50 }, (_, i) => {
    const ts = 1000 + Math.floor((n - (i % 5)) / 5) * 5 + (i % 5);
    return { vehicle: { position: {} }, d: { key: 'V' + i, lat: 42.7, lon: 23.3, ts, via: 'position' } };
  });
  for (let n = 5; n < 65; n++) a.applyPositions({ entity: fleet(n) }, n * 1000);
  assert.ok(Math.abs(a.feedInterval - 5000) < 50, 'learned ' + a.feedInterval + ' ms');

  // the same vehicles checked only every 15 s (a failing feed backing off): glide for 15 s
  for (let n = 65; n < 400; n += 15) a.applyPositions({ entity: fleet(n) }, n * 1000);
  assert.ok(Math.abs(a.feedInterval - 15000) < 100, 'learned ' + a.feedInterval + ' ms');

  // sightings after the page slept say nothing about the feed
  const before = a.feedInterval;
  a.staleFeed = true;
  a.applyPositions({ entity: fleet(450) }, 450000);
  assert.equal(a.feedInterval, before);
});

test('checks slow down with Data Saver and while the feed fails, and stop while hidden', async () => {
  const timers = [];
  const connection = { saveData: false };
  const { a, clock } = feedApp({ navigator: { connection },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout: noop });
  assert.equal(a.pollDelay(), 1000);
  connection.saveData = true;
  assert.equal(a.pollDelay(), 5000);
  connection.saveData = false;

  let fail = true;
  a.fetchFeed = url => fail ? Promise.reject(new Error('offline')) : Promise.resolve({ header: { timestamp: clock.now } });
  a.applyPositions = noop;
  a.refreshFeedViews = noop;
  const waits = [];
  for (let i = 0; i < 5; i++) { await a.update(false); waits.push(a.pollDelay()); }
  assert.deepEqual(waits, [2000, 4000, 8000, 15000, 15000]);
  fail = false;
  await a.update(false);
  assert.equal(a.pollDelay(), 1000);

  // one chain of checks; a hidden page leaves it, showing the page restarts it at once
  a.startPolling();
  assert.deepEqual(timers.map(t => t.ms), [1000]);
  a.document.hidden = true;
  timers.shift().fn();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.length, 0);
  a.document.hidden = false;
  a.document.dispatchEvent(new Event('visibilitychange'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(timers.length, 1);
  assert.ok(timers[0].ms <= 1000 && timers[0].ms >= 250);
});

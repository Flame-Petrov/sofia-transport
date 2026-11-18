"""Metro trains stand at stations: sample every timetable metro train on the real schedule.

Phone layout (412 x 915, Android user agent). For --seconds it records, four times a second, where
each metro train is along its line (the same routeS() the map draws with) and then reports:
  - how long trains stood at each station they were seen arriving at and leaving (passages),
  - whether every motion plan still starts and ends on the timetable time of its two stations,
  - top speed and the largest change of speed between samples,
and saves screenshots of one train arriving at a station (with a clock, speed and state overlay)
plus a speed-over-time chart of that train.

Needs network access to gtfs.sofiatraffic.bg and metro service at the time of the run.
Run from site/ with the Playwright venv, e.g.
  ../old/osm-work/venv/Scripts/python tests/metro-dwell-browser.py --release 108
Exits non-zero when --expect-dwell is given and the passages or timetable checks fail.
"""
import argparse
import json
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('--release', default='108', help='numbered release to load')
parser.add_argument('--seconds', type=float, default=150, help='sampling window')
parser.add_argument('--out', default=None, help='folder for screenshots and report json')
parser.add_argument('--prefix', default='', help='screenshot name prefix, e.g. 01')
parser.add_argument('--expect-dwell', action='store_true', help='fail unless trains stand 14-21 s at stations')
args = parser.parse_args()

site = Path(__file__).resolve().parents[1]
workspace = site.parent
out = Path(args.out) if args.out else workspace / 'debug images' / (time.strftime('%Y-%m-%d') + '-metro-dwell')
out.mkdir(parents=True, exist_ok=True)

ANDROID_UA = ('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36')
START = '  // ---------- Start ----------'
HOOKS = r"""
  (function () {
    var q = window.qaMetro = { on: false, samples: {}, plans: {}, watch: null };
    function trains() { return Object.keys(vehicles).filter(function (k) { return vehicles[k].d.metroPlan; }); }
    function sAt(plan, now) { return routeS(plan, Math.max(0, Math.min(1, (now - plan.t0) / plan.dur))); }
    window.qaMetroCount = function () { return trains().length; };
    // the timetable times of a run, to check each plan starts and ends on them
    function onTimetable(run, plan) {
      for (var j = 0; j + 1 < run.length; j++) {
        if (tt.base + tt.times[run.t + j] * 1000 === plan.t0)
          return tt.base + tt.times[run.t + j + 1] * 1000 === plan.t0 + plan.dur;
      }
      return false;
    }
    setInterval(function () {
      if (!q.on) return;
      var now = Date.now();
      trains().forEach(function (k) {
        var v = vehicles[k], plan = v.d.metroPlan, id = plan.t0 + '|' + plan.s0;
        (q.samples[k] = q.samples[k] || []).push([now, Math.round(sAt(plan, now) * 100) / 100, plan.t0]);
        if (!q.plans[k + '|' + id]) {
          q.plans[k + '|' + id] = { key: k, t0: plan.t0, dur: plan.dur, s0: plan.s0, s1: plan.s1,
            start: sAt(plan, plan.t0), end: sAt(plan, plan.t0 + plan.dur), timetable: onTimetable(v.d.metroRun, plan) };
        }
      });
    }, 250);
    // The next station arrival among trains on screen-worthy plans: when a train will stop moving.
    window.qaMetroPick = function (minAhead, maxAhead) {
      var now = Date.now(), best = null;
      trains().forEach(function (k) {
        var plan = vehicles[k].d.metroPlan, arrive = plan.t0 + plan.dur - (plan.hold1 || 0);
        var ahead = (arrive - now) / 1000;
        if (ahead < minAhead || ahead > maxAhead || plan.s1 - plan.s0 < 300) return;
        if (!best || ahead < best.ahead) {
          var p = pointAt(plan.m, plan.s1).ll;
          best = { key: k, ahead: ahead, arrive: arrive, leave: plan.t0 + plan.dur + (plan.hold1 || 0),
                   lat: p[0], lon: p[1], line: vehicles[k].d.line, headsign: vehicles[k].d.headsign };
        }
      });
      return best;
    };
    window.qaMetroWatch = function (pick) {
      q.watch = pick.key;
      map.setView([pick.lat, pick.lon], 17, { animate: false });
      L.circle([pick.lat, pick.lon], { radius: 6, color: '#e5484d', weight: 3, fill: false }).addTo(map);
      var box = document.createElement('div');
      box.id = 'qaMetroBox';
      box.style.cssText = 'position:fixed;left:8px;top:110px;z-index:99999;background:rgba(0,0,0,.78);color:#fff;' +
        'font:600 15px/1.35 system-ui,sans-serif;padding:8px 10px;border-radius:8px;white-space:pre';
      document.body.appendChild(box);
      var prev = null;
      setInterval(function () {
        var v = vehicles[q.watch];
        if (!v) { box.textContent = 'train gone'; return; }
        var plan = v.d.metroPlan, now = Date.now(), s = sAt(plan, now), speed = 0;
        if (prev && prev.plan === plan) speed = (s - prev.s) / ((now - prev.t) / 1000);
        prev = { plan: plan, s: s, t: now };
        var toStation = plan.s1 - s, fromStation = s - plan.s0;
        box.textContent = 'M' + String(v.d.line).replace(/^M/, '') + ' ' + new Date(now).toLocaleTimeString('en-GB', { timeZone: 'Europe/Sofia' }) +
          '\n' + (speed < 0.05 ? 'STANDING at station' : 'moving') + '  ' + (speed * 3.6).toFixed(0) + ' km/h' +
          '\n' + Math.min(fromStation, toStation).toFixed(0) + ' m from a station';
      }, 500);
    };
  })();
"""


class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(workspace), **k)
    def log_message(self, *a): pass


server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
html = (workspace / (args.release + '_public-transport.html')).read_text(encoding='utf-8')
assert html.count(START) == 1, 'start marker'
html = html.replace(START, HOOKS + START)


def shot(page, name):
    path = out / ('%s-%s.png' % (args.prefix or args.release, name))
    page.screenshot(path=str(path))
    print('shot', path.name, flush=True)
    return path.name


def passages(samples):
    """Contiguous standing spells (no movement for >= 1 s) that start and end inside the window."""
    spells = []
    i = 1
    while i < len(samples):
        if abs(samples[i][1] - samples[i - 1][1]) < 0.01:
            j = i
            while j + 1 < len(samples) and abs(samples[j + 1][1] - samples[j][1]) < 0.01:
                j += 1
            start, end = samples[i - 1][0], samples[j][0]
            whole = i - 1 > 0 and j + 1 < len(samples)   # seen moving before and after
            if end - start >= 1000:
                spells.append({'s': samples[i][1], 'seconds': round((end - start) / 1000, 2), 'whole': whole})
            i = j + 1
        else:
            i += 1
    return spells


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    ctx = browser.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2,
                              is_mobile=True, has_touch=True, user_agent=ANDROID_UA,
                              timezone_id='Europe/Sofia')
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route(base + '/', lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.goto(base + '/', wait_until='domcontentloaded', timeout=120000)
    page.wait_for_function('window.qaMetroCount && qaMetroCount() >= 3', timeout=420000, polling=1000)
    page.wait_for_timeout(3000)
    page.evaluate('qaMetro.on = true')
    t_start = time.time()
    print('metro trains:', page.evaluate('qaMetroCount()'), flush=True)

    # one train arriving at a station: shots before, at, during and after the stop
    pick = None
    for _ in range(60):
        pick = page.evaluate('qaMetroPick(14, 60)')
        if pick:
            break
        page.wait_for_timeout(1000)
    assert pick, 'no train arriving at a station soon'
    print('watching', json.dumps(pick, ensure_ascii=False), flush=True)
    page.evaluate('p => qaMetroWatch(p)', pick)
    now_ms = lambda: page.evaluate('Date.now()')
    plan_shots = [('approaching', pick['arrive'] - 9000), ('arrived', pick['arrive'] + 1500),
                  ('standing', (pick['arrive'] + pick['leave']) / 2), ('departing', pick['leave'] + 5000)]
    names = []
    for name, at in plan_shots:
        wait = at - now_ms()
        if wait > 0:
            page.wait_for_timeout(wait)
        names.append(shot(page, name))

    rest = args.seconds - (time.time() - t_start)
    if rest > 0:
        page.wait_for_timeout(rest * 1000)
    page.evaluate('qaMetro.on = false')
    data = page.evaluate('({ samples: qaMetro.samples, plans: Object.values(qaMetro.plans) })')

    # speed chart of the watched train
    trace = data['samples'].get(pick['key'], [])
    pts = []
    for a, b in zip(trace, trace[1:]):
        dt = (b[0] - a[0]) / 1000
        if dt > 0:
            pts.append(((b[0] - trace[0][0]) / 1000, max(0.0, (b[1] - a[1]) / dt * 3.6) if b[2] == a[2] else None))
    w, h, pad = 800, 360, 50
    tmax = max([p[0] for p in pts] + [1])
    vmax = max([p[1] for p in pts if p[1] is not None] + [10])
    vmax = (int(vmax / 10) + 1) * 10
    path = ' '.join('%s%.1f,%.1f' % ('M' if i == 0 else 'L', pad + p[0] / tmax * (w - 2 * pad), h - pad - p[1] / vmax * (h - 2 * pad))
                    for i, p in enumerate(q for q in pts if q[1] is not None))
    grid = ''.join('<line x1="%d" x2="%d" y1="%.1f" y2="%.1f" stroke="#ddd"/><text x="%d" y="%.1f" font-size="12" text-anchor="end">%d</text>'
                   % (pad, w - pad, h - pad - v / vmax * (h - 2 * pad), h - pad - v / vmax * (h - 2 * pad), pad - 6, h - pad - v / vmax * (h - 2 * pad) + 4, v)
                   for v in range(0, vmax + 1, 10))
    ticks = ''.join('<text x="%.1f" y="%d" font-size="12" text-anchor="middle">%d s</text>' % (pad + t / tmax * (w - 2 * pad), h - pad + 18, t)
                    for t in range(0, int(tmax) + 1, 30))
    svg = ('<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" font-family="system-ui,sans-serif">'
           '<rect width="100%%" height="100%%" fill="#fff"/>%s%s<path d="%s" fill="none" stroke="#1c75bc" stroke-width="2.5"/>'
           '<text x="%d" y="24" font-size="15" font-weight="600">Release %s, train %s (%s): speed in km/h over %d s</text></svg>'
           % (w, h, grid, ticks, path, pad, args.release, pick['line'], pick['headsign'], tmax))
    chart = ctx.new_page()
    chart.set_viewport_size({'width': w, 'height': h})
    chart.set_content('<body style="margin:0">' + svg + '</body>')
    chart_path = out / ('%s-speed-chart.png' % (args.prefix or args.release))
    chart.screenshot(path=str(chart_path))
    browser.close()

spells = []
for key, samples in data['samples'].items():
    for sp in passages(samples):
        sp['key'] = key
        spells.append(sp)
whole = [s['seconds'] for s in spells if s['whole']]
plans = data['plans']
report = {
    'release': args.release, 'seconds': args.seconds, 'trains': len(data['samples']), 'page_errors': errors,
    'watched': pick, 'screenshots': names + [chart_path.name],
    'stops_seen_whole': len(whole), 'stop_seconds': sorted(whole),
    'plans': len(plans), 'plans_on_timetable': sum(1 for p in plans if p['timetable']),
    'plans_start_at_station': sum(1 for p in plans if abs(p['start'] - p['s0']) < 0.01),
    'plans_end_at_station': sum(1 for p in plans if abs(p['end'] - p['s1']) < 0.01),
}
speeds = []
for samples in data['samples'].values():
    for a, b in zip(samples, samples[1:]):
        if a[2] == b[2] and b[0] > a[0]:
            speeds.append((b[1] - a[1]) / ((b[0] - a[0]) / 1000))
report['top_speed_kmh'] = round(max(speeds) * 3.6, 1) if speeds else None
(out / ('%s-report.json' % (args.prefix or args.release))).write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding='utf-8')
print(json.dumps({k: v for k, v in report.items() if k != 'watched'}, ensure_ascii=False), flush=True)

ok = not errors and report['plans_on_timetable'] == report['plans'] and \
    report['plans_start_at_station'] == report['plans'] and report['plans_end_at_station'] == report['plans']
if args.expect_dwell:
    ok = ok and len(whole) >= 3 and all(14 <= s <= 21 for s in whole)
print('PASS' if ok else 'FAIL', flush=True)
raise SystemExit(0 if ok else 1)

"""Compare live position checks between two numbered releases on the real Sofia feed.

Phone layout (412 x 915, Android user agent), CPU throttled 4x after load, runs alternated
A B A B. For each run it records, over the measuring window:
  - how old a vehicle's report is when the app first has it (and the mean age of all shown reports),
  - requests and bytes for vehicle positions and trip updates,
  - main-thread busy time, frames drawn and long tasks,
  - the learned report interval (the length of each glide),
and saves a screenshot per run plus one of the Diagnostics panel of the second release.

Needs network access to gtfs.sofiatraffic.bg. Run from site/ with the Playwright venv, e.g.
  ../old/osm-work/venv/Scripts/python tests/live-feed-browser.py --a 104 --b 105
"""
import argparse
import json
import statistics
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('--a', default='104', help='baseline release number')
parser.add_argument('--b', default='105', help='release under test')
parser.add_argument('--seconds', type=float, default=45, help='measuring window per run')
parser.add_argument('--rounds', type=int, default=2, help='A B pairs')
parser.add_argument('--out', default=None, help='folder for screenshots and report.json')
parser.add_argument('--diag-only', action='store_true', help='only capture the Diagnostics panel of --b')
args = parser.parse_args()

site = Path(__file__).resolve().parents[1]
workspace = site.parent
out = Path(args.out) if args.out else workspace / 'debug images' / (time.strftime('%Y-%m-%d') + '-faster-vehicle-checks')
out.mkdir(parents=True, exist_ok=True)

ANDROID_UA = ('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36')
START = '  // ---------- Start ----------'
HOOKS = r"""
  (function () {
    var q = window.qaFeed = { on: false, ages: [], late: [], frames: 0, longTasks: 0, seen: {} };
    function frame() { if (q.on) q.frames++; requestAnimationFrame(frame); }
    requestAnimationFrame(frame);
    try { new PerformanceObserver(function (l) { if (q.on) q.longTasks += l.getEntries().length; }).observe({ type: 'longtask' }); } catch (e) {}
    setInterval(function () {
      if (!q.on) return;
      var now = Date.now() / 1000, sum = 0, n = 0;
      for (var k in vehicles) {
        var d = vehicles[k].d;
        if (d.metroPlan || !d.ts) continue;
        sum += now - d.ts; n++;
        if (q.seen[k] !== undefined && q.seen[k] !== d.ts) q.late.push(now - d.ts);
        q.seen[k] = d.ts;
      }
      if (n) q.ages.push(sum / n);
    }, 100);
    window.qaFeedState = function () {
      return { feedInterval: feedInterval, vehicles: Object.keys(vehicles).length,
               poll: typeof pollDelay === 'function' ? pollDelay() : REFRESH_MS,
               tripUpdates: typeof TU_REFRESH_MS !== 'undefined' ? TU_REFRESH_MS : REFRESH_MS,
               status: document.getElementById('statusTxt').textContent };
    };
    window.qaDiag = function () {
      var panel = document.getElementById('panel');
      if (panel.classList.contains('folded')) document.getElementById('fold').click();
      setDiagOpen(true);
      return { sections: document.getElementById('diagSections').textContent,
               checks: (diagRawText.match(/^(checks|motion): .*$/mg) || []).join('\n') };
    };
  })();
"""


class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(workspace), **k)
    def log_message(self, *a): pass


server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)


def html_for(release):
    html = (workspace / (release + '_public-transport.html')).read_text(encoding='utf-8')
    assert html.count(START) == 1, 'start marker'
    return html.replace(START, HOOKS + START)


def q(xs, p):
    xs = sorted(xs)
    return round(xs[min(len(xs) - 1, int(len(xs) * p))], 2) if xs else None


shot_no = [0]


def shot(page, name):
    shot_no[0] += 1
    path = out / ('%02d-%s.png' % (shot_no[0], name))
    page.screenshot(path=str(path))
    return path.name


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    # one context: the schedule download and timetable are cached in IndexedDB after the warm-up
    ctx = browser.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2,
                              is_mobile=True, has_touch=True, user_agent=ANDROID_UA)
    pages_html = {r: html_for(r) for r in (args.a, args.b)}

    def open_release(release, settle=10):
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.route(base + '/', lambda r: r.fulfill(body=pages_html[release], content_type='text/html; charset=utf-8'))
        page.goto(base + '/', wait_until='domcontentloaded', timeout=120000)
        page.wait_for_function('window.qaFeedState && qaFeedState().vehicles > 100 && /^Live/.test(qaFeedState().status)',
                               timeout=180000)
        page.wait_for_function('document.getElementById("loader") === null || getComputedStyle(document.getElementById("loader")).display === "none" || document.getElementById("loader").hidden',
                               timeout=180000)
        page.wait_for_timeout(settle * 1000)
        return page, errors

    runs = []
    order = [] if args.diag_only else [args.a, args.b] * args.rounds
    if order:
        print('warm-up (schedule download, timetable cache)…', flush=True)
        page, errors = open_release(args.b, settle=20)
        shot(page, 'warmup-%s' % args.b)
        page.close()
    for i, release in enumerate(order):
        page, errors = open_release(release)
        cdp = ctx.new_cdp_session(page)
        cdp.send('Performance.enable')
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
        net = {'positions': [0, 0], 'trip-updates': [0, 0]}
        measuring = [False]

        def finished(r):
            if not measuring[0]:
                return
            kind = 'positions' if 'vehicle-positions' in r.url else 'trip-updates' if 'trip-updates' in r.url else None
            if kind:
                try:
                    size = r.sizes()['responseBodySize']
                except Exception:
                    size = 0
                net[kind][0] += 1
                net[kind][1] += size

        page.on('requestfinished', finished)
        page.wait_for_timeout(3000)   # let the throttled page settle into its rhythm
        metric = lambda: {m['name']: m['value'] for m in cdp.send('Performance.getMetrics')['metrics']}
        m0, t0 = metric(), time.time()
        measuring[0] = True
        page.evaluate('qaFeed.on = true')
        page.wait_for_timeout(args.seconds * 1000)
        page.evaluate('qaFeed.on = false')
        measuring[0] = False
        m1, wall = metric(), time.time() - t0
        data = page.evaluate('({ ages: qaFeed.ages, late: qaFeed.late, frames: qaFeed.frames, longTasks: qaFeed.longTasks, state: qaFeedState() })')
        name = shot(page, 'run%d-%s' % (i + 1, release))
        run = {
            'release': release, 'seconds': round(wall, 1), 'screenshot': name, 'page_errors': errors,
            'report_age_when_received_s': {'median': q(data['late'], .5), 'p90': q(data['late'], .9), 'n': len(data['late'])},
            'mean_age_of_shown_reports_s': round(statistics.mean(data['ages']), 2) if data['ages'] else None,
            'position_requests': net['positions'][0], 'position_MB': round(net['positions'][1] / 1e6, 2),
            'trip_update_requests': net['trip-updates'][0], 'trip_update_MB': round(net['trip-updates'][1] / 1e6, 2),
            'MB_per_hour': round((net['positions'][1] + net['trip-updates'][1]) / 1e6 * 3600 / wall),
            'main_thread_busy_pct': round(100 * (m1['TaskDuration'] - m0['TaskDuration']) / wall, 1),
            'script_pct': round(100 * (m1['ScriptDuration'] - m0['ScriptDuration']) / wall, 1),
            'fps': round(data['frames'] / wall, 1), 'long_tasks': data['longTasks'],
            'glide_ms': round(data['state']['feedInterval']), 'poll_ms': data['state']['poll'],
            'trip_update_every_ms': data['state']['tripUpdates'], 'vehicles': data['state']['vehicles'],
        }
        runs.append(run)
        print(json.dumps(run), flush=True)
        page.close()

    # the Diagnostics panel of the release under test, desktop width so the side panel shows
    page, diag_errors = open_release(args.b, settle=8)
    page.set_viewport_size({'width': 1280, 'height': 900})
    page.wait_for_timeout(1000)
    page.evaluate('qaDiag()')
    page.wait_for_timeout(2500)   # the reveal animation, and at least one more position check
    diag = page.evaluate('qaDiag()')
    page.evaluate('''() => {
      const row = [...document.querySelectorAll('#diagSections .dg-kv')].find(r => r.firstChild.textContent === 'Checks');
      row.scrollIntoView({block: 'center'});
      row.style.outline = '3px solid #e5484d';   // mark the new row in the screenshot
    }''')
    page.wait_for_timeout(600)
    diag_shot = shot(page, 'diagnostics-%s' % args.b)
    page.close()
    browser.close()
    print('diagnostics:', diag['checks'].replace('\n', ' | '), flush=True)
    assert 'Checks' in diag['sections'] and 'positions every' in diag['checks'], diag
    assert not diag_errors, diag_errors

if runs:
    summary = {}
    for release in (args.a, args.b):
        rs = [r for r in runs if r['release'] == release]
        keys = ['report_age_when_received_s', 'mean_age_of_shown_reports_s', 'position_requests', 'trip_update_requests',
                'MB_per_hour', 'main_thread_busy_pct', 'script_pct', 'fps', 'long_tasks', 'glide_ms']
        summary[release] = {k: [r[k] if k != 'report_age_when_received_s' else r[k]['median'] for r in rs] for k in keys}
    report = {'base': base, 'order': order, 'runs': runs, 'summary': summary,
              'diagnostics': diag['checks'], 'diagnostics_screenshot': diag_shot}
    (out / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(summary, indent=2))
elif (out / 'report.json').is_file():   # --diag-only: add the panel to the earlier comparison
    report = json.loads((out / 'report.json').read_text(encoding='utf-8'))
    report.pop('diagnostics_text', None)
    report.update({'diagnostics': diag['checks'], 'diagnostics_screenshot': diag_shot})
    (out / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print('saved to', out)
assert all(not r['page_errors'] for r in runs), [r['page_errors'] for r in runs]

"""Stop icons stay visible and tappable when a 3D vehicle model stands over them (release 109, rebuilt).

A rider saw trams at Sveta Nedelya hide the stop icons in 3D, and a tap on the hidden icon opened nothing but the
tram. The all-stops layer now draws above the vehicle models, and a tap on a stop icon opens the stop even where a
model's body covers it (a vehicle's number label and dot still win, as they are drawn above the stops).

Live feed, real base map. The test moves the 3D camera between busy tram and bus stops until a modelled vehicle's
body covers a stop icon, saves a close crop, taps the icon and records which card opens. It then taps the same
model's body away from any stop and expects the vehicle's card.

Usage: python tests/stops-over-models-browser.py OUTPUT_DIR [--page FILE] [--phone] [--cases N]
Needs the Python 3.12 venv in old/osm-work (Playwright) and Chrome.
"""
import argparse, json, threading, time
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('shots', type=Path)
parser.add_argument('--page', type=Path, help='HTML to load (default: the newest numbered release)')
parser.add_argument('--phone', action='store_true', help='Android user agent, 412 x 915, touch')
parser.add_argument('--cases', type=int, default=3)
parser.add_argument('--minutes', type=float, default=8)
parser.add_argument('--no-buildings', action='store_true', help='Buildings: Off, so every model in view is visible')
args = parser.parse_args()
args.shots.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]
RELEASE = args.page or max(root.parent.glob('*_public-transport.html'), key=lambda p: int(p.name.split('_')[0]))
ANDROID_UA = ('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36')

class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(root.parent), **k)
    def log_message(self, *a): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)

html = RELEASE.read_text(encoding='utf-8')
hooks = '''window.qa3 = {
      m3: function () { return m3; },
      opened: function () { return popKind || (sheetStop ? 'stop' : sheetVeh ? 'veh' : ''); },
      reset: function () { closePop(); if (sheetStop || sheetVeh || sheetRoute) closeSheet(); if (selected) deselect(); },
      // stops whose icon a model's body covers (not its number label), with the screen points to tap
      covered: function () {
        var out = [], cv = m3.getCanvas().getBoundingClientRect();
        drawn.forEach(function (f) {
          if (!f.model) return;
          var c = m3.project(f.c), v = vehicles[f.k];
          stopsDrawn.forEach(function (s) {
            var q = m3.project(s.c);
            if (Math.abs(q.x - c.x) <= 18 * ui && Math.abs(q.y - 30 * ui - c.y) <= 12 * ui) return;   // under the label
            if (Math.abs(q.y - (c.y - 30 * ui)) <= 16 * ui && Math.abs(q.x - c.x) <= 26 * ui) return;
            if (vehAtPoint(q) !== v) return;
            var x = cv.left + q.x, y = cv.top + q.y, el = document.elementFromPoint(x, y);
            if (!el || el !== m3.getCanvas()) return;   // under a button or a panel
            // a point on the same body clear of every stop icon
            var body = null;
            for (var t = -1; t <= 1 && !body; t += 0.25) {
              var h = f.bearing * Math.PI / 180, len = 6 * vehicleModelMetresPerUnit * t;
              var p = m3.project([f.c[0] + len * Math.sin(h) / (111320 * Math.cos(f.c[1] * Math.PI / 180)), f.c[1] + len * Math.cos(h) / 111320]);
              var clear = stopsDrawn.every(function (o) { var r = m3.project(o.c); return Math.abs(r.x - p.x) > 22 * ui || Math.abs(r.y - p.y) > 22 * ui; });
              var offLabel = Math.abs(p.x - c.x) > 26 * ui || Math.abs(p.y - (c.y - 30 * ui)) > 20 * ui;
              var bel = document.elementFromPoint(cv.left + p.x, cv.top + p.y);
              if (clear && offLabel && bel === m3.getCanvas() && vehAtPoint(p) === v) body = [cv.left + p.x, cv.top + p.y];
            }
            out.push({ veh: f.k, line: v && v.d && v.d.line, stop: s.item.stop.id, name: s.item.stop.name, xy: [x, y], body: body });
          });
        });
        return out;
      },
      layers: function () { return m3.style._order.slice(); }
    };
    view3d.counts = function () {'''
anchor = '    view3d.counts = function () {'
assert html.count(anchor) == 1, 'view3d.counts not found'
html = html.replace(anchor, hooks, 1)
start = '  // ---------- Start ----------'
html = html.replace(start, 'window.qa = {map: map};\n' + start)

# busy stops on tram and bus lines (lat, lon, bearing)
SPOTS = [(42.6967, 23.3212, 150), (42.6852, 23.3190, 200), (42.6936, 23.3343, 30), (42.6992, 23.3214, 0),
         (42.6889, 23.3196, 90), (42.6983, 23.3108, 120), (42.6866, 23.3328, 60), (42.6962, 23.3271, 0)]
report = {'page': RELEASE.name, 'phone': args.phone, 'cases': [], 'errors': []}
n = [0]
def shot(page, name, clip=None):
    n[0] += 1
    p = args.shots / ('%02d-%s.png' % (n[0], name))
    page.screenshot(path=str(p), clip=clip)
    return p.name

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    if args.phone:
        ctx = browser.new_context(viewport={'width': 412, 'height': 915}, device_scale_factor=2, is_mobile=True, has_touch=True,
                                  user_agent=ANDROID_UA, locale='en-GB')
    else:
        ctx = browser.new_context(viewport={'width': 1280, 'height': 800}, locale='en-GB')
    ctx.route(base + '/', lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8'))
    if args.no_buildings: ctx.add_init_script('try { localStorage.setItem("sofia_3d_buildings", "0"); } catch (e) {}')
    page = ctx.new_page()
    page.on('pageerror', lambda e: report['errors'].append(str(e)))
    page.set_default_timeout(30000)
    page.goto(base + '/')
    page.wait_for_function('window.qa && document.querySelectorAll(".leaflet-marker-icon").length > 20', timeout=90000)
    page.wait_for_function('!document.getElementById("loader") || getComputedStyle(document.getElementById("loader")).display === "none"', timeout=60000)
    page.evaluate('qa.map.setView([42.6967, 23.3212], 17, {animate: false})')
    page.wait_for_timeout(1500)
    page.evaluate('document.querySelector(".leaflet-control-3d a").click()')
    page.wait_for_function('window.qa3 && qa3.m3() && qa3.m3().getLayer("v3-models") && qa3.m3().getLayer("v3-stops")', timeout=60000)
    page.evaluate('document.querySelector("#v3Help button") && document.querySelector("#v3Help button").click()')
    layers = page.evaluate('qa3.layers()')
    report['stops_above_models'] = layers.index('v3-stops') > layers.index('v3-models')
    report['stops_above_trees'] = 'v3-trees' not in layers or layers.index('v3-stops') > layers.index('v3-trees')
    tap = (lambda x, y: page.touchscreen.tap(x, y)) if args.phone else (lambda x, y: page.mouse.click(x, y))
    deadline, i, seen = time.time() + args.minutes * 60, 0, set()
    while time.time() < deadline and len(report['cases']) < args.cases:
        lat, lon, bearing = SPOTS[i % len(SPOTS)]; i += 1
        page.evaluate('qa3.reset()')
        page.evaluate('c => qa3.m3().jumpTo({center: [c[1], c[0]], zoom: 17.3, pitch: 60, bearing: c[2]})', [lat, lon, bearing])
        for _ in range(6):
            page.wait_for_timeout(2500)
            hits = [h for h in page.evaluate('qa3.covered()') if (h['veh'], h['stop']) not in seen]
            if hits: break
        if not hits: continue
        h = hits[0]; seen.add((h['veh'], h['stop']))
        x, y = h['xy']
        tag = 'case%d-line%s' % (len(report['cases']) + 1, h['line'])
        w = 180
        clip = {'x': max(0, x - w / 2), 'y': max(0, y - w / 2), 'width': w, 'height': w}
        case = dict(h, before=shot(page, tag + '-covered-crop', clip), full=shot(page, tag + '-covered'))
        tap(x, y)
        page.wait_for_timeout(3000)
        case['stop_tap_opened'] = page.evaluate('qa3.opened()')
        case['after_stop_tap'] = shot(page, tag + '-after-stop-tap')
        if h['body']:
            page.evaluate('qa3.reset()')
            page.evaluate('c => qa3.m3().jumpTo({center: [c[1], c[0]], zoom: 17.3, pitch: 60, bearing: c[2]})', [lat, lon, bearing])
            page.wait_for_timeout(1200)
            again = [g for g in page.evaluate('qa3.covered()') if g['veh'] == h['veh'] and g['body']]
            if again:
                tap(*again[0]['body']); page.wait_for_timeout(3000)
                case['body_tap_opened'] = page.evaluate('qa3.opened()')
                case['after_body_tap'] = shot(page, tag + '-after-body-tap')
        case['ok'] = case['stop_tap_opened'] == 'stop' and case.get('body_tap_opened', 'veh') == 'veh'
        report['cases'].append(case)
        print(json.dumps(case, ensure_ascii=False), flush=True)
    browser.close()
server.shutdown()

report['pass'] = bool(report['cases']) and all(c['ok'] for c in report['cases']) and report['stops_above_models'] \
    and report['stops_above_trees'] and not report['errors']
(args.shots / 'report.json').write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding='utf-8')
print(json.dumps({k: v for k, v in report.items() if k != 'cases'}, ensure_ascii=False))
raise SystemExit(0 if report['pass'] else 1)

"""Landmarks lift off when zoomed out (release 110): hover on a PC, tap on a phone.

Desktop (1280 x 800): the mouse over the Alexander Nevsky Cathedral at MapLibre zoom 13.4 lifts and spins it and shows
its card; leaving lands it facing its mapped bearing; at zoom 14.6 (buildings stand) nothing lifts. Phone (Android UA,
390 x 844, touch): a tap lifts it with its card, a second tap lands it, a tap beside a lifted model lands it.

Usage: python tests/landmark-lift-browser.py OUTPUT_DIR [--standalone] [--lang en|bg]
Needs the Python 3.12 venv in old/osm-work (Playwright) and Chrome. Fixture basemap, bundled building tiles, no feed.
"""
import argparse, json, math, threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('shots', type=Path)
parser.add_argument('--standalone', action='store_true', help='Use the numbered release instead of index.html')
parser.add_argument('--lang', default='en')
args = parser.parse_args()
args.shots.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]
RELEASE = max(root.parent.glob('*_public-transport.html'), key=lambda p: int(p.name.split('_')[0]))
ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'

class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(root), **k)
    def log_message(self, *a): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
style = {'version': 8, 'glyphs': 'ofm://fixture.example/fonts/{fontstack}/{range}.pbf',
    'sources': {'street': {'type': 'vector', 'minzoom': 0, 'maxzoom': 14,
                           'tiles': ['ofm://fixture.example/14mock/{z}/{x}/{y}.pbf']}},
    'layers': [{'id': 'background', 'type': 'background', 'paint': {'background-color': '#e9e2d6'}},
        {'id': 'city', 'type': 'fill', 'source': 'street', 'source-layer': 'building', 'paint': {'fill-color': 'hsl(36,22%,80%)'}},
        {'id': 'blocks', 'type': 'fill-extrusion', 'source': 'street', 'source-layer': 'building', 'filter': ['!', ['has', 'hide_3d']],
         'paint': {'fill-extrusion-height': ['get', 'render_height']}}]}
html = (RELEASE if args.standalone else root / 'index.html').read_text(encoding='utf-8')
html = html.replace('m3 = new maplibregl.Map', 'm3 = window.qaMap = new maplibregl.Map')
start = '  // ---------- Start ----------'
assert start in html
html = html.replace(start, 'window.qaMode=()=>mapMode; window.qaFlat=map; window.qaLift=landmarkLift; window.qaLm=landmarks;\n' + start)

report, errors = {}, []
def check(name, ok, detail=''):
    report[name] = {'ok': bool(ok), 'detail': detail}
    print(('PASS ' if ok else 'FAIL ') + name, detail, flush=True)

def open_page(browser, phone):
    ctx = browser.new_context(viewport={'width': 390, 'height': 844} if phone else {'width': 1280, 'height': 800},
        device_scale_factor=3 if phone else 1, has_touch=phone, is_mobile=phone, user_agent=ANDROID if phone else None)
    ctx.add_init_script('localStorage.setItem("sofia_lang", %s); localStorage.setItem("sofia_3d_help_seen", "1");' % json.dumps(args.lang))
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'api/v1' not in m.text and '503' not in m.text and 'Failed to load resource' not in m.text else None)
    page.route(lambda u: urlsplit(u).path == '/' and urlsplit(u).port == server.server_port, lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.set_default_timeout(20000)
    page.route('https://tiles.openfreemap.org/styles/liberty', lambda r: r.fulfill(json=style))
    def tile(r):
        u = urlsplit(r.request.url).path.split('/')
        f = root / 'tiles/buildings/14' / '/'.join(u[-2:])
        r.fulfill(body=f.read_bytes() if len(u) > 3 and u[-3] == '14' and f.is_file() else b'', content_type='application/octet-stream')
    page.route('https://fixture.example/**', tile)
    page.route('**/api/v1/**', lambda r: r.fulfill(status=503, body='fixture'))
    page.goto(base + '/?daytime=15:00', wait_until='domcontentloaded', timeout=65000)
    page.wait_for_function('window.qaMode && qaMode() === "vector map"', timeout=30000)
    page.wait_for_function('!document.getElementById("loader") || getComputedStyle(document.getElementById("loader")).display === "none" || document.getElementById("loader").hidden', timeout=30000)
    page.evaluate('qaFlat.setView([42.6925,23.329],14,{animate:false})')
    page.evaluate('document.querySelector(".leaflet-control-3d a").click()')
    page.wait_for_function('window.qaMap && qaMap.loaded && qaMap.isStyleLoaded()', timeout=30000)
    page.evaluate('() => { const d = document.querySelector("#v3Help"); if (d && d.open) d.close(); }')
    # the fixture has no live feed: keep its "Live data is out of date" dialog off the map
    page.add_style_tag(content='#reloadDlg { display: none !important; }')
    return ctx, page

def camera(page, zoom, pitch=50, bearing=-20):
    page.evaluate('c => qaMap.jumpTo({center:[23.3300, 42.6915], zoom:c[0], pitch:c[1], bearing:c[2]})', [zoom, pitch, bearing])
    page.wait_for_timeout(2500)

# A screen point that picks the site: up from its foot until pick() says so.
def point_on(page, name):
    return page.evaluate('''n => { const i = qaLm.sites.findIndex(s => s.n === n), s = qaLm.sites[i];
        const p = qaMap.project(s.at);
        for (let dy = 0; dy <= 60; dy += 4) { const q = {x: p.x, y: p.y - dy}; if (qaLift.pick(q) === i) return {i, x: q.x, y: q.y}; }
        return {i, x: null, y: null}; }''', name)

def state(page):
    return page.evaluate('''() => { const s = qaLift.state(), c = document.querySelector(".lm-card"), p = qaLift.poses();
        const r = c && !c.hidden ? c.getBoundingClientRect() : null;
        return Object.assign(s, { cardOn: !!(c && c.classList.contains("on")), cardText: c ? c.innerText : "",
            cardBox: r && [r.left, r.top, r.width, r.height], poses: p ? Array.from(p.entries()) : [] }); }''')

def empty_point(page):
    return page.evaluate('''() => { const c = qaMap.getCanvas();
        for (let y = c.clientHeight - 80; y > 120; y -= 37) for (let x = 60; x < c.clientWidth - 60; x += 41)
            if (qaLift.pick({x, y}) < 0 && document.elementFromPoint(x, y) === c) return {x, y};
        return null; }''')

def record(page, i):   # every frame from now on: [animation time, rise, angle] of site i
    page.evaluate('''i => { const out = []; let t = 0, last = performance.now(); window.qaRec = out; window.qaRecOn = true;
        const f = now => { if (!window.qaRecOn || window.qaRec !== out) return; t += Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
            const ps = qaLift.poses(), p = ps && ps.get(i); out.push([t, p ? p.rise : null, p ? p.angle : null]); requestAnimationFrame(f); };
        requestAnimationFrame(f); }''', i)

def recorded(page):
    return page.evaluate('() => { window.qaRecOn = false; return window.qaRec || []; }')

def shot(page, name, around=None):
    page.screenshot(path=str(args.shots / name))
    if around:   # an enlarged crop around a point, to see a small model
        x, y = around
        page.screenshot(path=str(args.shots / ('zoom-' + name)), clip={'x': max(0, x - 260), 'y': max(0, y - 330), 'width': 520, 'height': 420})

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    # ---- desktop: hover ----
    ctx, page = open_page(browser, False)
    camera(page, 13.4)
    target = point_on(page, 'Alexander Nevsky Cathedral')
    shot(page, '01-desktop-baseline.png', (target['x'], target['y']) if target else None)
    check('desktop: the cathedral can be picked on screen', target['x'] is not None, target)
    s0 = state(page)
    check('desktop: the gate is open at zoom 13.4', s0['gate'], s0)
    page.mouse.move(target['x'] - 30, target['y'])
    record(page, target['i'])
    page.mouse.move(target['x'], target['y'], steps=4)
    page.wait_for_timeout(450)
    shot(page, '02-desktop-lifting.png', (target['x'], target['y']) if target else None)
    page.wait_for_timeout(1100)
    s1 = state(page)
    shot(page, '03-desktop-up-spinning.png', (target['x'], target['y']) if target else None)
    page.wait_for_timeout(700)
    up = recorded(page)
    pose1 = dict((k, v) for k, v in s1['poses']).get(target['i'])
    check('desktop: hover lifts the cathedral', s1['hover'] == target['i'] and pose1 and pose1['rise'] > 5, s1)
    check('desktop: the model grows while up', pose1 and 3 < pose1['scale'] <= 7, pose1)
    top = page.evaluate('() => { const l = qaMap.style._order; return l[l.length - 1]; }')   # getStyle() leaves out custom layers
    check('desktop: the lifted model is drawn by the top layer of the map', top.endswith('-landmarks-lifted'), top)
    # timings in the animation's own time (frames clamped to 50 ms as in the app), so a slow GPU does not skew them
    lifted = [f for f in up if f[1] is not None]
    t0 = lifted[0][0] if lifted else 0
    full = max((f[1] for f in lifted), default=0)
    t_up = next((f[0] - t0 for f in lifted if f[1] >= 0.8 * full), None)
    check('desktop: it is up within about half a second', full > 5 and t_up is not None and t_up <= 0.55, {'s_to_80%': t_up and round(t_up, 2), 'rise': full})
    cruise = [f for f in lifted if f[0] - t0 > 1.6]
    rate = (cruise[-1][2] - cruise[0][2]) / (cruise[-1][0] - cruise[0][0]) if len(cruise) > 2 and cruise[-1][0] > cruise[0][0] else None
    check('desktop: it spins slowly (a turn in about 6 s)', rate and 0.85 < rate < 1.25, {'rad_per_s': rate and round(rate, 3), 'frames': len(cruise)})
    check('desktop: its card is shown with text', s1['cardOn'] and 'Nevsky' in s1['cardText'] and len(s1['cardText']) > 60, s1['cardText'])
    check('desktop: the card is on screen', s1['cardBox'] and s1['cardBox'][0] >= 0 and s1['cardBox'][1] >= 0 and s1['cardBox'][0] + s1['cardBox'][2] <= 1280 and s1['cardBox'][1] + s1['cardBox'][3] <= 800, s1['cardBox'])
    away = empty_point(page)
    record(page, target['i'])
    page.mouse.move(away['x'], away['y'])
    page.wait_for_timeout(250)
    shot(page, '04-desktop-landing.png', (target['x'], target['y']) if target else None)
    page.wait_for_function('() => !qaLift.state().moving.length', timeout=20000)
    down = [f for f in recorded(page) if f[1] is not None]
    s3 = state(page)
    check('desktop: leaving lands it', not s3['moving'] and s3['hover'] == -1, s3)
    rises, angles = [f[1] for f in down], [f[2] for f in down]
    check('desktop: the landing comes down and keeps turning forward', len(rises) > 3 and rises[-1] < rises[0] and all(b >= a - 1e-6 for a, b in zip(angles, angles[1:])), {'rises': rises[:3] + rises[-2:], 'n': len(rises)})
    falling = next((f[0] for f in down if f[1] < rises[0] - 0.5), None) if rises else None
    t_down = next((f[0] - falling for f in down if f[1] < 0.5), None) if falling is not None else None
    settle = down[-1][0] - falling if down and falling is not None else None
    check('desktop: it is down within about half a second', t_down is not None and t_down <= 0.55, {'s_to_ground': t_down and round(t_down, 2), 's_to_rest': settle and round(settle, 2)})
    check('desktop: the card goes', not s3['cardOn'], s3)
    page.wait_for_timeout(400)
    shot(page, '05-desktop-landed.png', (target['x'], target['y']) if target else None)
    # zoomed in to where the buildings stand: no lift
    camera(page, 14.6)
    t2 = point_on(page, 'Alexander Nevsky Cathedral')
    page.mouse.move(*(lambda p: (p['x'] or 640, p['y'] or 400))(page.evaluate('n => { const s = qaLm.sites.find(s => s.n === n), p = qaMap.project(s.at); return {x: p.x, y: p.y - 10}; }', 'Alexander Nevsky Cathedral')))
    page.wait_for_timeout(800)
    s4 = state(page)
    check('desktop: no lift once the buildings stand (zoom 14.6)', not s4['gate'] and not s4['moving'] and not s4['cardOn'], s4)
    shot(page, '06-desktop-zoomed-in-no-lift.png')
    ctx.close()

    # ---- phone: tap ----
    ctx, page = open_page(browser, True)
    camera(page, 13.2, 45, -20)
    target = point_on(page, 'Alexander Nevsky Cathedral')
    check('phone: the cathedral can be picked', target['x'] is not None, target)
    page.touchscreen.tap(target['x'], target['y'])
    page.wait_for_timeout(1500)
    s5 = state(page)
    shot(page, '07-phone-tapped.png')
    check('phone: a tap lifts it and shows the card', s5['tap'] == target['i'] and s5['cardOn'] and target['i'] in s5['moving'], s5)
    box = s5['cardBox']
    check('phone: the card stays on screen', box and box[0] >= 0 and box[0] + box[2] <= 390 and box[1] >= 0, box)
    page.touchscreen.tap(*(lambda p: (p['x'], p['y']))(point_on(page, 'Alexander Nevsky Cathedral')))
    page.wait_for_timeout(4600)
    s6 = state(page)
    check('phone: a second tap lands it', s6['tap'] == -1 and not s6['moving'] and not s6['cardOn'], s6)
    shot(page, '08-phone-landed.png')
    target = point_on(page, 'Alexander Nevsky Cathedral')
    page.touchscreen.tap(target['x'], target['y'])
    page.wait_for_timeout(900)
    away = empty_point(page)
    page.touchscreen.tap(away['x'], away['y'])
    page.wait_for_timeout(4600)
    s7 = state(page)
    check('phone: a tap beside it lands it', s7['tap'] == -1 and not s7['moving'], s7)
    ctx.close()
    browser.close()

check('no page errors', not errors, errors[:5])
(args.shots / 'report.json').write_text(json.dumps(report, indent=1, default=str), encoding='utf-8')
assert all(r['ok'] for r in report.values()), 'failed: ' + ', '.join(k for k, r in report.items() if not r['ok'])

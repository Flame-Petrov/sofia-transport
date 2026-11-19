"""3D hover (release 110): stops, vehicle numbers and dots grow under the mouse; a phone keeps them still.
Live feed and the real basemap. Usage: 3d-hover-browser.py OUTPUT_DIR"""
import sys, json, threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)

class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(root), **k)
    def log_message(self, *a): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
html = (root / 'index.html').read_text(encoding='utf-8')
html = html.replace('m3 = new maplibregl.Map', 'm3 = window.qaMap = new maplibregl.Map')
hook = 'var hov = hoverFresh();'
assert hook in html
html = html.replace(hook, hook + '\n    window.qaHov3 = function () { return { hov: hov, stops: stopsDrawn, drawn: drawn, far: farDrawn, poses: numberPoses }; };')
start = '  // ---------- Start ----------'
html = html.replace(start, 'window.qaMode=()=>mapMode; window.qaFlat=map;\n' + start)

fails, results = [], []
def check(name, ok, info=''):
    results.append(('PASS' if ok else 'FAIL') + ' ' + name + (' - ' + str(info) if info else ''))
    if not ok: fails.append(name)

def open3d(page, zoom):
    page.route(lambda u: urlsplit(u).path == '/' and urlsplit(u).port == server.server_port, lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.goto(base + '/', wait_until='domcontentloaded', timeout=90000)
    page.wait_for_function('window.qaMode && /vector/.test(qaMode())', timeout=60000)
    page.wait_for_timeout(5000)
    page.evaluate('void qaFlat.setView([42.6955,23.322],15,{animate:false})')
    page.evaluate('document.querySelector(".leaflet-control-3d a").click()')
    page.wait_for_function('window.qaMap && qaMap.isStyleLoaded()', timeout=60000)
    page.evaluate('() => { const d = document.querySelector("#v3Help"); if (d && d.open) d.close(); }')
    page.evaluate('z => void qaMap.jumpTo({center:[23.322,42.6955], zoom:z, pitch:45, bearing:0})', zoom)
    page.wait_for_timeout(5000)

def crop(page, name, x, y, r=70):
    page.screenshot(path=str(out / name), clip={'x': max(0, x - r), 'y': max(0, y - r), 'width': 2 * r, 'height': 2 * r})

# a target far enough from anything else of the other kinds, so the pointer is clearly on it
PICK = '''kind => { const H = qaHov3(), m = qaMap, W = m.getCanvas().clientWidth, Ht = m.getCanvas().clientHeight;
  const pts = (kind === 'stop' ? H.stops.map(s => ({id: String(s.item.stop.id), c: s.c, dy: 0}))
    : kind === 'label' ? H.poses.filter(p => !p.model).map(p => ({id: String(p.k), c: p.c, dy: 0}))
    : H.far.concat(H.drawn).map(p => ({id: String(p.k), c: p.c, dy: 0})))
    .map(p => { const q = m.project(p.c); return {id: p.id, x: q.x, y: q.y + p.dy}; })
    .filter(p => p.x > 480 && p.x < W - 150 && p.y > 200 && p.y < Ht - 150);
  const others = H.stops.map(s => m.project(s.c)).concat(H.drawn.concat(H.far).map(p => m.project(p.c)));
  const lonely = pts.filter(p => others.filter(o => Math.hypot(o.x - p.x, o.y - p.y) < 34).length <= 1);
  return lonely[0] || null; }'''
STATE = '() => { const h = qaHov3().hov, m = qaMap; return { cur: h.cur, k: h.k, prev: h.prev, cursor: m.getCanvas().style.cursor, size: JSON.stringify(m.getLayoutProperty("v3-stops","icon-size")), dot: JSON.stringify(m.getPaintProperty(m.getZoom() < 14 ? "v3-veh-far" : "v3-veh-far","circle-radius")) }; }'

errors = []
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    # ---- PC ----
    ctx = b.new_context(viewport={'width': 1280, 'height': 800})
    ctx.add_init_script('localStorage.setItem("sofia_lang","en"); localStorage.setItem("sofia_3d_help_seen","1");')
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    open3d(page, 15.6)
    check('pc: (hover: hover)', page.evaluate('matchMedia("(hover: hover)").matches'))
    page.screenshot(path=str(out / '01-pc-baseline.png'))
    # a stop
    st = page.evaluate(PICK, 'stop')
    check('pc: a lonely stop on screen', st is not None, st)
    if st:
        crop(page, '02-stop-before.png', st['x'], st['y'])
        page.mouse.move(st['x'] - 60, st['y']); page.mouse.move(st['x'], st['y'], steps=4)
        page.wait_for_timeout(450)
        s = page.evaluate(STATE)
        check('pc: stop hovered', s['cur'] == 's:' + st['id'] and s['k'] == 1, s['cur'])
        check('pc: stop icon 1.3x', st['id'] in s['size'] and '1.3' in s['size'], s['size'][:160])
        check('pc: pointer cursor', s['cursor'] == 'pointer')
        crop(page, '03-stop-hover.png', st['x'], st['y'])
        page.mouse.move(st['x'] + 120, st['y'] + 120, steps=4)
        page.wait_for_timeout(450)
        s = page.evaluate(STATE)
        check('pc: stop back to normal', s['cur'] != 's:' + st['id'] and st['id'] not in s['size'], s['size'][:120])
    # a vehicle number
    page.mouse.move(5, 400)
    page.wait_for_timeout(300)
    lb = page.evaluate(PICK, 'label')
    check('pc: a lonely vehicle number on screen', lb is not None, lb)
    if lb:
        crop(page, '04-label-before.png', lb['x'], lb['y'])
        page.mouse.move(lb['x'] - 60, lb['y']); page.mouse.move(lb['x'], lb['y'], steps=4)
        page.wait_for_timeout(450)
        s = page.evaluate(STATE)
        check('pc: vehicle number hovered', s['cur'] == 'v:' + lb['id'], s['cur'])
        crop(page, '05-label-hover.png', lb['x'], lb['y'])
        page.mouse.move(5, 400)
        page.wait_for_timeout(450)
        check('pc: number released', page.evaluate(STATE)['cur'] is None)
    # dots, zoomed out
    page.evaluate('void qaMap.jumpTo({zoom: 13.2})')
    page.wait_for_timeout(2500)
    dt = page.evaluate(PICK, 'dot')
    check('pc: a lonely dot on screen', dt is not None, dt)
    if dt:
        page.wait_for_timeout(200)
        dt = page.evaluate(PICK, 'dot') or dt
        crop(page, '06-dot-before.png', dt['x'], dt['y'], 50)
        page.mouse.move(dt['x'] - 40, dt['y']); page.mouse.move(dt['x'], dt['y'], steps=4)
        page.wait_for_timeout(450)
        s = page.evaluate(STATE)
        check('pc: dot hovered', (s['cur'] or '').startswith('v:'), s['cur'])
        check('pc: dot radius grows', '5.4' in s['dot'] or '8.1' in s['dot'], s['dot'][:200])
        crop(page, '07-dot-hover.png', dt['x'], dt['y'], 50)
    # drag: nothing grows
    page.mouse.move(640, 400); page.mouse.down(); page.mouse.move(700, 450, steps=6)
    check('pc: nothing hovered while dragging', page.evaluate(STATE)['cur'] is None)
    page.mouse.up()
    ctx.close()
    # ---- Android phone ----
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
        user_agent='Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')
    ctx.add_init_script('localStorage.setItem("sofia_lang","en"); localStorage.setItem("sofia_3d_help_seen","1");')
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append('phone: ' + str(e)))
    open3d(page, 15.6)
    check('phone: (hover: none)', page.evaluate('matchMedia("(hover: none)").matches'))
    st = page.evaluate(PICK.replace('p.x > 480 && p.x < W - 150', 'p.x > 40 && p.x < W - 40'), 'stop')
    if st:
        page.mouse.move(st['x'], st['y'])
        page.wait_for_timeout(400)
        check('phone: a mouse event grows nothing', page.evaluate(STATE)['cur'] is None)
    page.screenshot(path=str(out / '08-phone.png'))
    b.close()
check('no page errors', not errors, errors[:3])
print('\n'.join(results))
print('FAILED' if fails else 'ALL PASS', len(results) - len(fails), '/', len(results))

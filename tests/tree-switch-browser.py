"""Open the menu in the 3D view and use the Trees switch: it is listed, starts on, hides and shows the trees,
and keeps its state after a reload.

Usage: python tests/tree-switch-browser.py OUTPUT_DIR [--standalone] [--phone]
Needs the Python 3.12 venv in old/osm-work (Playwright) and Chrome.
"""
import argparse, threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('shots', type=Path)
parser.add_argument('--standalone', action='store_true', help='Use the numbered release instead of index.html')
parser.add_argument('--phone', action='store_true', help='390 x 844 at device pixel ratio 3')
parser.add_argument('--seasons', default='summer,autumn,winter,spring')
parser.add_argument('--only', default='', help='Comma-separated camera names; all when empty')
args = parser.parse_args()
args.shots.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]
RELEASE = max(root.parent.glob('*_public-transport.html'), key=lambda p: int(p.name.split('_')[0]))
CAMERAS = [('borisova', 23.3420, 42.6830, 16.4, 62, 30), ('citygarden', 23.3256, 42.6950, 17.3, 60, 110),
    ('southpark', 23.3075, 42.6720, 16.3, 62, 200), ('doctors', 23.3335, 42.6940, 17.6, 62, 330),
    ('street', 23.3290, 42.6880, 17.8, 66, 20), ('close', 23.3368, 42.6865, 18.6, 68, 60)]
if args.only: CAMERAS = [c for c in CAMERAS if c[0] in args.only.split(',')]

class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(root), **k)
    def log_message(self, *a): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
style = {'version': 8, 'glyphs': 'ofm://fixture.example/fonts/{fontstack}/{range}.pbf',
    'sources': {'street': {'type': 'vector', 'minzoom': 0, 'maxzoom': 14,
                           'tiles': ['ofm://fixture.example/14mock/{z}/{x}/{y}.pbf']}},
    'layers': [{'id': 'background', 'type': 'background', 'paint': {'background-color': '#e9ebe6'}},
        {'id': 'city', 'type': 'fill', 'source': 'street', 'source-layer': 'building', 'paint': {'fill-color': 'hsl(40,20%,80%)'}},
        {'id': 'blocks', 'type': 'fill-extrusion', 'source': 'street', 'source-layer': 'building', 'filter': ['!', ['has', 'hide_3d']],   # as in the live style
         'paint': {'fill-extrusion-height': ['get', 'render_height']}}]}

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    size = {'width': 390, 'height': 844} if args.phone else {'width': 1100, 'height': 760}
    html = (RELEASE if args.standalone else root / 'index.html').read_text(encoding='utf-8')
    html = html.replace('m3 = new maplibregl.Map', 'm3 = window.qaMap = new maplibregl.Map')
    start = '  // ---------- Start ----------'
    html = html.replace(start, 'window.qaMode=()=>mapMode; window.qaFlat=map; window.qaTrees=trees;\n' + start)
    ctx = browser.new_context(viewport=size, device_scale_factor=3 if args.phone else 1, has_touch=args.phone, is_mobile=args.phone)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.route(lambda u: urlsplit(u).path == '/' and urlsplit(u).port == server.server_port, lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.set_default_timeout(20000)
    page.route('https://tiles.openfreemap.org/styles/liberty', lambda r: r.fulfill(json=style))
    def tile(r):
        u = urlsplit(r.request.url).path.split('/')
        f = root / 'tiles/buildings/14' / '/'.join(u[-2:])
        r.fulfill(body=f.read_bytes() if len(u) > 3 and u[-3] == '14' and f.is_file() else b'', content_type='application/octet-stream')
    page.route('https://fixture.example/**', tile)
    page.route('**/api/v1/**', lambda r: r.fulfill(status=503, body='fixture'))
    def open3d():
        page.goto(base + '/?season=summer', wait_until='domcontentloaded', timeout=65000)
        page.wait_for_function('window.qaMode && qaMode() === "vector map"', timeout=30000)
        page.evaluate('qaFlat.setView([42.6830,23.3420],17,{animate:false})')
        page.evaluate('document.querySelector(".leaflet-control-3d a").click()')
        page.wait_for_function('window.qaMap && qaMap.getLayer("v3-trees")', timeout=30000)
        page.evaluate('() => document.querySelector("#v3Help button")?.click()')
        # The fixture fails the live feed on purpose, which raises the reload popup: keep it out of the way.
        page.add_style_tag(content='#reloadDlg { display: none !important; }')
        page.evaluate('qaMap.jumpTo({center:[23.3420,42.6830], zoom:16.6, pitch:60, bearing:30})')
        page.wait_for_function('qaTrees.stats().loading === 0', timeout=20000)
        page.wait_for_timeout(2000)
    def open_menu():
        if page.get_attribute('#fold', 'aria-expanded') != 'true':
            page.click('#fold')
        page.wait_for_timeout(600)
        page.locator('#v3TreeRow').scroll_into_view_if_needed()
        page.wait_for_timeout(300)
    report = {}
    open3d()
    open_menu()
    row = page.locator('#v3TreeRow')
    report['listed'] = row.is_visible()
    report['label'] = row.inner_text().strip()
    report['starts_on'] = page.is_checked('#v3Trees')
    page.screenshot(path=str(args.shots / '01-menu-trees-switch-on.png'))
    row.locator('.sw').click()   # the visible switch, as a rider taps it
    page.wait_for_timeout(1200)
    report['after_off'] = {'checked': page.is_checked('#v3Trees'), 'shown': page.evaluate('qaTrees.shown()'), 'saved': page.evaluate('localStorage.getItem("sofia_3d_trees")')}
    page.screenshot(path=str(args.shots / '02-menu-trees-switch-off.png'))
    page.click('#fold'); page.wait_for_timeout(800)
    page.screenshot(path=str(args.shots / '03-map-trees-off.png'))
    open3d()
    open_menu()
    report['after_reload'] = {'checked': page.is_checked('#v3Trees'), 'shown': page.evaluate('qaTrees.shown()')}
    page.locator('#v3TreeRow .sw').click()
    page.wait_for_timeout(1200)
    report['back_on'] = {'checked': page.is_checked('#v3Trees'), 'shown': page.evaluate('qaTrees.shown()'), 'saved': page.evaluate('localStorage.getItem("sofia_3d_trees")')}
    page.click('#fold'); page.wait_for_timeout(1500)
    page.screenshot(path=str(args.shots / '04-map-trees-on-again.png'))
    report['errors'] = errors[:5]
    print(report, flush=True)
    browser.close()
    assert report['listed'] and report['label'] == 'Trees' and report['starts_on']
    assert report['after_off'] == {'checked': False, 'shown': False, 'saved': '0'}
    assert report['after_reload'] == {'checked': False, 'shown': False}
    assert report['back_on'] == {'checked': True, 'shown': True, 'saved': '1'}
    assert not errors, errors

"""Screenshot the 3D trees in parks, streets and woods for each season, and check the Trees switch.

Usage: python tests/trees-browser.py OUTPUT_DIR [--standalone] [--phone] [--seasons summer,autumn,winter]
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
    report = {}
    for season in args.seasons.split(','):
        ctx = browser.new_context(viewport=size, device_scale_factor=3 if args.phone else 1, has_touch=args.phone, is_mobile=args.phone)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'api/v1' not in m.text and '503' not in m.text else None)
        page.route(lambda u: urlsplit(u).path == '/' and urlsplit(u).port == server.server_port, lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8'))
        page.set_default_timeout(20000)
        page.route('https://tiles.openfreemap.org/styles/liberty', lambda r: r.fulfill(json=style))
        def tile(r):
            u = urlsplit(r.request.url).path.split('/')
            f = root / 'tiles/buildings/14' / '/'.join(u[-2:])
            r.fulfill(body=f.read_bytes() if len(u) > 3 and u[-3] == '14' and f.is_file() else b'', content_type='application/octet-stream')
        page.route('https://fixture.example/**', tile)
        page.route('**/api/v1/**', lambda r: r.fulfill(status=503, body='fixture'))
        page.goto(base + '/?season=' + season + '&daytime=15:00', wait_until='domcontentloaded', timeout=65000)
        page.wait_for_function('window.qaMode && qaMode() === "vector map"', timeout=30000)
        page.evaluate('qaFlat.setView([42.69,23.33],17,{animate:false})')
        page.evaluate('document.querySelector(".leaflet-control-3d a").click()')
        page.wait_for_function('window.qaMap && qaMap.getLayer("v3-trees")', timeout=30000)
        page.evaluate('''() => { document.querySelector("#v3Help button")?.click();
            document.querySelector("#v3Textures").click(); }''')
        page.add_style_tag(content='#map ~ *, .leaflet-control-container, .maplibregl-control-container { visibility: hidden !important; }')
        assert page.evaluate('document.querySelector("#v3Trees").checked'), 'Trees switch should start on'
        for name, lng, lat, zoom, pitch, bearing in CAMERAS:
            page.evaluate('c => qaMap.jumpTo({center:[c[0],c[1]], zoom:c[2], pitch:c[3], bearing:c[4]})', [lng, lat, zoom, pitch, bearing])
            page.wait_for_function('qaTrees.stats().loading === 0', timeout=20000)
            page.wait_for_timeout(2500)
            page.screenshot(path=str(args.shots / f'{season}-{name}.png'))
        report[season] = {'season': page.evaluate('qaTrees.season()'), 'stats': page.evaluate('qaTrees.stats()'), 'errors': errors[:5]}
        if season == args.seasons.split(',')[0]:
            page.evaluate('document.querySelector("#v3Trees").click()')
            page.wait_for_timeout(1500)
            page.screenshot(path=str(args.shots / f'{season}-switch-off.png'))
            report['switch'] = {'saved': page.evaluate('localStorage.getItem("sofia_3d_trees")'), 'shown': page.evaluate('qaTrees.shown()')}
        print(season, report[season], flush=True)
        ctx.close()
    print(report.get('switch'))
    browser.close()
    assert not any(r['errors'] for k, r in report.items() if k != 'switch'), 'page errors'
    assert report['switch'] == {'saved': '0', 'shown': False}

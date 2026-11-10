"""Screenshot the textured 3D façades in Chrome at fixed Sofia cameras.

Usage: python tests/facade-shots-browser.py OUTPUT_DIR [--houses] [--plain] [--standalone]
"""
import argparse, threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('shots', type=Path)
parser.add_argument('--houses', action='store_true', help='Also enable the house designs switch')
parser.add_argument('--plain', action='store_true', help='Enable only the house designs switch')
parser.add_argument('--standalone', action='store_true', help='Use the numbered release instead of index.html')
args = parser.parse_args()
args.shots.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]
# name, longitude, latitude, zoom, pitch, bearing
CAMERAS = [('close-up', 23.3282, 42.6922, 18.6, 66, 15), ('centre', 23.3219, 42.6977, 17.6, 62, 20), ('centre-wide', 23.3260, 42.6950, 15.6, 55, -30),
           ('panel-estate', 23.3765, 42.6500, 16.6, 60, 40), ('house-streets', 23.2890, 42.6620, 17.4, 58, 10),
           ('industrial', 23.3700, 42.7120, 16.4, 58, -20), ('towers', 23.3190, 42.6680, 16.4, 62, 60)]

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
        {'id': 'city', 'type': 'fill', 'source': 'street', 'source-layer': 'building'},
        {'id': 'blocks', 'type': 'fill-extrusion', 'source': 'street', 'source-layer': 'building',
         'paint': {'fill-extrusion-height': ['get', 'render_height']}}]}

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    ctx = browser.new_context(viewport={'width': 1100, 'height': 760}, device_scale_factor=1)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'api/v1' not in m.text and '503' not in m.text else None)
    html = (root / ('../102_public-transport.html' if args.standalone else 'index.html')).read_text(encoding='utf-8')
    html = html.replace('m3 = new maplibregl.Map', 'm3 = window.qaMap = new maplibregl.Map')
    start = '  // ---------- Start ----------'
    html = html.replace(start, 'window.qaMode=()=>mapMode; window.qaFlat=map;\n' + start)
    page.route(base + '/', lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.set_default_timeout(20000)
    page.route('https://tiles.openfreemap.org/styles/liberty', lambda r: r.fulfill(json=style))
    def tile(r):
        u = urlsplit(r.request.url).path.split('/')
        f = root / 'tiles/buildings/14' / '/'.join(u[-2:])
        r.fulfill(body=f.read_bytes() if len(u) > 3 and u[-3] == '14' and f.is_file() else b'',
                  content_type='application/octet-stream')
    page.route('https://fixture.example/**', tile)
    page.route('**/api/v1/**', lambda r: r.fulfill(status=503, body='fixture'))
    page.goto(base + '/', wait_until='domcontentloaded', timeout=65000)
    page.wait_for_function('window.qaMode && qaMode() === "vector map"', timeout=30000)
    page.evaluate('qaFlat.setView([42.698,23.322],17,{animate:false})')
    page.evaluate('document.querySelector(".leaflet-control-3d a").click()')
    page.wait_for_function('window.qaMap && qaMap.getLayer("v3-models")', timeout=30000)
    page.evaluate('''(o) => { document.querySelector("#v3Help button")?.click();
        if (!o.plain) document.querySelector("#v3Textures").click();
        if (o.houses || o.plain) document.querySelector("#v3HouseDesigns").click(); }''', {'houses': args.houses, 'plain': args.plain})
    page.add_style_tag(content='#map ~ *, .leaflet-control-container, .maplibregl-control-container { visibility: hidden !important; }')
    for name, lng, lat, zoom, pitch, bearing in CAMERAS:
        page.evaluate('c => qaMap.jumpTo({center:[c[0],c[1]], zoom:c[2], pitch:c[3], bearing:c[4]})', [lng, lat, zoom, pitch, bearing])
        page.wait_for_timeout(3500)
        page.screenshot(path=str(args.shots / (name + ('-plain' if args.plain else '-houses' if args.houses else '') + ('-standalone' if args.standalone else '') + '.png')))
        print(name, flush=True)
    assert not errors, errors
    browser.close()
server.shutdown()

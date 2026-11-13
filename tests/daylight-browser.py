"""Screenshot the 3D view across the day with the day and night cycle on, and once with it off.

Usage: python tests/daylight-browser.py OUTPUT_DIR [--standalone] [--phone]
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
parser.add_argument('--times', default='12:00,16:30,17:30,00:00,06:50')
args = parser.parse_args()
args.shots.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]
RELEASE = max(root.parent.glob('*_public-transport.html'), key=lambda p: int(p.name.split('_')[0]))
CAMERAS = [('centre', 23.3219, 42.6977, 16.6, 60, 20), ('close', 23.3282, 42.6922, 18.2, 62, 200)]

class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(root), **k)
    def log_message(self, *a): pass
ThreadingHTTPServer.request_queue_size = 64   # Chrome opens many tile connections at once
server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
style = {'version': 8, 'glyphs': 'ofm://fixture.example/fonts/{fontstack}/{range}.pbf',
    'sources': {'street': {'type': 'vector', 'minzoom': 0, 'maxzoom': 14,
                           'tiles': ['ofm://fixture.example/14mock/{z}/{x}/{y}.pbf']}},
    'layers': [{'id': 'background', 'type': 'background', 'paint': {'background-color': '#e9ebe6'}},
        {'id': 'city', 'type': 'fill', 'source': 'street', 'source-layer': 'building', 'paint': {'fill-color': 'hsl(40,20%,80%)'}},
        {'id': 'blocks', 'type': 'fill-extrusion', 'source': 'street', 'source-layer': 'building',
         'paint': {'fill-extrusion-height': ['get', 'render_height']}}]}

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    size = {'width': 390, 'height': 844} if args.phone else {'width': 1100, 'height': 760}
    ctx = browser.new_context(viewport=size, device_scale_factor=3 if args.phone else 1, has_touch=args.phone, is_mobile=args.phone)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'api/v1' not in m.text and '503' not in m.text else None)
    html = (RELEASE if args.standalone else root / 'index.html').read_text(encoding='utf-8')
    html = html.replace('m3 = new maplibregl.Map', 'm3 = window.qaMap = new maplibregl.Map')
    start = '  // ---------- Start ----------'
    html = html.replace(start, 'window.qaMode=()=>mapMode; window.qaFlat=map; window.qaDay=daylight;\n' + start)
    page.route(base + '/', lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.set_default_timeout(20000)
    page.route('https://tiles.openfreemap.org/styles/liberty', lambda r: r.fulfill(json=style))
    def tile(r):
        u = urlsplit(r.request.url).path.split('/')
        f = root / 'tiles/buildings/14' / '/'.join(u[-2:])
        r.fulfill(body=f.read_bytes() if len(u) > 3 and u[-3] == '14' and f.is_file() else b'', content_type='application/octet-stream')
    page.route('https://fixture.example/**', tile)
    page.route('**/api/v1/**', lambda r: r.fulfill(status=503, body='fixture'))
    page.goto(base + '/', wait_until='domcontentloaded', timeout=65000)
    page.wait_for_function('window.qaMode && qaMode() === "vector map"', timeout=30000)
    page.evaluate('qaFlat.setView([42.698,23.322],17,{animate:false})')
    page.evaluate('document.querySelector(".leaflet-control-3d a").click()')
    page.wait_for_function('window.qaMap && qaMap.getLayer("v3-models")', timeout=30000)
    page.evaluate('''() => { document.querySelector("#v3Help button")?.click();
        document.querySelector("#v3Textures").click(); document.querySelector("#v3HouseDesigns").click(); }''')
    page.add_style_tag(content='#map ~ *, .leaflet-control-container, .maplibregl-control-container { visibility: hidden !important; }')
    assert page.evaluate('document.querySelector("#v3Daylight") !== null && !document.querySelector("#v3Daylight").checked')
    def shoot(label):
        for name, lng, lat, zoom, pitch, bearing in CAMERAS:
            page.evaluate('c => qaMap.jumpTo({center:[c[0],c[1]], zoom:c[2], pitch:c[3], bearing:c[4]})', [lng, lat, zoom, pitch, bearing])
            page.wait_for_timeout(2500)
            page.screenshot(path=str(args.shots / f'{label}-{name}.png'))
        print(label, page.evaluate('JSON.stringify({day: qaDay.enabled(), clock: qaDay.clock(), alt: Math.round(qaDay.state().sunAlt), moon: Math.round(qaDay.state().moonAlt), lit: qaDay.lighting().lit})'), flush=True)
    shoot('off')
    page.evaluate('document.querySelector("#v3Daylight").click()')
    assert page.evaluate('qaDay.enabled()')
    for t in args.times.split(','):
        h, m = t.split(':')
        page.evaluate('m => qaDay.preview(m)', int(h) * 60 + int(m))
        shoot('on-' + t.replace(':', ''))
    page.evaluate('document.querySelector("#v3Daylight").click()')   # back off: the fixed afternoon returns
    assert not page.evaluate('qaDay.enabled()')
    shoot('off-again')
    assert not errors, errors
    browser.close()
server.shutdown()

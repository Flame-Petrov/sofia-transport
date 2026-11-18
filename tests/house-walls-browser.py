"""Detailed buildings at close zoom: modelled houses must not show the textured wall pattern (z-fighting).

Usage: python tests/house-walls-browser.py OUTPUT_DIR [PAGE_HTML]   (default: index.html)
Saves three cameras at three zooms, then eight frames of a follow-style move. Compare against an older page by
passing its HTML. Uses the bundled building tiles under tiles/buildings/14 and a fixture basemap.
"""
import sys, threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
out = Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]
CAMS = [('houses', 23.2890, 42.6620, 66, 10), ('lozenets', 23.3220, 42.6800, 62, 134), ('centre', 23.3282, 42.6922, 66, 15)]
ZOOMS = [18.2, 18.9, 19.6]
class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(root), **k)
    def log_message(self, *a): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
style = {'version': 8, 'glyphs': 'ofm://fixture.example/fonts/{fontstack}/{range}.pbf',
    'sources': {'street': {'type': 'vector', 'minzoom': 0, 'maxzoom': 14, 'tiles': ['ofm://fixture.example/14mock/{z}/{x}/{y}.pbf']}},
    'layers': [{'id': 'background', 'type': 'background', 'paint': {'background-color': '#e9ebe6'}},
        {'id': 'city', 'type': 'fill', 'source': 'street', 'source-layer': 'building'},
        {'id': 'blocks', 'type': 'fill-extrusion', 'source': 'street', 'source-layer': 'building',
         'paint': {'fill-extrusion-height': ['get', 'render_height']}}]}
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    page = browser.new_context(viewport={'width': 900, 'height': 700}, device_scale_factor=1).new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    html = (Path(sys.argv[2]) if len(sys.argv) > 2 else root / 'index.html').read_text(encoding='utf-8')
    html = html.replace('m3 = new maplibregl.Map', 'm3 = window.qaMap = new maplibregl.Map')
    start = '  // ---------- Start ----------'
    assert start in html
    html = html.replace(start, 'window.qaMode=()=>mapMode; window.qaFlat=map;\n' + start)
    page.route(base + '/', lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page.route('https://tiles.openfreemap.org/styles/liberty', lambda r: r.fulfill(json=style))
    def tile(r):
        u = urlsplit(r.request.url).path.split('/')
        f = root / 'tiles/buildings/14' / '/'.join(u[-2:])
        r.fulfill(body=f.read_bytes() if len(u) > 3 and u[-3] == '14' and f.is_file() else b'', content_type='application/octet-stream')
    page.route('https://fixture.example/**', tile)
    page.route('**/api/v1/**', lambda r: r.fulfill(status=503, body='fixture'))
    page.add_init_script('try{localStorage.setItem("sofia_3d_trees","0");localStorage.setItem("sofia_3d_roads","0");localStorage.setItem("sofia_3d_help_seen","1")}catch(e){}')
    page.goto(base + '/', wait_until='domcontentloaded', timeout=65000)
    page.wait_for_function('window.qaMode && qaMode() === "vector map"', timeout=30000)
    page.evaluate('qaFlat.setView([42.698,23.322],17,{animate:false})')
    page.evaluate('document.querySelector(".leaflet-control-3d a").click()')
    page.wait_for_function('window.qaMap && qaMap.getLayer("v3-models")', timeout=30000)
    page.evaluate('''() => { document.querySelector("#v3Help button")?.click();
        document.querySelector('#v3BuildLevel [data-level="detailed"]').click(); }''')
    page.add_style_tag(content='#map ~ *, .leaflet-control-container, .maplibregl-control-container { visibility: hidden !important; }')
    assert page.evaluate('''() => v3Textures.checked && v3HouseDesigns.checked && !!qaMap.getLayer('blocks-material-houses')''')
    for name, lng, lat, pitch, bearing in CAMS:
        for z in ZOOMS:
            page.evaluate('c => qaMap.jumpTo({center:[c[0],c[1]], zoom:c[2], pitch:c[3], bearing:c[4]})', [lng, lat, z, pitch, bearing])
            page.wait_for_timeout(3000)
            page.screenshot(path=str(out / f'{name}-z{z}.png')); print(name, z, flush=True)
    page.evaluate('c => qaMap.jumpTo({center:[c[0],c[1]], zoom:18.6, pitch:60, bearing:134})', [23.3220, 42.6800])
    page.wait_for_timeout(3500)
    for k in range(40):
        t = k / 39
        page.evaluate('c => qaMap.jumpTo({center:[c[0],c[1]], zoom:c[2]})', [23.3220 + 0.0012*t, 42.6800 - 0.0008*t, 18.6 + 0.8*t])
        page.wait_for_timeout(100)
        if k % 8 == 7: page.screenshot(path=str(out / f'motion-{k//8}.png')); print('motion', k, flush=True)
    assert not errors, errors
    print('no page errors')
    browser.close()
server.shutdown()

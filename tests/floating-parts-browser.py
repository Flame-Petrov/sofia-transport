"""Raised building parts must stand on something: the outline under them is drawn where no part fills it.

Usage: python tests/floating-parts-browser.py OUTPUT_DIR [PAGE_HTML] [--old]   (default: index.html)
Checks the tile features of three buildings whose relation outline was hidden although its parts leave
ground uncovered (the Archaeological Museum's nine domes, the Postbank head office, block 514 in Druzhba 2),
then saves a shot of each in 3D. --old expects the outlines missing (to confirm the check fails on old tiles).
Uses the bundled building tiles under tiles/buildings/14 and a fixture basemap.
"""
import sys, threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright
root = Path(__file__).resolve().parents[1]
OLD = '--old' in sys.argv
args = [a for a in sys.argv[1:] if a != '--old']
out = Path(args[0]); out.mkdir(parents=True, exist_ok=True)
# name, outline feature id, its height, lng, lat, zoom, pitch, bearing
CAMS = [('museum-domes', 1577401992, 10, 23.32455, 42.69640, 19.3, 60, 194),
        ('postbank', 2721360222, 28, 23.38023, 42.62245, 18.4, 60, 30),
        ('block-514', 359627462, 33, 23.41388, 42.64191, 18.4, 60, 160)]
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
         'paint': {'fill-extrusion-height': ['get', 'render_height'], 'fill-extrusion-base': ['get', 'render_min_height']}}]}
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    page = browser.new_context(viewport={'width': 900, 'height': 700}, device_scale_factor=1).new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    html = (Path(args[1]) if len(args) > 1 else root / 'index.html').read_text(encoding='utf-8')
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
    failures = []
    for name, fid, height, lng, lat, z, pitch, bearing in CAMS:
        page.evaluate('c => qaMap.jumpTo({center:[c[0],c[1]], zoom:c[2], pitch:c[3], bearing:c[4]})', [lng, lat, z, pitch, bearing])
        page.wait_for_timeout(3500)
        found = page.evaluate("""id => qaMap.querySourceFeatures('street', {sourceLayer: 'building'})
            .filter(f => f.id === id).map(f => [f.properties.render_min_height, f.properties.render_height])""", fid)
        page.screenshot(path=str(out / f'{name}.png'))
        ok = (not found) if OLD else bool(found) and all(f == [0, height] for f in found)
        print(name, 'outline pieces', found, 'OK' if ok else 'FAIL', flush=True)
        if not ok: failures.append(name)
    assert not failures, failures
    assert not errors, errors
    print('no page errors')
    browser.close()
server.shutdown()

"""Check the three switches for what the 3D view draws: vehicle models, buildings, landmarks and monuments.

Usage: python tests/show-switches-browser.py OUTPUT_DIR [--standalone] [--phone]
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
args = parser.parse_args()
args.shots.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]
RELEASE = max(root.parent.glob('*_public-transport.html'), key=lambda p: int(p.name.split('_')[0]))
CAMERAS = [('nevsky', 23.3328, 42.6958, 17.3, 62, 150), ('ndk', 23.3189, 42.6850, 16.4, 60, 200), ('theatre', 23.3264, 42.6943, 17.4, 60, 130),
    ('largo', 23.3232, 42.6976, 16.6, 62, 100), ('mosque', 23.3222, 42.6997, 17.6, 62, 140), ('russian', 23.3290, 42.6956, 18, 62, 30),
    ('monuments', 23.3345, 42.6957, 17.2, 62, 80), ('tvtower', 23.3417, 42.6768, 16.6, 66, 40), ('serdika', 23.3534, 42.6917, 16.3, 58, 20),
    ('paradise', 23.3149, 42.6576, 16, 58, 60)]

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
    ctx = browser.new_context(viewport=size, device_scale_factor=3 if args.phone else 1, has_touch=args.phone, is_mobile=args.phone)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'api/v1' not in m.text and '503' not in m.text else None)
    html = (RELEASE if args.standalone else root / 'index.html').read_text(encoding='utf-8')
    html = html.replace('m3 = new maplibregl.Map', 'm3 = window.qaMap = new maplibregl.Map')
    start = '  // ---------- Start ----------'
    html = html.replace(start, 'window.qaMode=()=>mapMode; window.qaFlat=map; window.qaDay=daylight; window.qaShadows=shadows;\n' + start)
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
    page.evaluate('document.querySelector("#v3Help button")?.click()')
    page.add_style_tag(content='#map ~ *, .leaflet-control-container, .maplibregl-control-container { visibility: hidden !important; }')
    NDK = 23.3189, 42.6850, 16.4, 60, 200
    def box(i): return 'document.querySelector("#' + i + '")'
    def state():
        return page.evaluate("""() => ({
            blocks: qaMap.getLayoutProperty("blocks", "visibility") || "visible",
            material: qaMap.getLayoutProperty("blocks-material", "visibility") || "visible",
            drawn: qaMap.queryRenderedFeatures({layers: ["blocks-material"]}).length,
            filter: JSON.stringify(qaMap.getFilter("blocks-material")),
            textures: document.querySelector("#v3TextureRow").hidden,
            saved: ["sofia_3d_vehicle_models", "sofia_3d_buildings", "sofia_3d_landmarks"].map(k => localStorage.getItem(k)) })""")
    def shoot(name, camera=NDK):
        page.evaluate('c => qaMap.jumpTo({center:[c[0],c[1]], zoom:c[2], pitch:c[3], bearing:c[4]})', list(camera))
        page.wait_for_timeout(3000)
        page.screenshot(path=str(args.shots / (name + '.png')))
        return state()
    for i in ('v3VehicleModels', 'v3Buildings', 'v3Landmarks'):
        assert page.evaluate(box(i) + '.checked && !' + box(i) + '.closest("#v3ShowRow").hidden'), i
    all_on = shoot('1-all-on')
    assert all_on['material'] == 'visible' and all_on['drawn'] > 50 and not all_on['textures'], all_on
    page.evaluate(box('v3Buildings') + '.click()')
    monuments = shoot('2-buildings-off')
    assert monuments['blocks'] == 'none' and monuments['material'] == 'none' and monuments['drawn'] == 0 and monuments['textures'], monuments
    assert monuments['saved'][1] == '0'
    shoot('2-buildings-off-monuments', CAMERAS[6][1:])
    page.evaluate(box('v3Landmarks') + '.click()')
    bare = shoot('3-buildings-and-landmarks-off')
    assert bare['saved'] == [None, '0', '0'], bare
    page.evaluate(box('v3Buildings') + '.click()')
    plain = shoot('4-landmarks-off')
    assert plain['material'] == 'visible' and plain['drawn'] > 50, plain
    assert len(plain['filter']) < len(all_on['filter']) and plain['filter'] != all_on['filter'], 'landmark buildings are back in the extrusion layer'
    page.evaluate(box('v3VehicleModels') + '.click()')
    assert page.evaluate('localStorage.getItem("sofia_3d_vehicle_models")') == '0'
    # The switches survive a reload.
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function('window.qaMode && qaMode() === "vector map"', timeout=30000)
    kept = page.evaluate('["v3VehicleModels", "v3Buildings", "v3Landmarks"].map(i => document.getElementById(i).checked)')
    assert kept == [False, True, False], kept
    print('switches', {'all on': all_on['drawn'], 'buildings off': monuments['drawn'], 'landmarks off': plain['drawn'], 'after reload': kept}, flush=True)
    assert not errors, errors
    browser.close()
server.shutdown()

"""Screenshot the landmark and mall models, check the Shadows switch and the eased Ctrl+arrow camera.

Usage: python tests/landmarks-browser.py OUTPUT_DIR [--standalone] [--phone]
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
parser.add_argument('--times', default='15:00,21:00')
parser.add_argument('--only', default='', help='Comma-separated camera names; all when empty')
args = parser.parse_args()
args.shots.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]
RELEASE = max(root.parent.glob('*_public-transport.html'), key=lambda p: int(p.name.split('_')[0]))
CAMERAS = [('nevsky', 23.3328, 42.6958, 17.3, 62, 150), ('ndk', 23.3189, 42.6850, 16.4, 60, 200), ('theatre', 23.3264, 42.6943, 17.4, 60, 130),
    ('largo', 23.3232, 42.6976, 16.6, 62, 100), ('mosque', 23.3222, 42.6997, 17.6, 62, 140), ('russian', 23.3290, 42.6956, 18, 62, 30),
    ('monuments', 23.3345, 42.6957, 17.2, 62, 80), ('tvtower', 23.3417, 42.6768, 16.6, 66, 40), ('serdika', 23.3534, 42.6917, 16.3, 58, 20),
    ('paradise', 23.3149, 42.6576, 16, 58, 60), ('national', 23.3353, 42.6876, 16.2, 58, 20), ('cska', 23.3398, 42.6842, 16.6, 58, 140),
    ('levskistadium', 23.3633, 42.7054, 16.2, 58, 60), ('lokomotiv', 23.3147, 42.7376, 16.2, 58, 30), ('slavia', 23.2719, 42.6752, 16.2, 58, 110),
    ('sofiauni', 23.3354, 42.6935, 17, 60, 200), ('tu', 23.3567, 42.6573, 16.6, 58, 30), ('uaceg', 23.3318, 42.6838, 16.6, 60, 250),
    ('nbu', 23.2529, 42.6779, 16.8, 58, 30), ('arts', 23.3342, 42.6951, 17.6, 62, 280)]
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
    page.evaluate('document.querySelector("#v3Daylight").click()')
    assert page.evaluate('qaDay.enabled() && !document.querySelector("#v3ShadowRow").hidden && document.querySelector("#v3Shadows").checked')
    for t in args.times.split(','):
        h, m = t.split(':')
        page.evaluate('m => qaDay.preview(m)', int(h) * 60 + int(m))
        shoot('on-' + t.replace(':', ''))
    # The Shadows switch alone: same light, no ground shadows.
    page.evaluate('m => qaDay.preview(m)', 15 * 60)
    lit = page.evaluate('qaShadows.strength(qaMap)')
    page.evaluate('document.querySelector("#v3Shadows").click()')
    assert page.evaluate('localStorage.getItem("sofia_3d_shadows") === "0" && qaDay.enabled()')
    assert lit > 0.2 and page.evaluate('qaShadows.strength(qaMap)') == 0 and page.evaluate('qaDay.lighting().color[1]') > 0.2
    print('shadows switch', {'strength before': lit, 'after': 0}, flush=True)
    CAMERAS[:] = CAMERAS[:1]
    shoot('no-shadows')
    page.evaluate('document.querySelector("#v3Shadows").click()')
    assert page.evaluate('qaShadows.strength(qaMap)') > 0.2
    # Ctrl+Right: one tap eases through 10 degrees over several frames.
    page.evaluate('''() => { window.qaBearings = []; qaMap.on("rotate", () => qaBearings.push(qaMap.getBearing()));
        const key = type => qaMap.getCanvas().dispatchEvent(new KeyboardEvent(type, { key: "ArrowRight", ctrlKey: true, bubbles: true, cancelable: true }));
        window.qaStart = qaMap.getBearing(); key("keydown"); setTimeout(() => key("keyup"), 30); }''')
    page.wait_for_timeout(1500)
    turn = page.evaluate('({ by: ((qaMap.getBearing() - qaStart) % 360 + 360) % 360, steps: qaBearings.length })')
    print('keyboard', turn, flush=True)
    assert abs(turn['by'] - 10) < 0.2 and turn['steps'] >= 5, turn
    # Held for a second: the tap's 10 degrees and then a steady 100 degrees a second, easing out after release.
    page.evaluate('''() => { const key = type => qaMap.getCanvas().dispatchEvent(new KeyboardEvent(type, { key: "ArrowLeft", ctrlKey: true, bubbles: true, cancelable: true }));
        window.qaStart = qaMap.getBearing(); window.qaBearings = []; key("keydown"); setTimeout(() => key("keyup"), 1000); }''')
    page.wait_for_timeout(2500)
    hold = page.evaluate('({ by: ((qaStart - qaMap.getBearing()) % 360 + 360) % 360, steps: qaBearings.length })')
    print('keyboard hold', hold, flush=True)
    assert 60 < hold['by'] < 110 and hold['steps'] >= 10, hold
    assert page.evaluate('qaMap.queryRenderedFeatures({layers:["blocks-material"]}).length') > 50, 'buildings are drawn'
    assert not errors, errors
    browser.close()
server.shutdown()

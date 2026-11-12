"""Check the 3D roads and tracks in Chrome: the switch, the fallbacks, and what a frame costs.

Usage: python tests/roads-browser.py OUTPUT_DIR [--standalone] [--phone] [--throttle N]
Needs the Python 3.12 venv in old/osm-work (Playwright) and Chrome.

Headless Chrome draws with SwiftShader, so frame times here only compare the switch on
against off in the same run. The counts (uploads, requests, draws, triangles) are exact.
"""
import argparse, json, threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('shots', type=Path)
parser.add_argument('--standalone', action='store_true', help='Use the numbered release instead of index.html')
parser.add_argument('--phone', action='store_true', help='390 x 844 at device pixel ratio 3 with touch')
parser.add_argument('--throttle', type=float, default=4, help='CPU slowdown during the replays (default 4)')
args = parser.parse_args()
args.shots.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]
RELEASE = max(root.parent.glob('*_public-transport.html'), key=lambda p: int(p.name.split('_')[0]))
# name, lng, lat, zoom, pitch, bearing
CAMERAS = [('serdika', 23.3219, 42.6977, 17.2, 55, 20), ('tram-junction', 23.3215, 42.6925, 17.6, 55, 300),
           ('tsarigradsko', 23.3440, 42.6850, 16.6, 58, 120), ('residential', 23.3050, 42.6830, 17.2, 55, 0),
           ('rail', 23.3215, 42.7125, 16.8, 55, 80), ('close', 23.3219, 42.6945, 18.6, 50, 40)]

DETAIL = [('detail-tram-junction', 23.3213, 42.6927, 19.3, 50, 300), ('detail-crossing', 23.3222, 42.6968, 19.6, 45, 10),
          ('detail-tram-bed', 23.3219, 42.6990, 19.2, 55, 0), ('detail-railway', 23.3215, 42.7125, 18.6, 55, 80),
          ('detail-boulevard', 23.3440, 42.6850, 18.4, 55, 120)]

class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(root), **k)
    def log_message(self, *a): pass
class Server(ThreadingHTTPServer):
    def handle_error(self, request, client_address): pass   # Chrome drops connections it no longer needs
server = Server(('127.0.0.1', 0), Quiet)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
style = {'version': 8, 'glyphs': 'ofm://fixture.example/fonts/{fontstack}/{range}.pbf',
    'sources': {'street': {'type': 'vector', 'minzoom': 0, 'maxzoom': 14,
                           'tiles': ['ofm://fixture.example/14mock/{z}/{x}/{y}.pbf']}},
    'layers': [{'id': 'background', 'type': 'background', 'paint': {'background-color': '#eeece6'}},
        # The fixture tiles hold buildings only: these stand in for the basemap's street lines.
        {'id': 'tunnel_minor', 'type': 'line', 'source': 'street', 'source-layer': 'transportation', 'paint': {'line-opacity': 0.5}},
        {'id': 'road_minor', 'type': 'line', 'source': 'street', 'source-layer': 'transportation', 'paint': {'line-opacity': 0.9}},
        {'id': 'road_major_rail', 'type': 'line', 'source': 'street', 'source-layer': 'transportation'},
        {'id': 'city', 'type': 'fill', 'source': 'street', 'source-layer': 'building', 'paint': {'fill-color': 'hsl(40,20%,80%)'}},
        {'id': 'blocks', 'type': 'fill-extrusion', 'source': 'street', 'source-layer': 'building', 'filter': ['!', ['has', 'hide_3d']],
         'paint': {'fill-extrusion-height': ['get', 'render_height']}}]}
REPLAY = '''async (o) => {
  const m = qaMap, layer = qaRoads(), s = qaStore.stats, c = layer ? layer.counters : null;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  m.jumpTo({center: o.from, zoom: o.zoom, pitch: 55, bearing: 0});
  for (let i = 0; i < 400 && (qaStore.stats.requests > qaStore.stats.uploads + qaStore.stats.failures || i < 30); i++) await frame();
  const before = {requests: s.requests, uploads: s.uploads};
  const cost = [], real = layer && layer.render;
  let maxDraws = 0, maxTriangles = 0, worstUploads = 0;
  if (layer) layer.render = function (gl, matrix) {
    const u = s.uploads, t = performance.now();
    real.call(layer, gl, matrix);
    cost.push(performance.now() - t);
    maxDraws = Math.max(maxDraws, c.draws); maxTriangles = Math.max(maxTriangles, c.triangles);
    worstUploads = Math.max(worstUploads, s.uploads - u);
  };
  let last = performance.now(), slow = 0, worst = 0; const times = [];
  for (let i = 1; i <= o.frames; i++) {
    m.jumpTo({center: [o.from[0] + i * o.dLng, o.from[1] + i * o.dLat], bearing: i * o.dBearing});
    await frame();
    const now = performance.now(), dt = now - last; last = now;
    times.push(dt); if (dt > 34) slow++; if (dt > worst) worst = dt;
  }
  if (layer) layer.render = real;
  cost.sort((a, b) => a - b); times.sort((a, b) => a - b);
  const at = (list, q) => list.length ? +list[Math.min(list.length - 1, Math.floor(list.length * q))].toFixed(3) : null;
  return {requests: s.requests - before.requests, uploads: s.uploads - before.uploads, mostUploadsInAFrame: worstUploads,
    renderMedianMs: at(cost, 0.5), renderP99Ms: at(cost, 0.99), maxDraws, maxTriangles: Math.round(maxTriangles),
    frameMedianMs: at(times, 0.5), frameP95Ms: at(times, 0.95), worstFrameMs: Math.round(worst), framesOver34ms: slow,
    governor: qaStore.governor.step(), usedMB: +(qaStore.usedBytes() / 1048576).toFixed(2), tiles: qaStore.ready.length};
}'''

def open_page(browser, without_gunzip=False):
    size = {'width': 390, 'height': 844} if args.phone else {'width': 1100, 'height': 760}
    ctx = browser.new_context(viewport=size, device_scale_factor=3 if args.phone else 1, has_touch=args.phone, is_mobile=args.phone)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.on('console', lambda m: errors.append(m.text) if m.type == 'error' and 'api/v1' not in m.text and '503' not in m.text else None)
    if without_gunzip: page.add_init_script('delete window.DecompressionStream;')
    html = (RELEASE if args.standalone else root / 'index.html').read_text(encoding='utf-8')
    html = html.replace('m3 = new maplibregl.Map', 'm3 = window.qaMap = new maplibregl.Map')
    start = '  // ---------- Start ----------'
    assert start in html
    html = html.replace(start, 'window.qaMode=()=>mapMode; window.qaFlat=map; window.qaDay=daylight; window.qaStore=roadStore; window.qaRoads=()=>view3d.roads();\n' + start)
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
    page.evaluate('qaFlat.setView([42.6977,23.3219],17,{animate:false})')
    page.evaluate('document.querySelector(".leaflet-control-3d a").click()')
    page.wait_for_function('window.qaMap && qaMap.getLayer("v3-models")', timeout=30000)
    page.evaluate('document.querySelector("#v3Help button")?.click()')
    page.add_style_tag(content='#map ~ *, .leaflet-control-container, .maplibregl-control-container { visibility: hidden !important; }')
    return ctx, page, errors

def settle(page):
    page.wait_for_function('qaStore.stats.requests <= qaStore.stats.uploads + qaStore.stats.failures', timeout=30000)
    page.wait_for_timeout(1500)

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    ctx, page, errors = open_page(browser)
    assert page.evaluate('!!qaRoads() && !!qaMap.getLayer("v3-roads") && document.querySelector("#v3Roads").checked && !document.querySelector("#v3RoadRow").hidden')
    layers = page.evaluate('qaMap.getLayersOrder()')
    assert layers.index('v3-roads') < layers.index('blocks-material') and layers.index('v3-roads') < layers.index('v3-trk-prev'), layers
    report = {}

    def shoot(name, camera, wait=True):
        page.evaluate('c => qaMap.jumpTo({center:[c[0],c[1]], zoom:c[2], pitch:c[3], bearing:c[4]})', list(camera))
        if wait: page.wait_for_timeout(600); settle(page)
        else: page.wait_for_timeout(2500)
        page.screenshot(path=str(args.shots / (name + '.png')))
        return page.evaluate('''() => ({draws: qaRoads().counters.draws, triangles: Math.round(qaRoads().counters.triangles), covers: qaRoads().covers(),
            minor: qaMap.getPaintProperty("road_minor", "line-opacity"), rail: qaMap.getPaintProperty("road_major_rail", "line-opacity"),
            tunnel: qaMap.getPaintProperty("tunnel_minor", "line-opacity"), tiles: qaStore.ready.length, failures: qaStore.stats.failures, why: qaStore.stats.lastFailure})''')

    # Each camera with the meshes, then with the flat lines.
    for name, *camera in CAMERAS:
        on = shoot(name + '-on', camera)
        report[name] = on
        if not args.standalone or name in ('serdika', 'tram-junction', 'close'):
            assert on['draws'] >= 1 and on['triangles'] > 500 and on['draws'] <= 16 and on['triangles'] <= 150000, (name, on)
            assert on['covers'] and on['minor'] == 0 and on['rail'] == 0 and on['tunnel'] == 0.5, (name, on)
    print('step:', 'Close detail without', flush=True)
    # Close detail without the buildings in the way: rails, sleepers, kerbs, lane lines and crossings.
    page.evaluate('document.querySelector("#v3Buildings").click()')
    for name, *camera in DETAIL: shoot(name, camera)
    page.evaluate('document.querySelector("#v3Buildings").click()')
    page.evaluate('document.querySelector("#v3Roads").click()')
    off = shoot('serdika-off', CAMERAS[0][1:], wait=False)
    assert off['minor'] == 0.9 and off['rail'] in (None, 1) and not off['covers'], off
    assert page.evaluate('localStorage.getItem("sofia_3d_roads")') == '0'
    page.evaluate('document.querySelector("#v3Roads").click()')
    assert page.evaluate('localStorage.getItem("sofia_3d_roads")') == '1'

    print('step:', 'Below the zoom gate', flush=True)
    # Below the zoom gate the layer sleeps and the flat lines return.
    far = shoot('below-zoom-gate', ('', 23.3219, 42.6977, 14.2, 55, 20)[1:], wait=False)
    assert far['minor'] == 0.9 and not far['covers'], far
    # Night: the meshes take the basemap's night grade.
    page.evaluate('qaDay.setEnabled(true); qaDay.preview(23 * 60)')
    shoot('serdika-night', CAMERAS[0][1:])
    page.evaluate('qaDay.preview(null); qaDay.setEnabled(false)')

    print('step:', 'What a frame costs', flush=True)
    # What a frame costs: a slow drift like vehicle follow, then a drag of about 240 m.
    cdp = ctx.new_cdp_session(page)
    cdp.send('Emulation.setCPUThrottlingRate', {'rate': args.throttle})
    page.evaluate('qaStore.governor.enable(false)')   # SwiftShader frame times would step the detail down
    follow = {'frames': 240, 'from': [23.3219, 42.6977], 'zoom': 16.3, 'dLng': 4e-7, 'dLat': 2e-7, 'dBearing': 0}
    drag = {'frames': 240, 'from': [23.3219, 42.6977], 'zoom': 16.3, 'dLng': 1.2e-5, 'dLat': 4e-6, 'dBearing': 0.1}
    runs = {}
    for label, shown in (('on', True), ('off', False)):
        if page.evaluate('document.querySelector("#v3Roads").checked') != shown: page.evaluate('document.querySelector("#v3Roads").click()')
        page.wait_for_timeout(500)
        runs[label] = {'follow': page.evaluate(REPLAY, follow), 'drag': page.evaluate(REPLAY, drag)}
        print(label, runs[label], flush=True)
    cdp.send('Emulation.setCPUThrottlingRate', {'rate': 1})
    page.evaluate('document.querySelector("#v3Roads").click()')
    report['replays'] = runs
    f, d = runs['on']['follow'], runs['on']['drag']
    assert f['uploads'] == 0 and f['requests'] == 0, f
    assert d['mostUploadsInAFrame'] <= 1, d
    for run in (f, d):
        assert run['maxDraws'] <= 16 and run['maxTriangles'] <= 150000, run
        # Chrome's clock steps by 0.1 ms. The slowest 1 % of frames under throttling include pauses that
        # are not the layer's own work (measured 1.6 to 2.5 ms against a 1 ms target), so only a loose bound is asserted.
        assert run['renderMedianMs'] <= 0.3 and run['renderP99Ms'] <= 4, run
    for replay in ('follow', 'drag'):
        # SwiftShader frame times are noisy: this only catches a gross regression. The real check is a phone.
        assert runs['on'][replay]['framesOver34ms'] <= runs['off'][replay]['framesOver34ms'] + 8, runs
    print('step:', 'A long pan stays', flush=True)
    # A long pan stays inside the memory budget.
    page.evaluate('qaStore.budget(3 * 1048576)')
    long_pan = page.evaluate(REPLAY, {'frames': 300, 'from': [23.30, 42.69], 'zoom': 16.3, 'dLng': 1.6e-4, 'dLat': 2e-5, 'dBearing': 0})
    report['long pan, 3 MB budget'] = long_pan
    assert long_pan['usedMB'] <= 3.0 + 0.6 and page.evaluate('qaStore.stats.evictions') > 0, long_pan   # the tiles in view may exceed a tiny budget

    print('step:', 'The switch survives', flush=True)
    # The switch survives a reload.
    page.evaluate('document.querySelector("#v3Roads").click()')
    page.reload(wait_until='domcontentloaded')
    page.wait_for_function('window.qaMode && qaMode() === "vector map"', timeout=30000)
    assert page.evaluate('document.getElementById("v3Roads").checked') is False
    page.evaluate('localStorage.removeItem("sofia_3d_roads")')
    assert not errors, errors
    ctx.close()

    print('step:', 'Without DecompressionStream', flush=True)
    # Without DecompressionStream there is no switch and no layer: the flat lines stay.
    ctx, page, errors = open_page(browser, without_gunzip=True)
    plain = page.evaluate('({layer: !!qaMap.getLayer("v3-roads"), row: document.querySelector("#v3RoadRow").hidden, minor: qaMap.getPaintProperty("road_minor", "line-opacity")})')
    assert plain == {'layer': False, 'row': True, 'minor': 0.9}, plain
    assert not errors, errors
    report['without DecompressionStream'] = plain
    ctx.close()
    browser.close()
server.shutdown()
(args.shots / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))

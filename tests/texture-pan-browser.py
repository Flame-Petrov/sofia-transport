"""Pan the textured 3D view in Chrome and count building queries, uploads and slow frames.

Usage: python tests/texture-pan-browser.py [--baseline REV] [--shots DIR]
"""
import argparse, subprocess, threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline', help='Git revision containing the previous index.html')
parser.add_argument('--shots', help='Directory for a screenshot of each build after the pan')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(root), **k)
    def log_message(self, *a): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
style = {'version': 8, 'glyphs': 'ofm://fixture.example/fonts/{fontstack}/{range}.pbf',
    'sources': {'street': {'type': 'vector', 'minzoom': 0, 'maxzoom': 14,
                           'tiles': ['ofm://fixture.example/14mock/{z}/{x}/{y}.pbf']}},
    'layers': [{'id': 'background', 'type': 'background', 'paint': {'background-color': '#eef0f1'}},
        {'id': 'city', 'type': 'fill', 'source': 'street', 'source-layer': 'building'},
        {'id': 'blocks', 'type': 'fill-extrusion', 'source': 'street', 'source-layer': 'building',
         'paint': {'fill-extrusion-height': ['get', 'render_height']}}]}
PAN = '''async (opts) => {
  const m = qaMap, q = window.qa;
  const frame = () => new Promise(r => requestAnimationFrame(r));
  m.jumpTo({center:[23.322,42.698], zoom:16.3, pitch:55, bearing: 0});
  await new Promise(r => setTimeout(r, 2500));
  q.calls = 0; q.ms = 0; q.bytes = 0; q.uploads = 0;
  let worst = 0, last = performance.now(), slow = 0;
  for (let i = 1; i <= opts.frames; i++) {
    m.jumpTo({center:[23.322 + i*opts.dLng, 42.698 + i*opts.dLat], bearing: i*opts.dBearing});
    await frame();
    const now = performance.now(), dt = now - last; last = now;
    if (dt > worst) worst = dt;
    if (dt > 34) slow++;
  }
  return {queries: q.calls, queryMs: Math.round(q.ms), uploads: q.uploads, uploadMB: +(q.bytes/1048576).toFixed(1),
          worstFrameMs: Math.round(worst), framesOver34ms: slow};
}'''
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    for mode in ((['before'] if args.baseline else []) + ['after', 'standalone']):
        ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
        page = ctx.new_page()
        errors = []
        page.on('pageerror', lambda e: errors.append(str(e)))
        if mode == 'before':
            html = subprocess.check_output(['git', '-C', str(root), 'show', args.baseline + ':index.html']).decode()
        else:
            html = (root / ('index.html' if mode == 'after' else '../102_public-transport.html')).read_text(encoding='utf-8')
        html = html.replace('m3 = new maplibregl.Map', 'm3 = window.qaMap = new maplibregl.Map')
        n = html.count('gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);')
        sync = 'gl.bufferSubData(gl.ARRAY_BUFFER, at * 4, data);'
        html = html.replace('gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);',
            'window.qa.bytes+=data.byteLength; window.qa.uploads++; gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);')
        # Walls and houses now write only the changed buildings into a shared kind of buffer.
        if sync in html:
            n = 2
            html = html.replace(sync, 'window.qa.bytes+=data.byteLength; window.qa.uploads++; ' + sync)
        start = '  // ---------- Start ----------'
        html = html.replace(start, 'window.qa={calls:0,ms:0,bytes:0,uploads:0}; window.qaMode=()=>mapMode; window.qaFlat=map;\n' + start)
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
        page.evaluate('''() => { document.querySelector("#v3Help button")?.click();
            document.querySelector("#v3Textures").click(); document.querySelector("#v3HouseDesigns").click();
            const real = qaMap.queryRenderedFeatures.bind(qaMap);
            qaMap.queryRenderedFeatures = (...a) => { const t = performance.now(); const r = real(...a);
              qa.ms += performance.now() - t; qa.calls++; return r; }; }''')
        page.wait_for_timeout(2500)
        # A slow drift like vehicle follow, then a faster drag with a turn.
        follow = page.evaluate(PAN, {'frames': 240, 'dLng': 4e-7, 'dLat': 2e-7, 'dBearing': 0})
        drag = page.evaluate(PAN, {'frames': 240, 'dLng': 1.2e-5, 'dLat': 4e-6, 'dBearing': 0.1})
        page.wait_for_timeout(1500)
        page.evaluate('document.getElementById("reloadT").parentElement.parentElement.style.display="none"'); page.wait_for_timeout(300)
        if args.shots: page.screenshot(path=str(Path(args.shots) / ('textures-pan-' + mode + '.png')))
        assert n == 2 and not errors, (n, errors)
        if mode != 'before': assert follow['queries'] == 0 and follow['uploads'] == 0, follow
        print(mode, '\n  follow drift', follow, '\n  drag + turn ', drag, '\n  errors', errors, flush=True)
        ctx.close()
    browser.close()
server.shutdown()

"""The 3D button must survive the phone putting the page in the background.

Leaving the app (another app opens, the screen locks) can make the browser drop the 3D map's WebGL context or discard
the whole tab. Neither means the phone ran out of memory in 3D, so neither may hide the 3D button for a day. A context
loss or a page death while the 3D view is on screen still does.

Usage: python tests/view3d-background-browser.py OUTPUT_DIR [--standalone]
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
args = parser.parse_args()
args.shots.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]
RELEASE = max(root.parent.glob('*_public-transport.html'), key=lambda p: int(p.name.split('_')[0]))
ANDROID = ('Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) '
           'Chrome/130.0.0.0 Mobile Safari/537.36')

class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(root), **k)
    def log_message(self, *a): pass
ThreadingHTTPServer.request_queue_size = 64
server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
style = {'version': 8, 'glyphs': 'ofm://fixture.example/fonts/{fontstack}/{range}.pbf',
    'sources': {'street': {'type': 'vector', 'minzoom': 0, 'maxzoom': 14,
                           'tiles': ['ofm://fixture.example/14mock/{z}/{x}/{y}.pbf']}},
    'layers': [{'id': 'background', 'type': 'background', 'paint': {'background-color': '#e9ebe6'}},
        {'id': 'city', 'type': 'fill', 'source': 'street', 'source-layer': 'building', 'paint': {'fill-color': 'hsl(40,20%,80%)'}},
        {'id': 'blocks', 'type': 'fill-extrusion', 'source': 'street', 'source-layer': 'building', 'filter': ['!', ['has', 'hide_3d']],
         'paint': {'fill-extrusion-height': ['get', 'render_height']}}]}
html = (RELEASE if args.standalone else root / 'index.html').read_text(encoding='utf-8')
html = html.replace('m3 = new maplibregl.Map', 'm3 = window.qaMap = new maplibregl.Map')
start = '  // ---------- Start ----------'
html = html.replace(start, 'window.qaMode=()=>mapMode; window.qaFlat=map; window.qa3d=view3d;\n' + start)
# document.hidden can't be set in headless Chrome: the page reads it through these, which the test flips
html = html.replace('<head>', '<head><script>(function(){var h=false;window.qaHide=function(x){h=x;document.dispatchEvent(new Event("visibilitychange"));};'
    'Object.defineProperty(document,"hidden",{get:function(){return h;}});'
    'Object.defineProperty(document,"visibilityState",{get:function(){return h?"hidden":"visible";}});})();</script>', 1)

results, errors = {}, []
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=3, has_touch=True, is_mobile=True, user_agent=ANDROID)
    ctx.route(base + '/', lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8'))
    ctx.route('https://tiles.openfreemap.org/styles/liberty', lambda r: r.fulfill(json=style))
    def tile(r):
        u = urlsplit(r.request.url).path.split('/')
        f = root / 'tiles/buildings/14' / '/'.join(u[-2:])
        r.fulfill(body=f.read_bytes() if len(u) > 3 and u[-3] == '14' and f.is_file() else b'', content_type='application/octet-stream')
    ctx.route('https://fixture.example/**', tile)
    ctx.route('**/api/v1/**', lambda r: r.fulfill(status=503, body='fixture'))

    def load():
        page = ctx.new_page()
        page.set_default_timeout(30000)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(base + '/', wait_until='domcontentloaded', timeout=65000)
        page.wait_for_function('window.qaMode && qaMode() === "vector map"', timeout=30000)
        page.wait_for_function('''() => { const l = document.getElementById("loader"); if (!l || l.hidden) return true;
            const s = getComputedStyle(l); return s.display === "none" || s.pointerEvents === "none" || +s.opacity === 0; }''', timeout=30000)
        page.wait_for_timeout(800)
        return page
    def button(page):
        return page.evaluate('''() => { const b = document.querySelector(".leaflet-control-3d");
            return { shown: !!b && !b.closest("[hidden]") && getComputedStyle(b).display !== "none", on: qa3d.on,
                     memo: localStorage.getItem("sofia_3d_memo"), open: localStorage.getItem("sofia_3d_open") }; }''')
    def open3d(page):
        page.evaluate('qaFlat.setView([42.698,23.322],17,{animate:false})')
        page.evaluate('document.querySelector(".leaflet-control-3d a").click()')
        page.wait_for_function('window.qaMap && qaMap.getLayer("v3-models")', timeout=30000)
        page.evaluate('document.querySelector("#v3Help button")?.click()')
        page.wait_for_timeout(1500)
    def lose(page):   # what Chrome does to a background tab's WebGL when the phone needs the GPU memory
        page.evaluate('qaMap.getCanvas().getContext("webgl2").getExtension("WEBGL_lose_context").loseContext()')
        page.wait_for_timeout(500)
    def crash(page):  # a tab killed without pagehide: Android discarding it, or iOS's memory kill
        page.wait_for_timeout(500)   # let localStorage reach the browser process
        try: page.goto('chrome://crash', timeout=5000)
        except Exception: pass
        try: page.close()
        except Exception: pass
    def shot(page, name):   # the feed is blocked here, so its "out of date" dialog is hidden for the picture
        page.add_style_tag(content='#reloadDlg, #v3Help { display: none !important; }')
        page.screenshot(path=str(args.shots / (name + '.png')))
    def fresh():
        p = load()
        p.evaluate('localStorage.removeItem("sofia_3d_memo"); localStorage.removeItem("sofia_3d_open")')
        open3d(p)
        return p

    # 1. context lost while in the background: the button stays, and 3D comes back with the page
    p = fresh(); shot(p, '01-3d-open')
    p.evaluate('qaHide(true)'); lose(p)
    hidden = button(p)
    p.evaluate('qaHide(false)'); p.wait_for_timeout(4000)
    back = button(p); shot(p, '02-after-background-context-loss')
    results['background context loss'] = {'while hidden': hidden, 'after return': back}
    p.close()
    print('1 done', flush=True)

    # 2. tab discarded in the background, then the app is opened again: the button is there
    p = fresh(); p.evaluate('qaHide(true)'); crash(p)
    q = load(); shot(q, '03-after-background-discard')
    results['background discard'] = button(q); q.close()
    print('2 done', flush=True)

    # 3. still guarded: context lost on screen
    p = fresh(); lose(p); shot(p, '04-after-onscreen-context-loss')
    results['onscreen context loss'] = button(p); p.close()
    print('3 done', flush=True)

    # 4. still guarded: page killed on screen in 3D
    p = fresh(); crash(p)
    q = load(); shot(q, '05-after-onscreen-kill')
    results['onscreen kill'] = button(q)
    browser.close()
server.shutdown()

for k, v in results.items(): print(k, v, flush=True)
bg = results['background context loss']
ok = {'background context loss: button kept': bg['while hidden']['memo'] is None and bg['after return']['shown'],
      'background context loss: 3D back on return': bg['after return']['on'],
      'background discard: button kept': results['background discard']['shown'] and results['background discard']['memo'] is None,
      'onscreen context loss: button hidden': not results['onscreen context loss']['shown'] and results['onscreen context loss']['memo'] is not None,
      'onscreen kill: button hidden': not results['onscreen kill']['shown'] and results['onscreen kill']['memo'] is not None}
for k, v in ok.items(): print(('PASS ' if v else 'FAIL ') + k)
print('page errors:', errors[:5])
assert all(ok.values())

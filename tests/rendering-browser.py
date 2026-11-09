"""Replay settled 3D building uploads in desktop Chrome with a phone viewport."""
import argparse
import subprocess
import threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from urllib.parse import urlsplit

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--baseline', help='Git revision containing the previous index.html')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
class Quiet(SimpleHTTPRequestHandler):
    def __init__(self,*a,**k): super().__init__(*a,directory=str(root),**k)
    def log_message(self,*a): pass
server=ThreadingHTTPServer(('127.0.0.1',0),Quiet)
threading.Thread(target=server.serve_forever,daemon=True).start()
base='http://127.0.0.1:'+str(server.server_port)
style = {
    'version': 8,
    'glyphs': 'ofm://fixture.example/fonts/{fontstack}/{range}.pbf',
    'sources': {'street': {'type': 'vector', 'minzoom': 0, 'maxzoom': 14,
                           'tiles': ['ofm://fixture.example/14mock/{z}/{x}/{y}.pbf']}},
    'layers': [
        {'id': 'background', 'type': 'background', 'paint': {'background-color': '#eef0f1'}},
        {'id': 'city', 'type': 'fill', 'source': 'street', 'source-layer': 'building'},
        {'id': 'blocks', 'type': 'fill-extrusion', 'source': 'street', 'source-layer': 'building',
         'paint': {'fill-extrusion-height': ['get','render_height']}}
    ]
}
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='chrome',headless=True,args=['--enable-unsafe-swiftshader'])
    for mode in ((['before'] if args.baseline else []) + ['after', 'standalone']):
        ctx=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,ignore_https_errors=True)
        page = ctx.new_page()
        errors = []
        requests = []
        page.on('pageerror',lambda e: errors.append(str(e)))
        if mode == 'before':
            html = subprocess.check_output(['git', '-C', str(root), 'show', args.baseline + ':index.html']).decode()
        else:
            artifact = root / ('index.html' if mode == 'after' else '../102_public-transport.html')
            html = artifact.read_text(encoding='utf-8')
        html=html.replace('m3 = new maplibregl.Map','m3 = window.qaMap = new maplibregl.Map')
        html=html.replace('gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);','window.qaHouseBytes+=data.byteLength; gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);')
        start = '  // ---------- Start ----------'
        controls = """
          window.qaHouseBytes = 0;
          window.qaFlat = map;
          window.qaBus = (lat,lon) => {
            upsert({key:"QA", label:"B101", type:3, line:"101", shown:"101", color:"#bb4422",
                    hasLine:true, bearing:45, lat, lon, speed:0, ts:0});
            render(false);
          };
          window.qaFlatFleet = () => {
            map.setView([42.698,23.322], 14, {animate:false});
            const keys = [];
            for (let i = 0; i < 200; i++) {
              const key = 'flat-' + i;
              keys.push(key);
              upsert({key, label:key, type:3, line:'101', shown:'101', color:'#bb4422',
                      hasLine:true, bearing:45, speed:0, ts:0, lat:42.698,
                      lon:23.322 + (i < 10 ? i/10000 : 0.5 + i/10000)});
            }
            render(false);
            const count = keys.filter(key => {
              const v = vehicles[key];
              return dotLayer.hasLayer(v.dot) || (v.pill && pillLayer.hasLayer(v.pill));
            }).length;
            for (const key of keys) {
              const v = vehicles[key];
              dotLayer.removeLayer(v.dot);
              if (v.pill) pillLayer.removeLayer(v.pill);
              if (typeof forgetMotion === 'function') forgetMotion(v);
              delete vehicles[key];
            }
            render(false);
            return count;
          };
          window.qaState = () => ({
            mode: mapMode, active: view3d.on, count: Object.keys(vehicles).length,
            model: !!view3d.drawn?.().some(v => v.k === "QA" && v.model)
          });
        """
        html = html.replace(start, controls + start)
        if mode != 'before':
            hooks = """
              window.qaAddStop = () => {
                const stop = {id: 'qa-stop', name: 'QA stop', lat: 42.698, lon: 23.3229};
                stops[stop.id] = stop;
                indexStop(stop);
                renderStops();
              };
              window.qaStopState = () => ({
                visible: visibleStops.has('qa-stop'),
                created: !!stops['qa-stop']?._mk,
                sheet: sheetStop?.id,
                flat: !!stopMarkers['qa-stop']
              });
              window.qaLocation = () => ({state: loc.state, flat: !!loc.marker});
              window.qaLocate = () => locBox.querySelector('a').click();
              window.qaCloseSheet = closeSheet;
            """
            html = html.replace(start, hooks + start)
        page.route(base+'/', lambda r:r.fulfill(body=html,content_type='text/html; charset=utf-8'))
        page.set_default_timeout(15000)
        page.route('https://tiles.openfreemap.org/styles/liberty',lambda r:r.fulfill(json=style))
        def tile(r):
            u = urlsplit(r.request.url).path.split('/')
            f=root/'tiles/buildings/14' / '/'.join(u[-2:])
            data=f.read_bytes() if len(u)>3 and u[-3]=='14' and f.is_file() else b''
            r.fulfill(body=data,content_type='application/octet-stream')
        page.route('https://fixture.example/**',tile)
        page.route('**/api/v1/**',lambda r:r.fulfill(status=503,body='fixture'))
        page.on('request',lambda r:requests.append(r.url[len(base):]) if r.url.startswith(base+'/models/') or r.url.startswith(base+'/tiles/') else None)
        try:
            page.goto(base+'/',wait_until='domcontentloaded',timeout=65000)
            page.wait_for_function('window.qaState && qaState().mode === "vector map"',timeout=20000)
            assert not requests, requests
            flat_count = page.evaluate('qaFlatFleet()')
            print(mode, 'attached vehicles out of 200:', flat_count, flush=True)
            assert flat_count == (200 if mode == 'before' else 10), flat_count
            page.evaluate('qaFlat.setView([42.698,23.322],17,{animate:false});qaBus(42.698,23.322)')
            page.evaluate('document.querySelector(".leaflet-control-3d a").click()')
            page.wait_for_function('window.qaMap && qaMap.getLayer("v3-models")',timeout=30000)
            page.evaluate('document.querySelector("#v3Help button").click(); document.querySelector("#v3HouseDesigns").click()')
            page.wait_for_timeout(2100)
            page.evaluate('qaMap.jumpTo({center:[23.322,42.698],zoom:16.3,pitch:55});qaBus(42.698,23.322)')
            page.wait_for_function('window.qaHouseBytes > 0 && qaState().model',timeout=30000)
            page.wait_for_timeout(1300)
            # Sub-pixel camera steps keep the same buildings on screen.
            sample=page.evaluate('''async () => {
     const before = qaHouseBytes;
     for (let i = 0; i < 20; i++) {
       qaMap.jumpTo({center:[23.322 + (i % 2) * 1e-8, 42.698]});
       await new Promise(resolve => setTimeout(resolve, 150));
     }
     return {uploaded: qaHouseBytes - before, initial: before, state: qaState()};
   }''')
            assert sample['state']['model'], sample
            if mode != 'before':
                assert sample['uploaded'] == 0, sample
                # Moving far enough to change the visible set must submit fresh geometry.
                page.evaluate('qaMap.jumpTo({center:[23.328,42.698]})')
                page.wait_for_function(f'qaHouseBytes > {sample["initial"]}',timeout=20000)
                page.evaluate('qaMap.jumpTo({center:[23.322,42.698]})')
                page.wait_for_function('qaState().model')
                page.evaluate('qaAddStop()')
                page.wait_for_function("qaStopState().visible && qaMap.getSource('v3-stops')._data.features.length > 0")
                assert not page.evaluate('qaStopState().created')
                page.evaluate("qaMap.fire('click', {point: qaMap.project([23.3229,42.698])})")
                page.wait_for_function("qaStopState().sheet === 'qa-stop'")
                page.evaluate('qaCloseSheet()')
                ctx.grant_permissions(['geolocation'], origin=base)
                ctx.set_geolocation({'latitude': 42.698, 'longitude': 23.322, 'accuracy': 8})
                page.evaluate('qaLocate()')
                page.wait_for_function("qaLocation().state === 'on' && document.querySelector('.v3-mk.me-mk')")
                assert not page.evaluate('qaLocation().flat')
            page.evaluate('document.querySelector(".leaflet-control-3d a").click()')
            page.wait_for_function('!qaState().active',timeout=5000)
            assert page.evaluate('!!document.querySelector(".veh")')
            if mode != 'before':
                page.wait_for_function("qaLocation().flat && qaStopState().flat")
            models = sorted({item for item in requests if item.startswith('/models/')})
            tiles = sum(item.startswith('/tiles/') for item in requests)
            print(mode, sample, 'models', models, 'tile requests', tiles, 'page errors', errors, flush=True)
            assert not errors,errors
            if mode == 'after':
                assert models == ['/models/bus.glb'] and tiles > 0
            if mode=='standalone': assert not requests
        except Exception:
            print('FAILED',mode,errors,page.evaluate('({title:document.title,state:window.qaState?.(),bytes:window.qaHouseBytes,body:document.body.innerText.slice(0,350)})'),flush=True)
            raise
        finally:
            ctx.close()
    browser.close()
server.shutdown()


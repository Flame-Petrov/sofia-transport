"""A stop's card on the 2D map keeps a gap above it (release 109, rebuilt).

On a desktop window of about 840 px the card (55% of the window) opened above a stop placed 62% down the map and
its head went under the browser's toolbar. fitStopCard() now shortens the card list so the card's top stays
STOP_CARD_GAP px below the map's top edge.

Each viewport opens the busiest stops in view, before (fitStopCard switched off) and after, and records the
card's top relative to the map. Live feed, real base map.
Usage: python tests/stop-card-fit-browser.py OUTPUT_DIR   (Python 3.12 venv in old/osm-work, Chrome)
"""
import argparse, json, threading
from pathlib import Path
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('shots', type=Path)
args = parser.parse_args()
args.shots.mkdir(parents=True, exist_ok=True)
root = Path(__file__).resolve().parents[1]
RELEASE = max(root.parent.glob('*_public-transport.html'), key=lambda p: int(p.name.split('_')[0]))

class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(root.parent), **k)
    def log_message(self, *a): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
html = RELEASE.read_text(encoding='utf-8')
start = '  // ---------- Start ----------'
fit = '  function fitStopCard(el) {'
assert start in html and fit in html
html = html.replace(fit, fit + ' if (window.NOFIT) return;')
html = html.replace(start, 'window.qa={map:map};\n' + start)

GAP = 12
report, errors, n = {'release': RELEASE.name, 'runs': []}, [], [0]
def shot(page, name):
    n[0] += 1
    p = args.shots / ('%02d-%s.png' % (n[0], name))
    page.screenshot(path=str(p))
    return p.name

MEASURE = '''() => {
  const box = document.querySelector('.stop-pop.leaflet-popup'); if (!box) return null;
  const m = document.getElementById('map').getBoundingClientRect(), r = box.getBoundingClientRect();
  const sp = box.querySelector('.sp'), body = box.querySelector('.sp-body');
  return { top: Math.round(r.top - m.top), height: Math.round(r.height), cards: box.querySelectorAll('.sp-card').length,
           max: sp.style.maxHeight, scrolls: body ? body.scrollHeight > body.clientHeight + 1 : false,
           name: (box.querySelector('.sp-name') || {}).textContent };
}'''

def run(browser, w, h, nofit):
    tag = '%dx%d-%s' % (w, h, 'before' if nofit else 'after')
    ctx = browser.new_context(viewport={'width': w, 'height': h}, locale='en-GB')
    ctx.route(base + '/', lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8'))
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(tag + ': ' + str(e)))
    page.goto(base + '/')
    page.wait_for_function('window.qa && document.querySelectorAll(".leaflet-marker-icon").length > 20', timeout=90000)
    page.wait_for_timeout(3000)
    if nofit: page.evaluate('window.NOFIT = true')
    # Cherni vrah at Lyubotran (the rider's screenshot), then NDK: stops with many lines
    out = {'viewport': [w, h], 'fit': not nofit, 'cards': []}
    for lat, lon in ((42.6858, 23.3190),):   # NDK: a stop with many lines
        page.evaluate('qa.map.closePopup(); qa.map.setView([%f, %f], 17, {animate: false})' % (lat, lon))
        page.wait_for_timeout(2500)
        # open each stop in the middle of the map, keep the tallest card
        view = 'qa.map.closePopup(); qa.map.setView([%f, %f], 17, {animate: false})' % (lat, lon)
        names = page.evaluate('''() => { const m = document.getElementById('map').getBoundingClientRect();
            return [...new Set([...document.querySelectorAll('.stop-mk')].filter(e => { const r = e.getBoundingClientRect();
              return r.top > m.top + 150 && r.bottom < m.bottom - 150 && r.left > m.left + 250 && r.right < m.right - 250; })
              .map(e => e.title))].slice(0, 3); }''')
        def open_stop(name):
            page.evaluate(view); page.wait_for_timeout(900)
            xy = page.evaluate('''(t) => { const m = document.getElementById('map').getBoundingClientRect();
                const e = [...document.querySelectorAll('.stop-mk')].find(e => { const r = e.getBoundingClientRect();
                  return e.title === t && r.top > m.top + 100 && r.bottom < m.bottom - 100; });
                if (!e) return null; const r = e.querySelector('.stop-ic').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; }''', name)
            if not xy: return None
            page.mouse.click(xy[0], xy[1]); page.wait_for_timeout(1800)
            return page.evaluate(MEASURE)
        best = None
        for name in names:
            meas = open_stop(name)
            if meas and (best is None or meas['cards'] > best['cards']): best = dict(meas, title=name)
        if best is None: continue
        meas = open_stop(best['title'])
        if not meas: continue
        meas['shot'] = shot(page, '%s-%s' % (tag, (meas['name'] or 'stop').replace(' ', '_')[:24]))
        meas['ok'] = meas['top'] >= GAP - 1
        # the card keeps its gap after the map is dragged up by 150 px
        page.mouse.move(w - 150, h / 2); page.mouse.down(); page.mouse.move(w - 150, h / 2 - 150, steps=8); page.mouse.up()
        page.wait_for_timeout(1200)
        drag = page.evaluate(MEASURE)
        if drag:
            drag['shot'] = shot(page, '%s-dragged' % tag)
            drag['ok'] = drag['top'] >= GAP - 1
            meas['after_drag'] = drag
        out['cards'].append(meas)
    report['runs'].append(out)
    ctx.close()

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])
    for w, h in ((870, 840), (1280, 700)):
        for nofit in (True, False):
            run(browser, w, h, nofit)
    browser.close()

report['errors'] = errors
after = [c for r in report['runs'] if r['fit'] for c in r['cards']]
report['pass'] = bool(after) and all(c['ok'] and c.get('after_drag', {'ok': True})['ok'] for c in after) and not errors
(args.shots / 'report.json').write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding='utf-8')
print(json.dumps(report, indent=1, ensure_ascii=False))

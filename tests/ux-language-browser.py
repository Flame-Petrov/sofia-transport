"""Release 109 (UX review + language switch), on the live feed and the real base map.

Checks, with a screenshot of each step:
  language   the phone's language decides (bg → Bulgarian, en / de → English); the menu switch changes it and is kept
  menu       language row, 3D settings closed by default, the Off / Simple / Detailed buildings choice, Report a problem
  search     typing a line shows the results list; a row tracks that vehicle and hides the list
  status     short status line, the tap-open last update line, red with the age when the feed fails
  map        no + / − on touch, credits behind (i), vehicle shapes, clusters zoomed out, stop signs zoomed in
  3D guide   shown the first time only, the touch hint on phones, Escape closes it
  sizes      menu, clear, filter and chip targets ≥ 44 px on a 390 px phone
Usage: python tests/ux-language-browser.py OUTPUT_DIR   (Python 3.12 venv in old/osm-work, Chrome)
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
ANDROID = ('Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) '
           'Chrome/130.0.0.0 Mobile Safari/537.36')

class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(root.parent), **k)
    def log_message(self, *a): pass
server = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=server.serve_forever, daemon=True).start()
base = 'http://127.0.0.1:' + str(server.server_port)
html = RELEASE.read_text(encoding='utf-8')
start = '  // ---------- Start ----------'
assert start in html
html = html.replace(start, 'window.qa={map:map,vehicles:vehicles,view3d:view3d,mode:function(){return mapMode;},sel:function(){return selected;},LANG:LANG};\n' + start)

report, errors, n = {'release': RELEASE.name}, [], [0]
def shot(page, name):
    n[0] += 1
    p = args.shots / ('%02d-%s.png' % (n[0], name))
    page.screenshot(path=str(p))
    return p.name

def context(browser, locale, phone=True):
    kw = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, has_touch=True, is_mobile=True, user_agent=ANDROID) if phone \
        else dict(viewport={'width': 1280, 'height': 800})
    ctx = browser.new_context(locale=locale, **kw)
    ctx.route(base + '/', lambda r: r.fulfill(body=html, content_type='text/html; charset=utf-8'))
    return ctx

def open_page(ctx, tag):
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append(tag + ': ' + str(e)))
    page.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and errors.append(tag + ' console: ' + m.text))
    page.on('response', lambda r: r.status >= 400 and errors.append(tag + ' HTTP %d %s' % (r.status, r.url[:140])))
    page.goto(base + '/')
    page.wait_for_function('window.qa && Object.keys(qa.vehicles).length > 50', timeout=90000)
    page.wait_for_function('(() => { const l = document.getElementById("loader"); if (!l) return true; const s = getComputedStyle(l); '
                           'return l.hidden || s.display === "none" || s.pointerEvents === "none" || s.opacity === "0"; })()', timeout=60000)
    page.wait_for_timeout(2500)
    return page

def menu_open(page):
    if page.get_attribute('#fold', 'aria-expanded') != 'true':
        page.click('#fold'); page.wait_for_timeout(500)

def texts(page):
    return page.evaluate('''() => ({ lang: document.documentElement.lang, title: document.title,
        placeholder: document.getElementById('q').placeholder, status: document.getElementById('statusTxt').textContent,
        types: [...document.querySelectorAll('#types button')].map(b => b.textContent.trim()),
        city: document.querySelector('.cc-name').textContent })''')

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True, args=['--enable-unsafe-swiftshader'])

    # ---- 1. Bulgarian phone ----
    ctx = context(browser, 'bg-BG')
    page = open_page(ctx, 'bg')
    r = report['bg_phone'] = {'texts': texts(page), 'mode': page.evaluate('qa.mode()')}
    r['home'] = shot(page, 'bg-phone-home')
    menu_open(page)
    r['menu'] = shot(page, 'bg-phone-menu')
    page.locator('#v3Btn').scroll_into_view_if_needed()
    r['v3_closed_default'] = page.get_attribute('#v3Btn', 'aria-expanded') == 'false'
    page.click('#v3Btn'); page.wait_for_timeout(500)
    page.locator('#v3BuildLevel').scroll_into_view_if_needed()
    r['menu_3d'] = shot(page, 'bg-phone-3d-settings')
    level = lambda: page.evaluate('''() => ({ checked: [...document.querySelectorAll('#v3BuildLevel button')].filter(b => b.getAttribute('aria-checked') === 'true').map(b => b.dataset.level),
        b: v3Buildings.checked, tx: v3Textures.checked, h: v3HouseDesigns.checked, hint: v3BuildHint.textContent })''')
    r['level_start'] = level()
    page.click('#v3BuildLevel [data-level="detailed"]'); r['level_detailed'] = level()
    page.click('#v3BuildLevel [data-level="off"]'); r['level_off'] = level()
    page.click('#v3BuildLevel [data-level="simple"]'); r['level_simple'] = level()
    page.click('#v3BuildLevel [data-level="detailed"]')
    page.locator('#diagBtn').scroll_into_view_if_needed()
    r['report_row'] = {'label': page.text_content('#diagBtn .dg-lbl'), 'badge': page.text_content('#diagCount')}
    r['menu_bottom'] = shot(page, 'bg-phone-menu-bottom')
    # the vehicle card and a stop card in Bulgarian
    page.click('#fold'); page.wait_for_timeout(400)
    page.fill('#q', '94'); page.wait_for_timeout(1500)
    r['search_rows'] = page.evaluate('[...document.querySelectorAll("#results .rs-row")].slice(0, 2).map(x => x.textContent.replace(/\\s+/g, " ").trim())')
    r['search_shot'] = shot(page, 'bg-phone-search-94')
    if r['search_rows']:
        page.click('#results .rs-row >> nth=0'); page.wait_for_timeout(4500)
        r['card_text'] = page.evaluate('(document.querySelector(".leaflet-popup-content, #sheet:not([hidden])") || {}).innerText || ""')[:300]
        r['card_shot'] = shot(page, 'bg-phone-vehicle-card')
        page.evaluate('qa.sel() && document.getElementById("stopTrack").click()'); page.wait_for_timeout(400)
    page.fill('#q', ''); page.wait_for_timeout(600)
    menu_open(page)
    # switch to English from the menu
    page.locator('#langSeg').scroll_into_view_if_needed()
    with page.expect_navigation():
        page.click('#langSeg [data-lang="en"]')
    page.wait_for_function('window.qa && Object.keys(qa.vehicles).length > 50', timeout=90000)
    page.wait_for_timeout(1500)
    r['after_switch'] = texts(page)
    r['after_switch']['saved'] = page.evaluate('localStorage.getItem("sofia_lang")')
    r['level_after_reload'] = level()
    r['switched'] = shot(page, 'bg-phone-switched-to-english')
    ctx.close()

    # ---- 2. English phone (and German → English) ----
    ctx = context(browser, 'de-DE')
    page = open_page(ctx, 'de')
    report['de_phone'] = {'texts': texts(page)}
    ctx.close()

    ctx = context(browser, 'en-US')
    page = open_page(ctx, 'en')
    r = report['en_phone'] = {'texts': texts(page)}
    r['home'] = shot(page, 'en-phone-home')
    r['controls'] = page.evaluate('''() => ({ zoomShown: !!document.querySelector('.leaflet-control-zoom') && getComputedStyle(document.querySelector('.leaflet-control-zoom')).display !== 'none',
        creditsShown: getComputedStyle(document.querySelector('.leaflet-control-attribution')).display !== 'none',
        creditsBtn: !!document.querySelector('.leaflet-control-credits button'),
        icon: !!document.querySelector('link[rel="icon"]'), touchIcon: !!document.querySelector('link[rel="apple-touch-icon"]') })''')
    # touch target sizes on screen (CSS px after the --ui zoom)
    menu_open(page)
    r['sizes'] = page.evaluate('''() => { const s = el => { const b = el.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; };
        return { fold: s(fold), types: [...document.querySelectorAll('#types button')].map(s), langBtn: s(document.querySelector('#langSeg button')),
                 credits: s(document.querySelector('.leaflet-control-credits button')) }; }''')
    page.click('#fold'); page.wait_for_timeout(400)
    page.click('.leaflet-control-credits button'); page.wait_for_timeout(400)
    r['credits_open'] = shot(page, 'en-phone-credits-open')
    page.click('.leaflet-control-credits button'); page.wait_for_timeout(300)
    # the status card's detail line
    page.click('#cityCard'); page.wait_for_timeout(300)
    r['status_more'] = page.text_content('#statusMore')
    r['status_open'] = shot(page, 'en-phone-status-detail')
    page.click('#cityCard')
    # search 94
    page.fill('#q', '94'); page.wait_for_timeout(1500)
    r['search'] = page.evaluate('''() => ({ clear: (b => [Math.round(b.width), Math.round(b.height)])(qClear.getBoundingClientRect()),
        chips: [...document.querySelectorAll('.chip')].map(c => c.textContent.replace(/\\s+/g, ' ').trim()),
        chipH: Math.round((document.querySelector('.chip') || document.body).getBoundingClientRect().height),
        rows: [...document.querySelectorAll('#results .rs-row')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()),
        head: (document.querySelector('.rs-head') || {}).textContent, status: statusTxt.textContent })''')
    r['search_shot'] = shot(page, 'en-phone-search-94-results')
    if r['search']['rows']:
        page.click('#results .rs-row >> nth=0'); page.wait_for_timeout(4500)
        r['after_row_tap'] = page.evaluate('''() => ({ selected: !!qa.sel(), key: qa.sel() && qa.sel().d.key, listHidden: document.getElementById('results').hidden,
            tracking: !document.getElementById('tracking').hidden, card: !!document.querySelector('.leaflet-popup, #sheet:not([hidden])') })''')
        r['vehicle'] = shot(page, 'en-phone-vehicle-from-results')
    page.fill('#q', ''); page.wait_for_timeout(800)
    page.evaluate('qa.sel() && document.getElementById("stopTrack").click()'); page.wait_for_timeout(500)
    # shapes at city zoom, clusters zoomed out, stop signs zoomed in
    page.evaluate('qa.map.setView([42.6977, 23.3219], 13, {animate:false}); 0'); page.wait_for_timeout(1500)
    r['city'] = shot(page, 'en-phone-city-shapes')
    page.evaluate('qa.map.setView([42.6977, 23.3219], 11, {animate:false}); 0'); page.wait_for_timeout(2000)
    r['clusters'] = page.evaluate('document.querySelectorAll(".vcl").length')
    r['clusters_shot'] = shot(page, 'en-phone-zoomed-out-clusters')
    page.evaluate('qa.map.setView([42.6935, 23.3215], 17, {animate:false}); 0'); page.wait_for_timeout(2500)
    r['stops'] = page.evaluate('document.querySelectorAll(".stop-ic").length')
    r['stops_shot'] = shot(page, 'en-phone-stop-signs')
    page.evaluate('qa.map.setView([42.6977, 23.3219], 13, {animate:false}); 0'); page.wait_for_timeout(800)
    # 3D guide: first time, touch hint, Escape; second time not shown
    if page.evaluate('!document.querySelector(".leaflet-control-3d").hidden'):
        page.click('.leaflet-control-3d a'); page.wait_for_timeout(4000)
        g = r['guide_first'] = page.evaluate('''() => ({ open: v3Help.open, keys: !v3HelpKeys.hidden, touch: !v3HelpTouch.hidden })''')
        r['guide_shot'] = shot(page, 'en-phone-3d-guide-first')
        page.keyboard.press('Escape'); page.wait_for_timeout(400)
        r['guide_after_escape'] = page.evaluate('v3Help.open')
        page.click('.leaflet-control-3d a'); page.wait_for_timeout(2500)
        page.click('.leaflet-control-3d a'); page.wait_for_timeout(4000)
        r['guide_second'] = page.evaluate('v3Help.open')
        r['3d_shot'] = shot(page, 'en-phone-3d-second-open')
        page.click('.leaflet-control-3d a'); page.wait_for_timeout(2000)
    else:
        r['guide_first'] = 'no 3D button (map mode: %s)' % page.evaluate('qa.mode()')
    # feed failure: red with the age
    page.route('**/api/v1/vehicle-positions**', lambda rt: rt.abort())
    page.wait_for_timeout(9000)
    r['feed_down'] = page.evaluate('({ cls: document.getElementById("status").className, txt: statusTxt.textContent })')
    r['feed_down_shot'] = shot(page, 'en-phone-feed-down')
    ctx.close()

    # ---- 3. Desktop, English: menu height ----
    ctx = context(browser, 'en-GB', phone=False)
    page = open_page(ctx, 'desktop')
    menu_open(page)
    r = report['desktop'] = {}
    r['menu'] = page.evaluate('''() => { const c = menuCard.getBoundingClientRect(), s = menuScroll;
        return { cardBottom: Math.round(c.bottom), win: innerHeight, scrollH: s.scrollHeight, clientH: s.clientHeight,
                 zoomShown: getComputedStyle(document.querySelector('.leaflet-control-zoom')).display !== 'none' }; }''')
    r['menu_shot'] = shot(page, 'en-desktop-menu-open')
    page.fill('#q', '94'); page.wait_for_timeout(1500)
    r['search_shot'] = shot(page, 'en-desktop-search-94')
    ctx.close()
    browser.close()

report['errors'] = errors
(args.shots / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding='utf-8')
print(json.dumps(report, ensure_ascii=True, indent=1))

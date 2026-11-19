"""The search results list can be hidden and shown again (2026-11-19).

On the live Sofia feed, desktop (1280 x 800) and an Android phone (390 x 844, touch):
  1. type a line number: the list shows;
  2. tap its "Bus N · K running" chip: the type filter applies, the list stays (arrow up);
  3. tap the chip again: the list hides (arrow down); once more: it shows;
  4. tap the list's X: it hides; the chip shows it again;
  5. tap the map outside the panel: it hides (no vehicle opened);
  6. tap in the search box: it shows; type a character: it shows for the new search.
Screenshots per step. Needs network access to gtfs.sofiatraffic.bg. Run from site/ with the Playwright venv:
  ../old/osm-work/venv/Scripts/python tests/search-results-hide-browser.py [--page 110_public-transport.html]
"""
import argparse
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('--page', default='site/index.html', help='page under the workspace to open')
parser.add_argument('--out', default=None, help='folder for screenshots')
args = parser.parse_args()

site = Path(__file__).resolve().parents[1]
workspace = site.parent
out = Path(args.out) if args.out else workspace / 'debug images' / (time.strftime('%Y-%m-%d') + '-search-results-hide')
out.mkdir(parents=True, exist_ok=True)
ANDROID_UA = ('Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 '
              '(KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36')


class Quiet(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=str(workspace), **k)
    def log_message(self, *a): pass


srv = ThreadingHTTPServer(('127.0.0.1', 0), Quiet)
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = 'http://127.0.0.1:%d/%s' % (srv.server_port, args.page)

passed = failed = 0


def check(name, ok, extra=''):
    global passed, failed
    if ok: passed += 1
    else: failed += 1
    print(('PASS ' if ok else 'FAIL ') + name + (' — ' + extra if extra else ''))


def shown(page):
    return page.evaluate("() => { var r = document.getElementById('results'); return !r.hidden && r.querySelectorAll('.rs-row').length; }")


def run(p, label, phone):
    opts = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=3, is_mobile=True, has_touch=True,
                user_agent=ANDROID_UA) if phone else dict(viewport={'width': 1280, 'height': 800})
    browser = p.chromium.launch(channel='chrome')
    ctx = browser.new_context(**opts)
    page = ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(url)
    page.wait_for_function("() => /Live|На живо/.test(document.getElementById('statusTxt').textContent)", timeout=60000)
    page.wait_for_timeout(1500)
    n = [0]

    def shot(name):
        n[0] += 1
        page.screenshot(path=str(out / ('%s-%02d-%s.png' % (label, n[0], name))))

    def tap(sel_or_xy):
        if isinstance(sel_or_xy, tuple):
            if phone: page.touchscreen.tap(*sel_or_xy)
            else: page.mouse.click(*sel_or_xy)
        else:
            loc = page.locator(sel_or_xy).first
            if phone: loc.tap()
            else: loc.click()
        page.wait_for_timeout(400)

    # a bus line with 2..30 vehicles running: try a few common numbers
    chip = None
    for line in ['94', '76', '88', '280', '72', '204', '9', '11', '10', '20']:
        page.fill('#q', line)
        page.wait_for_timeout(700)
        sel = '#chips .chip[data-line="%s"][data-type="3"]' % line
        if page.locator(sel).count() and page.locator(sel + ' .chip-car').count():
            chip = sel
            break
    check(label + ': found a bus chip with a list', chip is not None)
    if not chip:
        browser.close(); return
    check(label + ': typing shows the list', bool(shown(page)))
    shot('typed')

    tap(chip)
    page.wait_for_timeout(500)
    check(label + ': first chip tap applies the filter, list stays', bool(shown(page)))
    check(label + ': chip marked open', page.get_attribute(chip, 'aria-expanded') == 'true')
    shot('chip-applied')

    tap(chip)
    check(label + ': second chip tap hides the list', not shown(page))
    check(label + ': chip marked closed', page.get_attribute(chip, 'aria-expanded') == 'false')
    shot('chip-hid')

    tap(chip)
    check(label + ': third chip tap shows it again', bool(shown(page)))
    shot('chip-showed')

    tap('#results .rs-close')
    check(label + ': X hides the list', not shown(page))
    shot('x-hid')

    tap(chip)
    check(label + ': chip brings it back after X', bool(shown(page)))

    # the map well away from the panel (right side on desktop, lower part on the phone)
    box = page.locator('#results').bounding_box()
    xy = (1000, 650) if not phone else (300, int(min(800, box['y'] + box['height'] + 60)))
    tap(xy)
    check(label + ': tap outside hides the list', not shown(page))
    check(label + ': no vehicle got tracked by that tap', page.evaluate("() => document.getElementById('tracking').hidden"))
    shot('outside-hid')

    tap('#q')
    check(label + ': tap in the search shows it again', bool(shown(page)))
    shot('search-tap-showed')

    tap(xy)
    check(label + ': hidden again', not shown(page))
    page.locator('#q').press('End')
    page.keyboard.type(' ')
    page.wait_for_timeout(800)
    check(label + ': typing shows it again', bool(shown(page)))
    shot('typing-showed')

    check(label + ': no page errors', not errors, '; '.join(errors[:3]))
    browser.close()


with sync_playwright() as p:
    run(p, 'desktop', False)
    run(p, 'phone', True)

print('%d passed, %d failed; shots in %s' % (passed, failed, out))
raise SystemExit(1 if failed else 0)

"""Render site/src/shared/ui/app-icon.svg to PNGs and write shared/ui/app-icon.html (favicon + home-screen icon, inline)."""
import base64, sys, urllib.parse
from pathlib import Path
from playwright.sync_api import sync_playwright

site = Path(sys.argv[1])
out_dir = Path(sys.argv[2])
svg = (site / 'src/shared/ui/app-icon.svg').read_text(encoding='utf-8').strip()
out_dir.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch(channel='chrome')
    pg = b.new_page(viewport={'width': 180, 'height': 180})
    # iOS rounds the corners itself: a full square for the home-screen icon
    square = svg.replace('rx="14" fill="#1D4E9E"/>', 'fill="#1D4E9E"/>', 1)
    pg.set_content('<html><body style="margin:0">' + square.replace('<svg ', '<svg width="180" height="180" ', 1) + '</body></html>')
    png180 = pg.screenshot(clip={'x': 0, 'y': 0, 'width': 180, 'height': 180})
    (out_dir / 'apple-touch-icon-180.png').write_bytes(png180)
    # a preview sheet: favicon sizes on light and dark tabs, the home-screen icon
    pg.set_viewport_size({'width': 520, 'height': 220})
    data = 'data:image/svg+xml,' + urllib.parse.quote(svg)
    pg.set_content(f'''<html><body style="margin:0;font:13px system-ui;display:flex;gap:24px;padding:20px;background:#fff">
      <div style="display:flex;flex-direction:column;gap:10px;align-items:center"><img src="{data}" width="16"><img src="{data}" width="32"><img src="{data}" width="48"><span>light</span></div>
      <div style="display:flex;flex-direction:column;gap:10px;align-items:center;background:#202124;padding:10px;border-radius:8px;color:#fff"><img src="{data}" width="16"><img src="{data}" width="32"><img src="{data}" width="48"><span>dark</span></div>
      <img src="data:image/png;base64,{base64.b64encode(png180).decode()}" width="180" style="border-radius:40px">
    </body></html>''')
    pg.screenshot(path=str(out_dir / 'icon-preview.png'))
    b.close()

html = ('<!-- release 109: the app icon. Source: shared/ui/app-icon.svg (the PNG for iPhone home screens is rendered from it by\n'
        '     tools/app_icon.py). Inline, so the standalone file and the hosted page both have it. -->\n'
        '<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,' + urllib.parse.quote(svg) + '">\n'
        '<link rel="apple-touch-icon" href="data:image/png;base64,' + base64.b64encode(png180).decode() + '">\n'
        '<meta name="theme-color" content="#1D4E9E">\n')
(site / 'src/shared/ui/app-icon.html').write_text(html, encoding='utf-8')
print('png bytes', len(png180))

// Every text the app asks t() / tp() for has a Bulgarian entry, and the static markup's texts do too.
// (A missing entry would quietly show English in the Bulgarian app.)
const test = require('node:test');
const assert = require('node:assert');
const { readFileSync, readdirSync, statSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { site } = require('./app.cjs');

const src = path.join(site, 'src');
function files(dir, out = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(js|html)$/.test(f) && statSync(p).size < 400000) out.push(p);
  }
  return out;
}
const all = files(src);
// the Bulgarian tables, loaded the way the page loads them
const context = vm.createContext({ navigator: { language: 'bg-BG' }, localStorage: { getItem: () => 'bg', setItem() {} }, document: {}, location: {} });
vm.runInContext(readFileSync(path.join(src, 'shared/ui/i18n.js'), 'utf8'), context);
for (const f of all.filter(f => /strings-bg\.js$/.test(f))) vm.runInContext(readFileSync(f, 'utf8'), context);
const BG = vm.runInContext('BG', context);

// t('…') and tp(n, '…', '…') with plain string literals
function keysIn(code) {
  const keys = [], lit = "'((?:[^'\\\\]|\\\\.)*)'";
  const reT = new RegExp('(?<![\\w.$])t\\(\\s*' + lit, 'g');
  const reP = new RegExp('(?<![\\w.$])tp\\([^,]+,\\s*' + lit + '\\s*,\\s*' + lit, 'g');
  let m;
  while ((m = reT.exec(code))) keys.push(m[1]);
  while ((m = reP.exec(code))) keys.push(m[1], m[2]);
  return keys.map(k => k.replace(/\\u([0-9a-fA-F]{4})/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
}

test('Bulgarian: every t() / tp() text has an entry', () => {
  const missing = [];
  for (const f of all.filter(f => f.endsWith('.js') && !/strings-bg\.js$|i18n\.js$/.test(f))) {
    for (const k of keysIn(readFileSync(f, 'utf8'))) if (!(k in BG)) missing.push(path.relative(src, f) + ': ' + k);
  }
  assert.deepStrictEqual(missing, []);
});

test('Bulgarian: the static markup the rider reads has entries', () => {
  // The rider-facing fragments (Diagnostics' inside stays English, by design)
  const fragments = ['page.html', 'features/view3d/menu.html', 'features/view3d/controls-dialog.html', 'features/offline/menu.html',
    'features/places/menu.html', 'features/vehicles/follow.html', 'features/diagnostics/menu.html'];
  const skip = new Set(['3D', 'i', 'M', 'Ctrl', '←', '→', '↑', '↓', '+', 'Език ·', 'Language', 'БГ', 'EN', 'Copy report',
    'Performance overlay', 'Raw log & vehicle samples', 'Raw diagnostics report']);
  const missing = [];
  for (const rel of fragments) {
    const html = readFileSync(path.join(src, rel), 'utf8').replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|svg)[\s\S]*?<\/\1>/g, '');
    const texts = [];
    html.replace(/>([^<>{}]+)</g, (m, s) => { texts.push(s); return m; });
    html.replace(/\s(?:title|aria-label|placeholder)="([^"]+)"/g, (m, s) => { texts.push(s); return m; });
    for (const raw of texts) {
      const k = raw.replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
      if (!k || skip.has(k) || !/[A-Za-z]{2}/.test(k)) continue;
      if (!(k in BG)) missing.push(rel + ': ' + k);
    }
  }
  assert.deepStrictEqual(missing, []);
});

test('language: the phone decides until the rider picks, English when not Bulgarian', () => {
  const pick = (language, saved) => {
    const c = vm.createContext({ navigator: { language, languages: [language] }, localStorage: { getItem: () => saved, setItem() {} }, document: {}, location: {} });
    vm.runInContext(readFileSync(path.join(src, 'shared/ui/i18n.js'), 'utf8'), c);
    return vm.runInContext('LANG', c);
  };
  assert.strictEqual(pick('bg-BG', null), 'bg');
  assert.strictEqual(pick('bg', null), 'bg');
  assert.strictEqual(pick('en-US', null), 'en');
  assert.strictEqual(pick('de-DE', null), 'en');
  assert.strictEqual(pick('', null), 'en');
  assert.strictEqual(pick('de-DE', 'bg'), 'bg');
  assert.strictEqual(pick('bg-BG', 'en'), 'en');
});

test('language: Cyrillic feed names are written in Latin letters in English', () => {
  const c = vm.createContext({ navigator: { language: 'en' }, localStorage: { getItem: () => null, setItem() {} }, document: {}, location: {} });
  vm.runInContext(readFileSync(path.join(src, 'shared/ui/i18n.js'), 'utf8'), c);
  const tr = s => vm.runInContext('translit(' + JSON.stringify(s) + ')', c);
  assert.strictEqual(tr('ж.к. Младост 1'), 'zh.k. Mladost 1');
  assert.strictEqual(tr('Централна гара'), 'Tsentralna gara');
  assert.strictEqual(tr('Щастливеца'), 'Shtastliveca'.replace('ca', 'tsa'));
  assert.strictEqual(tr('ЖП ГАРА'), 'ZHP GARA');
  assert.strictEqual(tr('X9 Юндола'), 'X9 Yundola');
  assert.strictEqual(vm.runInContext("t('{n} min', { n: 4 })", c), '4 min');
});

test('Bulgarian: the feature tables never give one text two translations', () => {
  const seen = {}, clashes = [];
  for (const f of all.filter(f => /strings-bg\.js$/.test(f))) {
    const c = vm.createContext({ BG: {} });
    vm.runInContext(readFileSync(f, 'utf8'), c);
    for (const [k, v] of Object.entries(c.BG)) {
      if (k in seen && seen[k].v !== v) clashes.push(k + ': ' + seen[k].f + ' / ' + path.relative(src, f));
      else seen[k] = { v, f: path.relative(src, f) };
    }
  }
  assert.deepStrictEqual(clashes, []);
});

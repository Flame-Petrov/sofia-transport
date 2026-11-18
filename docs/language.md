# Language: Bulgarian and English

The app speaks Bulgarian or English. Until the rider picks one, the phone's own language decides: Bulgarian when the browser's first language is Bulgarian (`bg`, `bg-BG`), English for every other language and when the browser does not say. The rider can change it in the menu's **Език · Language** row (БГ / EN). The choice is saved as `sofia_lang` and the page starts again in it, so every text, name and map label changes together.

## What changes with the language

| Part | Bulgarian | English |
|---|---|---|
| Buttons, menus, cards, messages, tooltips | Bulgarian | English (the source text) |
| Stop names and destinations from the feed | As the feed writes them, title-cased | Written in Latin letters with Bulgaria's official transliteration (Streamlined System): „Ж.к. Младост 1“ → "Zh.k. Mladost 1", „Хотел Хилтън“ → "Hotel Hiltan" |
| Place and street names on the vector map | `name:bg`, else the Cyrillic name | `name:en`, else `name:latin`, else `name` |
| Clock times, dates, numbers | `bg-BG` (decimal comma: „1,5 км“) | `en-GB` |
| `<html lang>` and the page title | `bg`, „София на живо — градски транспорт“ | `en`, "Sofia Live Transport" |

The image map (Esri tiles) has its labels baked in and does not change. Saved places keep the names the rider typed. The **Report a problem** report, the performance overlay and other diagnostics stay in English: they are read by whoever fixes the app.

## How it works

- `src/shared/ui/i18n.js` decides `LANG` (`'bg'` or `'en'`) and `LOCALE`, and defines:
  - `t('English text', { name: value })`, which returns the Bulgarian from `BG` when the language is Bulgarian (or the English when there is no entry) and fills in `{name}` placeholders;
  - `tp(n, 'one form', 'many form', vars)` for counts (Bulgarian has the same two forms);
  - `translit(s)` and `feedText(s)` (transliterates in English only);
  - `localizeDom(root)`, which swaps the text nodes and `title` / `aria-label` / `placeholder` attributes of static markup that have a Bulgarian entry;
  - `setLang(lang)`, which saves and reloads.
- The texts are written in English in the source. Each feature keeps its Bulgarian table, keyed by the English text, in a `strings-bg.js` next to its code (`Object.assign(BG, {...})`). `shared/ui/strings-bg.js` holds the page frame and the map controls.
- `src/page.html` includes `i18n.js`, then every `strings-bg.js`, then `shared/ui/i18n-start.js` (sets `<html lang>`, translates the title and the static markup), before `config.js`. So every script can call `t()` while it loads, including `TYPES` in `config.js`.
- Feed names go through `titleCaseBg()` (`features/stops/popup.js`), which calls `feedText()` at the end. A name shown without `titleCaseBg` uses `feedText()` directly.
- Map labels: `restyleMap()` in `shared/map/base-map.js` replaces the text field of every symbol layer that shows Latin and Cyrillic together (`name:nonlatin`). The 3D map starts from the same style.
- The menu row is `features/language/` (`menu.html`, `language.js`, `language.css`). Its label is written in both languages so a rider finds it whichever language the app shows.

### Adding or changing a text

Write the English in the code inside `t()` (or as static markup), and add the same English as a key with its Bulgarian to the feature's `strings-bg.js`. Keep HTML and numbers outside `t()`, use placeholders for values inside a sentence (Bulgarian word order differs), and use `tp()` for counts. A local variable or parameter named `t` hides the translator for the whole function: name it something else.

## Verify

- `node --test tests/i18n.test.cjs` (part of `node --test tests/*.test.cjs`) fails when any `t()` / `tp()` text or rider-facing static text has no Bulgarian entry, when two tables give the same key different Bulgarian, when the phone-language rule changes, or when transliteration changes.
- `tests/ux-language-browser.py OUTPUT_DIR` (Python 3.12 venv in `old/osm-work`, Chrome, live feed) opens the page with a Bulgarian, a German and an English phone: Bulgarian shows Bulgarian, the other two English. It switches from Bulgarian to English in the menu and checks the choice is saved after the reload.
- By hand: in Bulgarian, open a stop, a vehicle card, My places and a route; in English, check that stop names and the map are in Latin letters.

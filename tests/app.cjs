const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const site = path.resolve(__dirname, '..');
const noop = () => {};

function element() {
  return Object.assign(new EventTarget(), {
    value: '', classList: { toggle: noop }, style: {}, focus: noop
  });
}

function app(files, globals = {}) {
  const nodes = new Map();
  const document = Object.assign(new EventTarget(), {
    createElement: () => ({ style: {}, getContext: () => ({ scale: noop, fillText: noop }) }),
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, element());
      return nodes.get(id);
    }
  });
  const pane = () => ({ style: {}, appendChild: noop });
  const context = vm.createContext({
    document, Event, performance, setInterval: noop, clearInterval: noop, requestAnimationFrame: noop,
    setTimeout, clearTimeout, console,
    map: { createPane: pane, getPane: pane, on: noop, getZoom: () => 16,
      getSize: () => ({ x: 800, y: 600 }), containerPointToLayerPoint: noop },
    L: { layerGroup: () => ({ addTo: noop }), svg: noop, divIcon: options => options,
      point: (x, y) => ({ x, y }), DomUtil: { setPosition: noop },
      Canvas: { extend: methods => class { constructor() { Object.assign(this, methods); } } } },
    view3d: { on: false }, ...globals
  });
  // every build has the daylight clock: the 3D layers and the feed read it
  for (const file of ['shared/map/daylight', 'features/view3d/shadows', ...files]) {
    const filename = path.join(site, 'src', file + '.js');
    vm.runInContext(readFileSync(filename, 'utf8'), context, { filename });
  }
  return context;
}

function fixedDate(iso) {
  const now = Date.parse(iso);
  return class extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
}

module.exports = { app, element, fixedDate, noop, site };

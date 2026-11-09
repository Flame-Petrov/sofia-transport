const test = require('node:test');
const assert = require('node:assert/strict');
const { app, element, noop } = require('./app.cjs');

test('search matches exact line, fleet label or plate and respects the type buttons', () => {
  const buttons = [0, 1, 3, 11].map(type => {
    const attributes = { 'data-t': String(type) };
    return Object.assign(element(), {
      getAttribute: key => attributes[key],
      setAttribute: (key, value) => { attributes[key] = value; }
    });
  });
  const input = element(), clear = element();
  const a = app(['features/search/render', 'features/search/controls'], {
    TYPES: { 0: {}, 1: {}, 3: {}, 11: {} }, stopIfFiltered: noop, setTimeout: noop,
    document: {
      querySelectorAll: () => buttons,
      getElementById: id => id === 'q' ? input : clear
    }
  });
  a.render = noop;
  const bus = { type: 3, line: 'X9', label: '3501', plate: 'CA1234' };
  for (const query of ['X9', '7, 3501', ' ca1234 ']) {
    input.value = query;
    assert.equal(a.matches(bus, a.tokens()), true, query);
  }
  input.value = 'X';
  assert.equal(a.matches(bus, a.tokens()), false);
  input.value = 'X9';
  buttons[2].onclick();
  assert.equal(buttons[2].getAttribute('aria-pressed'), 'false');
  assert.equal(a.matches(bus, a.tokens()), false);
  clear.onclick();
  assert.equal(input.value, '');
  assert.equal(clear.hidden, true);
  assert.equal(buttons[2].getAttribute('aria-pressed'), 'true');
  assert.equal(a.matches(bus, a.tokens()), true);
});

function places(storage) {
  function marker(at) {
    return {
      bindPopup: noop, on: noop, addTo: noop, setZIndexOffset: noop, setIcon: noop,
      getElement: () => null,
      getLatLng: () => ({ equals: ([lat, lon]) => lat === at[0] && lon === at[1] })
    };
  }
  return app(['shared/storage/preferences', 'shared/ui/format', 'shared/ui/place-icons',
    'features/places/places'], {
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    L: { marker, divIcon: options => options }, loc: {}, toast: noop
  });
}

test('adding a place persists its coordinates and active destination through reload', () => {
  const storage = new Map();
  const first = places(storage);
  first.savedPlaces.add('Home & garden', { lat: 42.12345678, lng: 23.23456789 });
  const id = first.savedPlaces.destinationId;
  const reload = places(storage);
  assert.ok(id);
  assert.equal(reload.savedPlaces.destinationId, id);
  const pin = reload.savedPlaces.find(id);
  assert.deepEqual([pin.name, pin.lat, pin.lon], ['Home & garden', 42.123457, 23.234568]);
  assert.match(reload.document.getElementById('plList').innerHTML, /Home &amp; garden/);
  reload.savedPlaces.setDestination('');
  const cleared = places(storage).savedPlaces;
  assert.equal(cleared.destinationId, '');
  assert.equal(cleared.find(id).name, pin.name);
});

test('legacy pins keep their default flag and a missing destination is cleared', () => {
  const a = places(new Map([
    ['sofia_places', JSON.stringify([{ id: 'old', name: 'Work', lat: 42.68, lon: 23.31 }, null])],
    ['sofia_dest', 'deleted']
  ]));
  assert.equal(a.savedPlaces.destinationId, '');
  assert.equal(a.savedPlaces.markerSvg(a.savedPlaces.find('old')), a.FLAG_SVG);
  assert.equal(a.document.getElementById('plCount').textContent, '1');
});

test('location button starts a watch, accepts a GPS fix and releases the watch on stop', () => {
  let receive, cleared;
  const a = app(['features/location/location'], {
    window: new EventTarget(), location: {}, locBox: null, route: null, savedPlaces: null,
    navigator: { geolocation: {
      watchPosition(success) { receive = success; return 7; },
      clearWatch(id) { cleared = id; }
    } },
    following: false, clearInterval: noop, setTimeout: noop
  });
  a.L.latLng = (lat, lng) => ({ lat, lng });
  a.centreOnMe = noop;
  a.drawMe = noop;
  a.locButton();
  assert.equal(a.loc.state, 'wait');
  assert.equal(a.loc.follow, true);
  receive({ coords: { latitude: 42.7, longitude: 23.3, accuracy: 6, speed: 3, heading: 85 } });
  assert.equal(a.loc.state, 'on');
  assert.deepEqual(a.loc.fix.ll, { lat: 42.7, lng: 23.3 });
  assert.equal(a.loc.headingSrc, 'gps');
  assert.equal(a.loc.heading, 85);
  a.locButton();
  assert.equal(cleared, 7);
  assert.equal(a.loc.state, 'off');
  assert.equal(a.loc.fix, null);
});

test('walking guidance detects arrival at the saved destination', () => {
  const messages = [];
  const a = app(['features/vehicles/route-line', 'features/journeys/guidance'], {
    store: noop, routeBusy: false, loc: { fix: { ll: { lat: 42.7, lng: 23.3 }, acc: 5 } },
    route: { go: true, phase: 'walk', leg: 0, ways: [{ legs: [{ kind: 'walk', to: -2 }] }] },
    savedPlaces: { find: () => ({ name: 'Home', lat: 42.7001, lon: 23.3 }) },
    meSpeed: () => 1, realize: way => way, legLL: (index, me, p) => [p.lat, p.lon],
    renderRoute: noop, toast: msg => messages.push(msg), setTimeout: noop, navigator: {}
  });
  a.courseTick();
  a.courseTick();
  assert.equal(a.route.phase, 'done');
  assert.deepEqual(messages, ["You've arrived at Home."]);
});

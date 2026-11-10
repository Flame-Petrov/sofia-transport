const test = require('node:test');
const assert = require('node:assert/strict');
const { app, noop } = require('./app.cjs');

test('300 settled vehicles leave the frame loop, then a new fix wakes one vehicle', () => {
  let now = 100000, visits = 0, poses = 0, writes = 0;
  const bounds = { south: 42, north: 43, west: 23, east: 24 };
  const fleet = new Proxy({}, { get(target, key) { visits++; return target[key]; } });
  const a = app(['features/vehicles/motion'], {
    vehicles: fleet, Date: { now: () => now }, selected: null, hoverV: null, zooming: false,
    followFrame: noop, locFrame: noop, routeVeh: {}, updateFlatVehicle: noop, flatMarkerView: () => bounds,
    toRad: d => d*Math.PI/180, distM: () => 0, shapes: null, trips: {}, MOTION_MAX_AHEAD: 300
  });
  a.getMotionBounds = () => a.viewBounds01;
  a.viewBounds01 = { minLat: 42, maxLat: 43, minLon: 23, maxLon: 24 };
  const first = [];
  for (let n = 0; n < 300; n++) {
    const ll = { lat: 42.7, lng: 23.3 };
    const v = fleet[n] = { d: { key: String(n), lat: ll.lat, lon: ll.lng }, filterMatch: true,
      dotInMap: true, dot: { getLatLng: () => ll, setLatLng(p) { writes++; [ll.lat,ll.lng] = p; } } };
    a.planMotion(v, true);
    first.push(v);
  }
  const posAt = a.posAt;
  a.posAt = (...args) => { poses++; return posAt(...args); };
  for (let i = 0; i < 240; i++) { now += 1000/60; a.motionFrame(i*1000/60); }
  assert.deepEqual({ visits, poses, writes }, { visits: 0, poses: 0, writes: 0 });
  const v = first[0];
  v.d.lon += 0.002;
  a.planMotion(v, false);
  now += 5000; a.motionFrame(9100);
  assert.ok(v.pos[1] > 23.3 && v.pos[1] < v.d.lon);
  now += 6000; a.motionFrame(15100);
  assert.equal(v.dot.getLatLng().lng, v.d.lon);
  assert.equal(a.movingVehicles.size, 0);
});

test('culling detaches an offscreen dot, reattaches it at its new pose, and keeps a routed vehicle', () => {
  const a = app(['features/search/render'], { selected: null, routeVeh: {}, keepTop: noop });
  const attached = new Set(), layer = { addLayer: m => attached.add(m), removeLayer: m => attached.delete(m) };
  a.dotLayer = a.pillLayer = layer;
  a.syncMarkerPosition = (m, pos) => { m.pos = pos.slice(); };
  const v = { d: { key: 'bus' }, pos: [42.7,23.3], dot: { isPopupOpen: () => false } };
  a.ensurePill = () => v.pill || (v.pill = { isPopupOpen: () => false });
  const view = { south: 42, north: 43, west: 23, east: 24, labels: false };
  a.updateFlatVehicle(v,view);
  assert.ok(attached.has(v.dot));
  v.pos[0] = 44;
  a.updateFlatVehicle(v,view);
  assert.equal(attached.size,0);
  v.pos = [42.5,23.4];
  a.updateFlatVehicle(v,view);
  assert.deepEqual(v.dot.pos,v.pos);
  a.routeVeh.bus = { tag: 'Board' };
  v.pos[0] = 44;
  a.updateFlatVehicle(v,view);
  assert.ok(attached.has(v.pill));
});

// A flat stand-in for the 3D map: `shift` pans the picture in screen pixels.
function buildingMap(features) {
  const events = {}, shift = { x: 0, y: 0 }, state = { queries: 0, dem: null, zoom: 16 };
  const map = { events, shift, state,
    getCenter: () => Object.assign([0,0], { lng: 0, lat: 0 }), getZoom: () => state.zoom,
    getPitch: () => 0, getBearing: () => 0, getCanvas: () => ({ clientWidth: 390, clientHeight: 844 }),
    project: ([x,y]) => ({ x: 195 + x*1e5 - shift.x, y: 422 - y*1e5 - shift.y }),
    getLayoutProperty: () => 'visible', getLayer: () => ({ minzoom: 14 }),
    on: (name, cb) => { (events[name] ||= []).push(cb); },
    fire: (name, event) => (events[name] || []).forEach(cb => cb(event)),
    getTerrain: () => state.dem, queryTerrainElevation: () => 4,
    queryRenderedFeatures: () => { state.queries++; return features; }, triggerRepaint: noop };
  return map;
}
function buildingGl(uploads) {
  return new Proxy({ getShaderParameter: () => true, getProgramParameter: () => true,
    bufferData: (_, data) => uploads.push(data.byteLength) }, { get: (o,k) => k in o ? o[k] : noop });
}
const buildingOrigin = { x: .012345, y: .023456, unit: 1e-7 };
const buildingLibrary = { MercatorCoordinate: { fromLngLat: ([x,y]) => ({
  x: buildingOrigin.x + x*buildingOrigin.unit, y: buildingOrigin.y + y*buildingOrigin.unit,
  meterInMercatorCoordinateUnits: () => buildingOrigin.unit }) } };
function footprints(count) {
  return Array.from({length:count},(_,i) => ({ id:i+1,
    properties:{render_height:16,render_min_height:0,material:'green'},
    geometry:{type:'Polygon',coordinates:[[[0,0],[32,0],[32,16],[0,16],[0,0]]]} }));
}

test('house batches survive camera movement and refresh after geometry, source or terrain changes', () => {
  const a = app(['features/view3d/building-view','features/view3d/bulgarian-houses'], { maplibregl: buildingLibrary });
  const features = footprints(50), uploads = [], map = buildingMap(features), gl = buildingGl(uploads);
  let ms = 1000;
  a.performance = { now: () => ms };
  const layer = a.bulgarianHouseLayer('material','tiles',false);
  // The query, the wall batch and the house batch each take their own frame.
  const render = () => { for (let i=0;i<3;i++) { layer.render(gl,new Float32Array(16)); ms+=40; } };
  layer.onAdd(map,gl);
  render();
  assert.equal(uploads[0],3779136);
  // A pan inside the padded margin neither queries the map nor uploads.
  for (let i=1;i<=60;i++) { map.shift.x=i*2; map.fire('move'); render(); }
  assert.deepEqual([uploads.length,map.state.queries],[1,1]);
  features.reverse(); ms+=300; map.fire('sourcedata',{sourceId:'tiles'}); render();
  assert.deepEqual([uploads.length,map.state.queries],[1,2]);
  features[0].properties.render_height=7; ms+=300; map.fire('sourcedata',{sourceId:'tiles'}); render();
  assert.equal(uploads.length,2);
  map.state.dem={source:'dem'}; ms+=300; map.fire('terrain'); render();
  ms+=300; map.fire('sourcedata',{sourceId:'dem'}); render();
  assert.equal(uploads.length,4);
  // Leaving the margin asks the map again.
  const before=map.state.queries;
  features.length=0; ms+=300; map.shift.x=400; map.fire('move'); render();
  assert.equal(map.state.queries,before+1);
  assert.equal(uploads.at(-1),0);
});

test('wall and house batches share one building query, and only a pan beyond the margin repeats it', () => {
  const a = app(['features/view3d/building-view','features/view3d/bulgarian-houses','features/view3d/solid-facades'],
    { maplibregl: buildingLibrary });
  const features = footprints(20), wallBytes = [], houseBytes = [], map = buildingMap(features);
  let ms = 1000;
  a.performance = { now: () => ms };
  const walls = a.solidFacadeLayer('material','tiles',true,noop), houses = a.bulgarianHouseLayer('material','tiles',false);
  const wallGl = buildingGl(wallBytes), houseGl = buildingGl(houseBytes);
  const render = () => { for (let i=0;i<3;i++) { walls.render(wallGl,new Float32Array(16)); houses.render(houseGl,new Float32Array(16)); ms+=40; } };
  walls.onAdd(map,wallGl); houses.onAdd(map,houseGl);
  render();
  // Four wall edges per footprint, two triangles each, six floats per corner.
  assert.deepEqual([wallBytes[0],houseBytes.length,map.state.queries],[20*4*36*4,1,1]);
  // 240 frames of follow-style drift, about 160 px in total.
  for (let i=1;i<=240;i++) { map.shift.x=i*150/240; map.shift.y=-i*60/240; map.fire('move'); render(); }
  assert.deepEqual([wallBytes.length,houseBytes.length,map.state.queries],[1,1,1]);
  // Changing the material mode rebuilds the walls from the features already held.
  walls.setClassified(false); ms+=300; render();
  assert.deepEqual([wallBytes.length,map.state.queries],[2,1]);
  // A new block scrolls in after the camera leaves the margin.
  features.push({ id:99, properties:{render_height:9,render_min_height:0,material:'blue'},
    geometry:{type:'Polygon',coordinates:[[[40,0],[60,0],[60,10],[40,0]]]} });
  ms+=300; map.shift.x=260; map.fire('move'); render();
  assert.equal(map.state.queries,2);
  assert.equal(wallBytes.at(-1),(20*4+3)*36*4);
  assert.equal(houseBytes.length,1);
  // A zoom jump or a resize also repeats the query; an unchanged result uploads nothing.
  map.state.zoom=17; ms+=300; map.fire('move'); render();
  ms+=300; map.fire('resize'); render();
  assert.deepEqual([map.state.queries,wallBytes.length],[4,3]);
});

test('footprint keys separate different outlines and match equal ones', () => {
  const a = app(['features/view3d/building-view']);
  const ring = [[23.3219,42.6977],[23.3221,42.6977],[23.3221,42.6979],[23.3219,42.6977]];
  const moved = ring.map(p => [p[0]+1e-6,p[1]]);
  assert.equal(a.footprintKey([ring]),a.footprintKey([ring.map(p => p.slice())]));
  assert.notEqual(a.footprintKey([ring]),a.footprintKey([moved]));
  assert.notEqual(a.footprintKey([ring]),a.footprintKey([ring,moved]));
  assert.notEqual(a.footprintKey([ring]),a.footprintKey([ring.slice().reverse()]));
});

test('indexed projection agrees with the full scan at intersections, long segments and distant fixes', () => {
  const a=app(['features/vehicles/route-line','features/vehicles/direction-arrows','features/vehicles/motion'],{window:{}});
  const pts=Array.from({length:1000},(_,i)=>[42.6+0.02*Math.sin(i/70),23.2+i*0.0004]);
  pts.push([43.3,24.8],[42.6,23.2]);
  const track=a.pathMeta(pts), indexed=a.nearbySegments;
  for (let i=0;i<150;i++) {
    const p=pts[i*7%pts.length], args=[track,p[0]+.0002,p[1]-.0001,(i*37)%360,i*80];
    a.nearbySegments=indexed;
    const hit=a.projectAlong(...args);
    a.nearbySegments=()=>null;
    assert.deepEqual(hit,a.projectAlong(...args));
  }
  a.nearbySegments=indexed;
  assert.equal(a.projectAlong(track,40,20,null,null),null);
  assert.ok(indexed(track,pts[500][0],pts[500][1],.735).length<80);
});

test('RAPTOR boards delayed and early trips inside the effective horizon and honors bans', () => {
  const tt={stopIds:['A','B'],patRoute:['R'],stopPatOff:[0,1,2],stopPatP:[0,0],stopPatI:[0,1],
    patStopOff:[0,2],patStops:[0,1],patInstOff:[0,1],patTimeOff:[0],footOff:[0,0,0],footTo:[],footSec:[],times:[3600,4200]};
  const a=app(['features/journeys/planner'],{tt,ttInstPat:[0]});
  function plan(time,ban) {
    return a.raptor([{s:0,sec:0}],[{s:1,sec:0}],6000,{0:{t:[time,time+600]}},ban,1).results;
  }
  assert.equal(plan(6300)[0].arr,6900);
  assert.equal(plan(6300,{0:true}).length,0);
  assert.equal(plan(11400)[0].arr,12000);
  assert.equal(plan(11401).length,0);
  tt.times=[14000,14600];
  assert.equal(plan(6150)[0].arr,6750);
});

test('a later departure can overtake a live trip, and a rider can stay aboard through a skipped stop', () => {
  const tt = {stopIds: ['A','B','C'], patRoute: ['R'], stopPatOff: [0,1,2,3], stopPatP: [0,0,0],
    stopPatI: [0,1,2], patStopOff: [0,3], patStops: [0,1,2], patInstOff: [0,2], patTimeOff: [0],
    footOff: [0,0,0,0], footTo: [], footSec: [], times: [6000,6400,6800,6100,6500,6900]};
  const a = app(['features/journeys/planner'], {tt, ttInstPat: [0,0]});
  function plan(from, to, predictions, bans) {
    return a.raptor([{s:from,sec:0}], [{s:to,sec:0}], 5900, predictions, bans, 1);
  }
  const congestion = {0: {t: [6000,7000,7500]}};
  assert.equal(plan(0,2,congestion).results[0].arr,6900);
  const skipped = {0: {t: [6000,a.R_SKIP,6300]}};
  assert.equal(plan(0,1,skipped).results[0].arr,6500);
  assert.equal(plan(0,2,skipped).results[0].arr,6300);
  assert.equal(plan(1,2,skipped,{1:true}).results.length,0);
});

test('single-ride routing agrees with exhaustive boarding for 180 mixed live timetables', () => {
  const rows = [[6000,6300,6600,6900], [6070,6370,6670,6970], [6140,6440,6740,7040]];
  const tt = {stopIds: ['A','B','C','D'], patRoute: ['R'], stopPatOff: [0,1,2,3,4], stopPatP: [0,0,0,0],
    stopPatI: [0,1,2,3], patStopOff: [0,4], patStops: [0,1,2,3], patInstOff: [0,3], patTimeOff: [0],
    footOff: [0,0,0,0,0], footTo: [], footSec: [], times: rows.flat()};
  const a = app(['features/journeys/planner'], {tt, ttInstPat: [0,0,0]});
  let seed = 17;
  function random(n) { seed = (Math.imul(seed,1664525) + 1013904223) >>> 0; return seed % n; }
  for (let run=0; run<180; run++) {
    const dep = 5600 + random(750), predictions = {}, bans = {};
    for (let trip=0; trip<rows.length; trip++) {
      if (random(4) === 0) bans[trip] = true;
      if (random(7) < 5) {
        const start = 5600 + random(1400), step = 100 + random(450);
        predictions[trip] = {t: rows[trip].map((_,i) => random(7) === 0 ? a.R_SKIP : start + i*step)};
      }
    }
    const access = [{s:0,sec:0}, {s:1,sec:170}];
    let fastest = Infinity;
    rows.forEach((scheduled, trip) => {
      const times = predictions[trip]?.t || scheduled;
      if (bans[trip] || times[3] === a.R_SKIP) return;
      if (access.some(entry => times[entry.s] >= dep + entry.sec)) fastest = Math.min(fastest,times[3]);
    });
    const route = a.raptor(access, [{s:3,sec:0}], dep, predictions, bans, 1);
    assert.equal(route.results[0]?.arr ?? Infinity, fastest, 'timetable ' + run);
  }
});

test('an offline area retries a retained tile when its transaction fails', async () => {
  const stored=new Map([['sofia_offline_areas',JSON.stringify([{id:'home',name:'Home',b:[23.32,42.69,23.32,42.69]}])]]);
  let fail=true,writes=0;
  const a=app(['shared/ui/format','shared/ui/place-icons','shared/storage/preferences','features/vehicles/route-line',
    'shared/map/preload','features/offline/areas'],{
    localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)},builtStyle:{sources:{streets:{type:'vector',maxzoom:9,tiles:['ofm://test/{z}/{x}/{y}']}}},
    keepUrls:{},KEEP_T:1e13,verSwap:false,mapMode:'vector',storageOn:true,mapVer:'fixture',mapVerAt:0,renderDiag:noop,useVectorMap:noop,navigator:{},setTimeout:noop,
    idb:{keptKeys:async()=>({keys:{}}),get:async()=>({d:new Uint8Array(64)}),put:async(_,__,tile)=>{writes++;return fail ? null : tile.url;},dropTiles:async()=>{}}
  });
  await a.offline.sync();
  assert.equal(writes,2);
  assert.equal(a.offline.info().ready,0);
  assert.equal(JSON.parse(stored.get('sofia_offline_state')).home.failed,2);
  fail=false;
  await a.offline.sync();
  assert.equal(a.offline.info().ready,1);
  assert.equal(a.offline.info().bytes,128);
});

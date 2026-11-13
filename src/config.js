  // ---------- Config ----------
  var FEED_URL   = 'https://gtfs.sofiatraffic.bg/api/v1/vehicle-positions';
  var TU_URL     = 'https://gtfs.sofiatraffic.bg/api/v1/trip-updates';
  var STATIC_URL = 'https://gtfs.sofiatraffic.bg/api/v1/static';
  // Live checks (see docs/live-feed-polling.md). The positions file (~70 KB) is rebuilt every second and
  // each vehicle reports about every 5 s at its own moment, so a check a second shows a report about a
  // second after it is made (up to 5 s later before). Trip updates (~1 MB) only feed ETAs and delays.
  var REFRESH_MS = 1000;            // vehicle positions while the page is visible
  var REFRESH_SAVE_DATA_MS = 5000;  // …with the browser's Data Saver on
  var REFRESH_MAX_MS = 15000;       // longest wait while the feed keeps failing (doubles from REFRESH_MS)
  var TU_REFRESH_MS = 15000;        // trip updates (they were downloaded with every position check)
  // Size of everything drawn over the map (v74): --ui shrinks the panel, sheets, buttons, popups and
  // markers on smaller screens (CSS zoom, see the style sheet). 1 from a 412 × 860 phone or a 1280 × 760
  // desktop window up; smaller below that, never under 0.75 on phones (held close; a 320 × 568 phone needs
  // it to keep a quarter of the screen for the map) or 0.8 on PC.
  var ui = 1;
  function setUiScale() {
    var w = window.innerWidth, h = window.innerHeight, phone = w <= 700;
    var k = Math.min(1, w / (phone ? 412 : 1280), h / (phone ? 860 : 760));
    k = Math.round(Math.max(phone ? 0.75 : 0.8, k) * 100) / 100;
    if (k === ui && document.documentElement.style.getPropertyValue('--ui')) return;
    ui = k;
    document.documentElement.style.setProperty('--ui', String(k));
  }
  setUiScale();
  window.addEventListener('resize', setUiScale);   // registered first: the other resize handlers see the new scale
  var FEED_TIMEOUT_MS = 15000;  // a feed request with no answer by then is given up (else updates would stop for good)
  var TU_TIMEOUT_MS = 6000;     // trip updates (normally < 2 s): the positions wait for them, so give up sooner
  var MOTION_MAX_AHEAD = 300;   // never predict more than 300 m past the last reported position
  var STALE_FEED_MS = 30000;    // no new data for this long (background tab, sleep): vehicles jump, no animation
  var STALE_REPORT_S = 60;      // a vehicle's previous report older than this: it jumps too
  var LABEL_ZOOM = 15;   // show line-number labels from this zoom level…
  var LABEL_MAX  = 80;   // …or at any zoom when a search leaves this few vehicles
  var BUILDING_3D_ZOOM = 17;   // vector map: 3D buildings from this zoom, flat buildings below it
  // v100: the 3D view (a second, tilted MapLibre map opened with the 3D button; see "3D view" further down).
  // Zoom levels are Leaflet's, as everywhere else (the MapLibre map itself runs one level lower).
  var VIEW3D_PITCH = 55;              // tilt when 3D opens (degrees)
  var VIEW3D_MAX_PITCH = 60;          // most tilt allowed (MapLibre calls more than 60° experimental)
  var MAP_DPR_MAX = 2;                // WebGL drawing-buffer cap (phone layouts use 1.5)
  var VIEW3D_BUILDING_ZOOM = 15;      // 3D map: buildings stand up from this zoom
  var VIEW3D_ROAD_ZOOM = 16;          // 3D map: modelled roads and tracks replace the flat street lines from this zoom
  var VIEW3D_BUILDING_OPACITY = 0.75; // a little see-through, so vehicles and lines behind buildings still show
  var VIEW3D_RETRY_MS = 864e5;        // after the 3D map ran out of memory on this device, its button is hidden this long
  var VIEW3D_VEH_HZ = 15;             // Fleet membership and near labels. Moving meshes update every frame.
  var VIEW3D_FREE_2D = false;         // v101: free the 2D vector map while 3D is open (less graphics memory, ~1 s to redraw on return)
  var VIEW3D_TERRAIN = false;         // v103: the terrain switch's default (hills and Vitosha from Mapterhorn's free elevation tiles)
  var VIEW3D_TURN_DEG_S = 90;         // v102: heading-up cameras turn at most this fast (degrees a second), so corners never swing
  var view3d = { on: false };         // filled in by the 3D section; the 2D code asks view3d.on

  var TYPES = {
    3:  { name: 'Bus',     color: getVar('--bus') },
    0:  { name: 'Tram',    color: getVar('--tram') },
    11: { name: 'Trolley', color: getVar('--trolley') },
    1:  { name: 'Metro',   color: getVar('--metro') }
  };
  function getVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function typeInfo(t) { return TYPES[t] || { name: 'Vehicle', color: getVar('--other') }; }


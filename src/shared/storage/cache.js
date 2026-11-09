  // ---------- Local storage (IndexedDB): map tiles, fonts, map style and the schedule zip ----------
  // Saved on the phone so the next opening is fast. If the browser doesn't allow storage
  // (some do for local files), everything still works, just without the speed-up.
  var TILE_MAX = 2500;   // roughly 50–100 MB of map tiles at most; oldest are removed first
  // v85: a tile saved with t ≥ KEEP_T belongs to an offline area (or is a map font) and is never removed
  // to make room; the area list decides when it goes. KEEP_T + time-saved keeps the save time readable.
  var KEEP_T = 1e13;
  var idb = (function () {
    var dbp = null;
    function open() {
      if (dbp) return dbp;
      dbp = new Promise(function (res) {
        // Pages opened as content:// on Android (from Downloads) can get an IndexedDB that never
        // answers at all — no success, no error. Give up after a moment and run without storage.
        var late = setTimeout(function () { res(null); }, 2500);
        try {
          var rq = indexedDB.open('sofia-transit', 1);
          rq.onupgradeneeded = function () {
            var db = rq.result;
            if (!db.objectStoreNames.contains('tiles')) db.createObjectStore('tiles', { keyPath: 'url' }).createIndex('t', 't');
            if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
          };
          rq.onsuccess = function () { clearTimeout(late); res(rq.result); };
          rq.onerror = rq.onblocked = function () { clearTimeout(late); res(null); };
        } catch (e) { clearTimeout(late); res(null); }
      });
      return dbp;
    }
    function req(store, mode, fn) {
      return open().then(function (db) {
        if (!db) return null;
        return new Promise(function (res) {
          var timer = setTimeout(function () { res(null); }, 2000);
          function finish(value) { clearTimeout(timer); res(value); }
          try {
            var tx = db.transaction(store, mode), r = fn(tx.objectStore(store));
            tx.onabort = tx.onerror = r.onerror = function () { finish(null); };
            if (mode === 'readwrite') tx.oncomplete = function () { finish(r.result); };
            else r.onsuccess = function () { finish(r.result === undefined ? null : r.result); };
          } catch (e) { finish(null); }
        });
      });
    }
    return {
      ok: function () { return open().then(function (db) { return !!db; }); },
      get: function (store, key) { return req(store, 'readonly', function (st) { return st.get(key); }); },
      count: function (store) { return req(store, 'readonly', function (st) { return st.count(); }); },
      put: function (store, key, val) { return req(store, 'readwrite', function (st) { return key === null ? st.put(val) : st.put(val, key); }); },
      // v85: tiles of the offline areas are saved with t ≥ KEEP_T, so they sort after every ordinary
      // tile and are never counted or removed here; only the ordinary cache is kept to TILE_MAX
      trimTiles: function () {
        return open().then(function (db) {
          if (!db) return;
          var st = db.transaction('tiles', 'readwrite').objectStore('tiles'), ordinary = IDBKeyRange.upperBound(KEEP_T, true);
          var cnt = st.index('t').count(ordinary);
          cnt.onsuccess = function () {
            var extra = cnt.result - TILE_MAX;
            if (extra <= 0) return;
            extra += Math.round(TILE_MAX * 0.2);   // make some room in one go
            var cur = st.index('t').openKeyCursor(ordinary);
            cur.onsuccess = function () {
              var c = cur.result;
              if (!c || extra-- <= 0) return;
              st.delete(c.primaryKey);
              c.continue();
            };
          };
        });
      },
      // the addresses of every kept (offline-area) tile, read in one pass without loading the tiles
      keptKeys: function () {
        return open().then(function (db) {
          if (!db) return null;
          return new Promise(function (res) {
            var out = {}, n = 0;
            try {
              var cur = db.transaction('tiles', 'readonly').objectStore('tiles').index('t').openKeyCursor(IDBKeyRange.lowerBound(KEEP_T));
              cur.onsuccess = function () {
                var c = cur.result;
                if (!c) return res({ keys: out, n: n });
                out[c.primaryKey] = 1; n++;
                c.continue();
              };
              cur.onerror = function () { res(null); };
            } catch (e) { res(null); }
          });
        });
      },
      // removes the tiles whose address drop(url, kept) says to remove; resolves with how many went
      dropTiles: function (drop) {
        return open().then(function (db) {
          if (!db) return 0;
          return new Promise(function (res) {
            var gone = 0;
            try {
              var tx = db.transaction('tiles', 'readwrite'), st = tx.objectStore('tiles');
              var cur = st.index('t').openKeyCursor();
              cur.onsuccess = function () {
                var c = cur.result;
                if (!c) return;
                if (drop(c.primaryKey, c.key >= KEEP_T)) { st.delete(c.primaryKey); gone++; }
                c.continue();
              };
              tx.oncomplete = function () { res(gone); };
              tx.onerror = tx.onabort = function () { res(gone); };
            } catch (e) { res(0); }
          });
        });
      }
    };
  })();
  setTimeout(function () { idb.trimTiles(); }, 8000);
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
  var storageOn = null;
  idb.ok().then(function (ok) { storageOn = ok; });

  // A saved copy is used when younger than maxAgeMs; otherwise the network is tried first,
  // falling back to the saved copy when offline.
  function cachedJSON(key, url, maxAgeMs) {
    return idb.get('files', key).then(function (c) {
      function net() {
        return fetch(url).then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then(function (j) { idb.put('files', key, { d: j, t: Date.now() }); return j; });
      }
      if (c && c.d && Date.now() - c.t < maxAgeMs) return c.d;
      return net().catch(function (e) { if (c && c.d) return c.d; throw e; });
    });
  }

  // Download with progress reporting (when the server says how big the file is)
  function fetchWithProgress(url, onProgress) {
    return fetch(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      var total = (r.headers && +r.headers.get('content-length')) || 0;
      if (!r.body || !r.body.getReader) return r.arrayBuffer();
      var reader = r.body.getReader(), chunks = [], got = 0;
      function pump() {
        return reader.read().then(function (x) {
          if (x.done) {
            var out = new Uint8Array(got), o = 0;
            chunks.forEach(function (c) { out.set(c, o); o += c.length; });
            return out.buffer;
          }
          chunks.push(x.value);
          got += x.value.length;
          onProgress(total ? got / total : null, got);
          return pump();
        });
      }
      return pump();
    });
  }


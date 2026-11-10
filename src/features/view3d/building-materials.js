  var buildingMaterials = (function () {
    var scheme = 'sofia-buildings', registered = false;
    var facadeLayers = new WeakMap();
    // Roof caps by style and seed: clay tiles and sheet metal on older and smaller buildings,
    // felt, gravel and membrane on flat-roofed blocks. A mapped roof colour wins.
    var tiled = ['#a8644c','#93543f','#b4735a','#8a5a4c','#7d7f82'];
    var flat = ['#77797c','#9a968e','#b3b0a8','#857a70','#8b8e8b'];
    function bySeed(colors) {
      var pick = ['match', ['%', ['coalesce', ['get', 'seed'], ['floor', ['/', ['to-number', ['id'], 0], 10]]], 5]];
      colors.slice(1).forEach(function (color, i) { pick.push(i + 1, color); });
      return pick.concat([colors[0]]);
    }
    var ROOF_COLOR = ['case', ['has', 'roof'], ['to-color', ['get', 'roof'], '#a89d8e'],
      ['match', ['get', 'style'],
        ['plaster', 'brick', 'house', 'church', 'garage'], bySeed(tiled),
        ['panel', 'modern', 'office', 'glass', 'retail', 'industrial', 'public'], bySeed(flat),
        'stone', '#9aa79a',
        '#a89d8e']];

    // Prepared tiles decoded recently. MapLibre asks for the same zoom-14 tile again at
    // every deeper zoom level, so a repeat request skips the download or decompression.
    var decodedTiles = new Map(), DECODED_TILE_LIMIT = 16;
    function preparedTile(key, packed) {
      var ready = decodedTiles.get(key);
      decodedTiles.delete(key);
      if (!ready) {
        if (packed.startsWith('tiles/')) {
          ready = fetch(packed).then(function (response) {
            if (!response.ok) throw new Error('Building tile HTTP ' + response.status);
            return response.arrayBuffer();
          });
        } else {
          var text = atob(packed), bytes = new Uint8Array(text.length);
          for (var i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
          ready = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
        }
        ready.catch(function () { if (decodedTiles.get(key) === ready) decodedTiles.delete(key); });
      }
      decodedTiles.set(key, ready);   // most recent last
      if (decodedTiles.size > DECODED_TILE_LIMIT) decodedTiles.delete(decodedTiles.keys().next().value);
      return ready;
    }

    async function buildingTile(request, controller) {
      var url = request.url.replace(scheme + '://', 'https://');
      var key = /\/14\/(\d+\/\d+)\.pbf$/.exec(url);
      var packed = key && sofiaBuildingTiles[key[1]];
      if (packed) {
        try {
          // MapLibre hands the buffer to its worker, so each request gets its own copy.
          return { data: (await preparedTile(key[1], packed)).slice(0) };
        } catch (e) {
          if (controller.signal.aborted) throw e;
          // Fall back to the street tile when the prepared geometry is unavailable.
        }
      }
      var original = await getTile(url, controller.signal);
      return { data: original.d.slice(0) };
    }

    function install(map3, layer, source) {
      if (!registered) {
        maplibregl.addProtocol(scheme, buildingTile);
        registered = true;
      }
      var sourceId = 'v3-material-' + layer.source;
      if (!map3.getSource(sourceId)) {
        map3.addSource(sourceId, { type: 'vector', minzoom: 14, maxzoom: 14,
          tiles: source.tiles.map(function (url) { return url.replace(/^ofm:/, scheme + ':'); }) });
      }
      var copy = JSON.parse(JSON.stringify(layer));
      copy.id += '-material';
      copy.source = sourceId;
      map3.addLayer(copy, layer.id);
      map3.addLayer(bulgarianHouseLayer(copy.id, sourceId, true), layer.id);

    }

    function apply(map3, enabled, houses) {
      var style = map3.getStyle();
      style.layers.forEach(function (layer) {
        if (layer.type !== 'fill-extrusion' || layer['source-layer'] !== 'building') return;
        var source = style.sources[layer.source];
        if (!source.tiles || !source.tiles.every(function (url) { return /^ofm:\/\//.test(url); })) return;
        if (!map3.getLayer(layer.id + '-material')) {
          if (layer.layout && layer.layout.visibility === 'none') return;
          install(map3, layer, source);
        }
        var material = layer.id + '-material';
        var textured = enabled || houses;
        map3.setPaintProperty(material, 'fill-extrusion-opacity', textured ? 1 : VIEW3D_BUILDING_OPACITY);
        map3.setPaintProperty(material, 'fill-extrusion-color', enabled ? ROOF_COLOR : houses ? '#a89d8e' : layer.paint['fill-extrusion-color']);
        var facade = material + '-facades';
        if (textured && !map3.getLayer(facade)) {
          var walls = solidFacadeLayer(material, 'v3-material-' + layer.source, enabled);
          map3.addLayer(walls, layer.id);
          if (!facadeLayers.has(map3)) facadeLayers.set(map3, new Map());
          facadeLayers.get(map3).set(facade, walls);
        } else if (textured) {
          facadeLayers.get(map3).get(facade).setClassified(enabled);
        } else if (map3.getLayer(facade)) {
          map3.removeLayer(facade);
          facadeLayers.get(map3).delete(facade);
        }
        if (houses && !map3.getLayer(material + '-houses')) {

          map3.addLayer(bulgarianHouseLayer(material, 'v3-material-' + layer.source), layer.id);
        } else if (!houses && map3.getLayer(material + '-houses')) {
          map3.removeLayer(material + '-houses');
        }
        map3.setPaintProperty(layer.id, 'fill-extrusion-opacity', 0);
      });
    }
    return { apply: apply };
  })();

  var buildingMaterials = (function () {
    var scheme = 'sofia-buildings', registered = false;
    var colors = { green: [211, 195, 169], blue: [151, 148, 141], purple: [182, 148, 125], gold: [209, 193, 158] };

    var plaster = { facade: [210,191,165], ivory: [217,210,194], clay: [195,164,143] };
    var facadeLayers = new WeakMap();

    function pattern(material) {
      var image = new ImageData(32, 32), color = colors[material];
      for (var y = 0; y < 32; y++) {
        for (var x = 0; x < 32; x++) {
          var shade = 0;
          color = colors[material];
          var bay = x % 16, level = y % 16;
          if (material === 'green') {
            // Rendered masonry, inset sash windows and a stone sill.
            shade = level === 15 || (x + 8 * Math.floor(y / 8)) % 16 === 0 ? -18 : 0;
            if (bay >= 4 && bay <= 11 && level >= 3 && level <= 10)
              color = bay === 8 || level === 7 ? [157,146,128] : [111,106,98];
          }
          if (material === 'blue') {
            color = x % 8 === 0 ? [176,173,166] : level >= 13 ? [112,109,103] : colors.blue;
            shade = (x % 8) * 2;
          }
          if (material === 'purple') {
            color = level === 14 ? [160,142,125] : colors.purple;
            if (bay >= 2 && bay <= 13 && level >= 4 && level <= 9)
              color = bay % 4 === 0 ? [153,140,127] : [111,105,98];
          }
          if (material === 'gold') {
            var block = (x + 8 * Math.floor(y / 8)) % 16;
            shade = y % 8 === 0 || block === 0 ? -34 : ((x * 19 + y * 31) % 9) - 4;
          }
          if (plaster[material]) {
            var frame = x % 16, floor = y % 16;
            color = floor === 15 ? [165,145,125] :
              frame >= 4 && frame <= 11 && floor >= 3 && floor <= 11 ?
              (frame === 8 || floor === 7 ? [183,167,145] : [108,105,100]) : plaster[material];
          }
          var offset = (y * 32 + x) * 4;
          for (var c = 0; c < 3; c++) image.data[offset + c] = color[c] + shade;
          image.data[offset + 3] = 255;
        }
      }
      return image;
    }

    async function buildingTile(request, controller) {
      var url = request.url.replace(scheme + '://', 'https://');
      var key = /\/14\/(\d+\/\d+)\.pbf$/.exec(url);
      var packed = key && sofiaBuildingTiles[key[1]];
      if (packed) {
        try {
          if (packed.startsWith('tiles/')) {
            var response = await fetch(packed, { signal: controller.signal });
            if (!response.ok) throw new Error('Building tile HTTP ' + response.status);
            return { data: await response.arrayBuffer() };
          }
          var bytes = Uint8Array.from(atob(packed), function (c) { return c.charCodeAt(0); });
          var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
          return { data: await new Response(stream).arrayBuffer() };
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
        map3.setPaintProperty(material, 'fill-extrusion-color', textured ? '#a89d8e' : layer.paint['fill-extrusion-color']);
        var facade = material + '-facades';
        if (textured && !map3.getLayer(facade)) {
          var walls = solidFacadeLayer(material, 'v3-material-' + layer.source, enabled, pattern);
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
    return { apply: apply, pattern: pattern };
  })();

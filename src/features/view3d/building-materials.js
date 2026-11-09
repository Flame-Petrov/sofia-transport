  var buildingMaterials = (function () {
    var scheme = 'sofia-buildings', registered = false;
    var colors = { green: [12, 222, 85], blue: [0, 112, 255], purple: [184, 44, 255], gold: [255, 188, 0] };

    function pattern(material) {
      var image = new ImageData(32, 32), color = colors[material];
      for (var y = 0; y < 32; y++) {
        for (var x = 0; x < 32; x++) {
          var shade = 0;
          if (material === 'green') {
            var joint = (x + 8 * Math.floor(y / 8)) % 16, row = y % 8;
            var distance = Math.min(joint, 16 - joint, row, 8 - row);
            shade = Math.min(1, distance / 2) * 6 - 5;
          }
          if (material === 'blue') shade = -5 * Math.cos(x * Math.PI / 4);
          if (material === 'purple') shade = -5 * Math.cos(y * Math.PI / 4);
          if (material === 'gold') shade = (((x * 19 + y * 31 + x * y * 7) % 13) - 6) / 2;
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
          var bytes = Uint8Array.from(atob(packed), function (c) { return c.charCodeAt(0); });
          var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
          return { data: await new Response(stream).arrayBuffer() };
        } catch (e) { /* Use the cached street map if a bundled tile cannot be decoded. */ }
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
      Object.keys(colors).forEach(function (name) {
        var id = 'v3-material-' + name;
        if (!map3.hasImage(id)) map3.addImage(id, pattern(name));
      });
      // Outside the extract, the same source returns normal OpenFreeMap features.
      // The two filters are exclusive. Both layers occupy the original draw order.
      [false, true].forEach(function (textured) {
        var copy = JSON.parse(JSON.stringify(layer));
        copy.id += textured ? '-material' : '-neutral';
        copy.source = sourceId;
        var filter = textured ? ['has', 'material'] : ['!', ['has', 'material']];
        copy.filter = layer.filter ? ['all', layer.filter, filter] : filter;
        if (textured) copy.paint['fill-extrusion-opacity'] = 0.92;
        if (textured) copy.paint['fill-extrusion-pattern'] = ['image', ['concat', 'v3-material-', ['get', 'material']]];
        map3.addLayer(copy, layer.id);
      });
    }

    function apply(map3, enabled, houses) {
      var style = map3.getStyle();
      style.layers.forEach(function (layer) {
        if (layer.type !== 'fill-extrusion' || layer['source-layer'] !== 'building') return;
        var source = style.sources[layer.source];
        if (!source.tiles || !source.tiles.every(function (url) { return /^ofm:\/\//.test(url); })) return;
        if (!map3.getLayer(layer.id + '-material')) {
          if ((!enabled && !houses) || (layer.layout && layer.layout.visibility === 'none')) return;
          install(map3, layer, source);
        }
        var usePrepared = enabled || houses;
        map3.setLayoutProperty(layer.id + '-neutral', 'visibility', usePrepared ? 'visible' : 'none');
        var material = layer.id + '-material';
        map3.setLayoutProperty(material, 'visibility', usePrepared ? 'visible' : 'none');
        map3.setPaintProperty(material, 'fill-extrusion-opacity', enabled ? 0.92 : VIEW3D_BUILDING_OPACITY);
        map3.setPaintProperty(material, 'fill-extrusion-pattern', enabled ? ['image', ['concat', 'v3-material-', ['get', 'material']]] : null);
        if (houses && !map3.getLayer(material + '-houses')) {
          var wallTint = colors.green.map(function (channel) { return channel / 255; });
          map3.addLayer(bulgarianHouseLayer(material, 'v3-material-' + layer.source, wallTint), layer.id);
        } else if (!houses && map3.getLayer(material + '-houses')) {
          map3.removeLayer(material + '-houses');
        }
        // Keep the native geometry ready. Changing its layout would rebuild
        // street-source buckets before the neutral buildings could reappear.
        map3.setPaintProperty(layer.id, 'fill-extrusion-opacity', usePrepared ? 0 : VIEW3D_BUILDING_OPACITY);
      });
    }
    return { apply: apply };
  })();

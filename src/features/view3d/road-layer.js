  // 3D roads and tracks: the MapLibre custom layer that draws the tiles kept by road-store.js.
  // A tile is uploaded once and then only drawn: a frame costs a frustum test and one draw call
  // per visible tile, with no allocation. Everything lies on or just above the ground and is
  // painted back to front inside each tile (the index order), so nothing here writes depth and
  // buildings, route lines, shadows, vehicles and labels draw over it as they do over the flat map.
  var ROAD_VERTEX = 'attribute vec2 pos; attribute float height; attribute vec2 kind; attribute float dist;' +
    'uniform vec4 anchor; uniform mat4 offsets; uniform vec3 sunDir, grade; uniform float ppm, night;' +
    'varying vec3 shade; varying vec3 info;' +
    'void main(){gl_Position=anchor+offsets*vec4(pos,height,0.);' +
    // kind.y: 0 lies flat, 1 is a slope, 2 and up a kerb face with its direction in the east/south plane.
    'float light=1.;' +
    'if(kind.y>1.5){float a=(kind.y-2.)/253.*6.2831853-3.1415927;' +
    'light=.74+.3*max(cos(a)*sunDir.x+sin(a)*sunDir.y,0.);}' +
    'else if(kind.y>.5)light=.9;' +
    'shade=grade*light+.02*night;' +
    // Distance along the line in metres, and how many screen pixels a metre covers here.
    'info=vec3(kind.x,dist*.1,ppm/max(gl_Position.w,1.));}';
  var ROAD_FRAGMENT = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'varying vec3 shade; varying vec3 info;' +
    // A stripe pattern fades to its average once a period is only a few pixels long, so it never shimmers.
    'float stripe(float period,float share){float f=clamp((info.z*period-2.5)/3.,0.,1.);' +
    'return mix(share,step(fract(info.y/period),share),f);}' +
    'void main(){float m=floor(info.x+.5);vec3 c;' +
    'vec3 asphalt=vec3(.64,.655,.68),white=vec3(.97,.97,.94);' +
    'if(m<.5)c=asphalt;' +                                             // carriageway
    'else if(m<1.5)c=vec3(.88,.85,.78);' +                             // pedestrian paving
    'else if(m<2.5)c=vec3(.82,.8,.76);' +                             // sidewalk
    'else if(m<3.5)c=vec3(.68,.66,.62);' +                             // kerb face
    'else if(m<4.5)c=vec3(.7,.7,.69);' +                               // tram track set in the road
    'else if(m<5.5)c=mix(vec3(.72,.68,.6),vec3(.47,.41,.35),stripe(.7,.36));' +   // tram bed with sleepers
    'else if(m<6.5)c=mix(vec3(.63,.6,.57),vec3(.4,.36,.32),stripe(.7,.38));' +   // railway ballast with sleepers
    'else if(m<7.5)c=mix(asphalt,white,stripe(9.,.34));' +             // dashed lane line
    'else if(m<8.5)c=white;' +                                         // solid centre line
    'else if(m<9.5)c=mix(asphalt,white,stripe(1.,.5));' +              // zebra crossing
    'else c=vec3(.3,.32,.36);' +                                       // rail
    'gl_FragColor=vec4(c*shade,1.);}';

  function roadLayer(options) {
    var store = roadStore, map, program, uniforms, vao = false, wideOk = false, on = true, asleep = true;
    var flat = [], flatHidden = false, coverage = false, usable = false;
    var moved = true, plannedAt = -Infinity, lastCenter = null, lastMoveAt = 0, lead = [0, 0];
    var DRAWS = 16, TRIANGLES = 150000, DRAW_DISTANCE = 2400;
    // How far each detail level is drawn, in metres from the camera: surface (as far as the
    // draw distance), sidewalks and kerbs, track beds, markings, rails.
    var REACH = [Infinity, 900, 900, 380, 260];
    var anchor = new Float32Array(4), offsets = new Float32Array(16), sun = new Float32Array(3), grade = new Float32Array(3);
    var pickTile = new Array(32), pickCount = new Int32Array(32), pickFar = new Float64Array(32), picked = 0;
    var view = { box: [0, 0, 0, 0], near: [0, 0], whole: false, nx: 0, ny: 0, metre: 0 };
    var seen = new Float64Array(5), litState = null;
    var counters = { draws: 0, triangles: 0, frames: 0, renderMs: 0, renderWorst: 0, plans: 0, flatHides: 0 };

    function wake() { if (map) map.triggerRepaint(); }
    function onMove() { moved = true; }
    function sleeping() {
      return !on || !usable || map.getZoom() < options.minzoom || !!(map.getTerrain && map.getTerrain());
    }

    // The flat street and rail lines of the basemap give way while the meshes cover the whole view.
    // Opacity 0 skips their drawing without reloading a tile.
    function setFlat(hidden) {
      if (hidden === flatHidden) return;
      flatHidden = hidden;
      if (hidden) counters.flatHides++;
      flat.forEach(function (layer) {
        if (!map.getLayer(layer.id)) return;
        if (hidden) layer.opacity = map.getPaintProperty(layer.id, 'line-opacity');
        map.setPaintProperty(layer.id, 'line-opacity', hidden ? 0 : layer.opacity === undefined ? 1 : layer.opacity);
      });
    }

    // The ground under the screen, in zoom-15 tile units, cut off at the draw distance.
    function look(now) {
      var canvas = map.getCanvas(), w = canvas.clientWidth, h = canvas.clientHeight;
      var pitch = map.getPitch() * Math.PI / 180, bearing = map.getBearing() * Math.PI / 180;
      var fov = (map.transform && map.transform.fov || 36.87) * Math.PI / 180, focal = h / 2 / Math.tan(fov / 2);
      var center = map.getCenter(), cx = mercatorX(center.lng), cy = mercatorY(center.lat);
      var world = 512 * Math.pow(2, map.getZoom()), tilesAcross = Math.pow(2, store.ZOOM);
      var metre = 1 / (2 * Math.PI * 6371008.8 * Math.cos(center.lat * Math.PI / 180));   // one metre in Mercator units
      var limit = DRAW_DISTANCE * store.governor.draw() * metre * world;                  // the draw distance in pixels
      var cos = Math.cos(bearing), sin = Math.sin(bearing), box = view.box, whole = true;
      box[0] = box[1] = Infinity; box[2] = box[3] = -Infinity;
      // The point on the ground straight below the camera.
      var under = focal * Math.sin(pitch);
      view.nx = cx + (-under * sin) / world; view.ny = cy + (under * cos) / world;
      for (var i = 0; i < 4; i++) {
        var sx = i & 1 ? w / 2 : -w / 2, sy = i & 2 ? h / 2 : -h / 2;
        var depth = focal * Math.cos(pitch) + sy * Math.sin(pitch);
        var back = depth > 1 ? sy * focal / depth : -Infinity;
        if (back - under < -limit) { back = under - limit; whole = false; }
        var side = sx * (focal - back * Math.sin(pitch)) / focal;
        var x = (cx + (side * cos - back * sin) / world) * tilesAcross, y = (cy + (side * sin + back * cos) / world) * tilesAcross;
        if (x < box[0]) box[0] = x; if (x > box[2]) box[2] = x;
        if (y < box[1]) box[1] = y; if (y > box[3]) box[3] = y;
      }
      view.whole = whole; view.metre = metre;
      view.near[0] = cx * tilesAcross; view.near[1] = cy * tilesAcross;
      // Where the camera will be in about a second, from how the centre has moved.
      if (lastCenter && now - lastMoveAt < 1000 && now > lastMoveAt) {
        var k = 1200 / (now - lastMoveAt);
        lead[0] = Math.max(-1, Math.min(1, (view.near[0] - lastCenter[0]) * k));
        lead[1] = Math.max(-1, Math.min(1, (view.near[1] - lastCenter[1]) * k));
      } else lead[0] = lead[1] = 0;
      lastCenter = [view.near[0], view.near[1]]; lastMoveAt = now;
      store.plan(box, view.near, lead, now);
      counters.plans++;
    }

    function upload(gl, entry, now) {
      var data = entry.data;
      if (data.wide && !wideOk) { store.failed(entry); return; }
      var handle = { vertices: gl.createBuffer(), indices: gl.createBuffer(), vao: null, type: data.wide ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT };
      if (vao) { handle.vao = gl.createVertexArray(); gl.bindVertexArray(handle.vao); }
      gl.bindBuffer(gl.ARRAY_BUFFER, handle.vertices);
      gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, handle.indices);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
      if (vao) { point(gl); gl.bindVertexArray(null); }
      if (gl.getError() === gl.OUT_OF_MEMORY) {
        free(handle); store.failed(entry); store.budget(Math.max(4 * 1048576, store.usedBytes() * 0.75));
        return;
      }
      store.uploaded(entry, handle, now);
    }
    // The 12-byte vertex: position, height in cm, material and flags, distance in dm.
    function point(gl) {
      for (var a = 0; a < 4; a++) gl.enableVertexAttribArray(a);
      gl.vertexAttribPointer(0, 2, gl.UNSIGNED_SHORT, false, 12, 0);
      gl.vertexAttribPointer(1, 1, gl.SHORT, false, 12, 4);
      gl.vertexAttribPointer(2, 2, gl.UNSIGNED_BYTE, false, 12, 6);
      gl.vertexAttribPointer(3, 1, gl.UNSIGNED_SHORT, false, 12, 8);
    }
    var context = null;
    function free(handle) {
      if (!context) return;
      context.deleteBuffer(handle.vertices); context.deleteBuffer(handle.indices);
      if (handle.vao) context.deleteVertexArray(handle.vao);
    }

    // Tiles in view, nearest first, each with the index count its distance allows.
    function choose(matrix) {
      var ready = store.ready, detail = store.governor.detail(), reach = DRAW_DISTANCE * store.governor.draw();
      var size = 1 / Math.pow(2, store.ZOOM), floor = flatHidden ? 2 : 0;
      picked = 0;
      for (var i = 0; i < ready.length; i++) {
        var entry = ready[i], x0 = entry.x0, y0 = entry.y0, x1 = x0 + size, y1 = y0 + size;
        var left = 0, right = 0, up = 0, down = 0, behind = 0;
        for (var c = 0; c < 4; c++) {
          var x = c & 1 ? x1 : x0, y = c & 2 ? y1 : y0;
          var cw = matrix[3] * x + matrix[7] * y + matrix[15];
          var cx = matrix[0] * x + matrix[4] * y + matrix[12], cy = matrix[1] * x + matrix[5] * y + matrix[13];
          if (cw <= 0) { behind++; continue; }
          if (cx < -cw) left++; else if (cx > cw) right++;
          if (cy < -cw) down++; else if (cy > cw) up++;
        }
        if (behind === 4 || left === 4 || right === 4 || up === 4 || down === 4) continue;
        var dx = view.nx < x0 ? x0 - view.nx : view.nx > x1 ? view.nx - x1 : 0;
        var dy = view.ny < y0 ? y0 - view.ny : view.ny > y1 ? view.ny - y1 : 0;
        var far = Math.sqrt(dx * dx + dy * dy) / view.metre;
        if (far > reach) continue;
        var level = 0;
        for (var l = 4; l > 0; l--) if (far <= REACH[l] * detail) { level = l; break; }
        if (level < floor) level = floor;
        // Insert by distance. A full list keeps its nearest tiles.
        var at;
        if (picked < pickTile.length) at = picked++;
        else if (far >= pickFar[picked - 1]) continue;
        else at = picked - 1;
        while (at > 0 && pickFar[at - 1] > far) {
          pickTile[at] = pickTile[at - 1]; pickCount[at] = pickCount[at - 1]; pickFar[at] = pickFar[at - 1]; at--;
        }
        pickTile[at] = entry; pickCount[at] = entry.prefix[level]; pickFar[at] = far;
      }
    }

    var layer = {
      id: options.id, type: 'custom', renderingMode: '2d',
      onAdd: function (owner, gl) {
        map = owner; context = gl;
        program = gl.createProgram();
        [[gl.VERTEX_SHADER, ROAD_VERTEX], [gl.FRAGMENT_SHADER, ROAD_FRAGMENT]].forEach(function (pair) {
          var shader = gl.createShader(pair[0]);
          gl.shaderSource(shader, pair[1]); gl.compileShader(shader);
          if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
          gl.attachShader(program, shader); gl.deleteShader(shader);
        });
        ['pos', 'height', 'kind', 'dist'].forEach(function (name, i) { gl.bindAttribLocation(program, i, name); });
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
        uniforms = {};
        ['anchor', 'offsets', 'sunDir', 'grade', 'ppm', 'night'].forEach(function (k) { uniforms[k] = gl.getUniformLocation(program, k); });
        vao = typeof gl.createVertexArray === 'function';
        wideOk = vao || !!gl.getExtension('OES_element_index_uint');
        flat = (options.flat || []).map(function (id) { return { id: id, opacity: undefined }; });
        store.reset();   // a 3D map closed a moment ago may still hold the store
        store.bind(free, wake);
        usable = store.available();
        if (options.budget) store.budget(options.budget);
        map.on('move', onMove); map.on('resize', onMove);
      },
      render: function (gl, matrix) {
        var began = performance.now();
        if (sleeping()) {
          if (!asleep) { asleep = true; setFlat(false); }
          return;
        }
        if (asleep) { asleep = false; moved = true; plannedAt = -Infinity; seen[2] = -1; litState = null; }
        store.governor.frame(began);
        // Plan again only once the camera has really changed: a follow drift or a small turn keeps the last plan.
        if (moved && began - plannedAt > 150) {
          moved = false;
          var tr = map.transform, zoomNow = tr.zoom, lngNow = tr.center.lng, latNow = tr.center.lat, bearingNow = map.getBearing(), pitchNow = tr.pitch;
          var shift = Math.max(Math.abs(lngNow - seen[0]) * Math.cos(latNow * Math.PI / 180), Math.abs(latNow - seen[1])) * 111320;
          if (shift > 25 || Math.abs(zoomNow - seen[2]) > 0.08 || Math.abs(bearingNow - seen[3]) > 3 || Math.abs(pitchNow - seen[4]) > 2) {
            seen[0] = lngNow; seen[1] = latNow; seen[2] = zoomNow; seen[3] = bearingNow; seen[4] = pitchNow;
            plannedAt = began;
            look(began);
            coverage = view.whole && store.covered(view.box);
          }
        }
        // One upload a frame at most, so a pan never stalls on a burst of tiles.
        var next = store.takeUpload();
        if (next) {
          upload(gl, next, began);
          coverage = view.whole && store.covered(view.box);
          if (store.takeUpload()) map.triggerRepaint();
        }
        choose(matrix);
        setFlat(coverage && picked <= DRAWS);

        // MapLibre hands a custom layer blending for opaque colour, no culling and a read-only depth
        // test at this layer's place in the style: all of that is what the ground needs.
        gl.useProgram(program);
        // The map matrix times the step size, kept apart from each tile's origin: the origin is
        // multiplied in double precision here, so close zoom shows no jitter.
        var unit = store.UNIT, cm = view.metre / 100;
        for (var i = 0; i < 16; i++) offsets[i] = matrix[i] * (i < 8 ? unit : i < 12 ? cm : 1);
        gl.uniformMatrix4fv(uniforms.offsets, false, offsets);
        var state = daylight.state();
        if (state !== litState) {
          litState = state;
          var dir = state.lighting.dir;
          sun[0] = dir[0]; sun[1] = dir[1]; sun[2] = dir[2];
          grade[0] = state.grade[0]; grade[1] = state.grade[1]; grade[2] = state.grade[2];
          gl.uniform3fv(uniforms.sunDir, sun); gl.uniform3fv(uniforms.grade, grade); gl.uniform1f(uniforms.night, state.night);
        }
        // Pixels per metre at a vertex is this over its clip-space w, which at the map's centre is
        // the camera's distance in pixels.
        var t = map.transform, reachPx = t.cameraToCenterDistance || 0.5 * t.height / Math.tan((t.fov || 36.87) * Math.PI / 360);
        gl.uniform1f(uniforms.ppm, 512 * Math.pow(2, t.zoom) * view.metre * reachPx);

        var draws = 0, triangles = 0;
        for (var p = 0; p < picked && draws < DRAWS; p++) {
          var entry = pickTile[p], count = pickCount[p];
          if (triangles + count / 3 > TRIANGLES) count = entry.prefix[0];
          if (!count || triangles + count / 3 > TRIANGLES) continue;
          var handle = entry.handle, ox = entry.ox, oy = entry.oy;
          anchor[0] = matrix[0] * ox + matrix[4] * oy + matrix[12];
          anchor[1] = matrix[1] * ox + matrix[5] * oy + matrix[13];
          anchor[2] = matrix[2] * ox + matrix[6] * oy + matrix[14];
          anchor[3] = matrix[3] * ox + matrix[7] * oy + matrix[15];
          gl.uniform4fv(uniforms.anchor, anchor);
          if (handle.vao) gl.bindVertexArray(handle.vao);
          else {
            gl.bindBuffer(gl.ARRAY_BUFFER, handle.vertices);
            gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, handle.indices);
            point(gl);
          }
          gl.drawElements(gl.TRIANGLES, count, handle.type, 0);
          store.touch(entry, began);
          draws++; triangles += count / 3;
        }
        if (vao) gl.bindVertexArray(null);
        else for (var a = 0; a < 4; a++) gl.disableVertexAttribArray(a);
        for (var q = 0; q < picked; q++) pickTile[q] = null;
        counters.draws = draws; counters.triangles = triangles; counters.frames++;
        var spent = performance.now() - began;
        counters.renderMs += spent;
        if (spent > counters.renderWorst) counters.renderWorst = spent;
      },
      onRemove: function (owner) {
        owner.off('move', onMove); owner.off('resize', onMove);
        try { setFlat(false); } catch (e) {}
        if (store.boundTo(free)) { store.reset(); store.bind(null, null); }
        if (context) context.deleteProgram(program);
        context = null; map = null;
      },
      // The switch in the 3D menu.
      setShown: function (value) { on = !!value; moved = true; wake(); },
      // True while the meshes cover the whole view: the flat lines are hidden and trams follow the tiles' centrelines.
      covers: function () { return !asleep && flatHidden; },
      counters: counters
    };
    return layer;
  }

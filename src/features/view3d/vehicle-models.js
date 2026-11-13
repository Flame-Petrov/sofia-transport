  // The release embeds the three GLBs so the numbered page also works on its own.
  // Metro estimates use the rail vehicle silhouette and their own directed timetable path.
  function vehicleMeshType(type) { return type === 1 ? 0 : type; }
  var vehicleMeshes = { 0: '{{vehicle-model tram}}', 3: '{{vehicle-model bus}}', 11: '{{vehicle-model trolleybus}}' };
  var vehicleModelZoom = 16; // MapLibre zoom (17 on the flat map).
  var vehicleModelMetresPerUnit = 1.8;
  var decodedMeshes = {}, meshRequests = {}, meshRetryAt = {};
  function availableVehicleMesh(type) {
    var asset = vehicleMeshes[type];
    if (!asset || decodedMeshes[type]) return decodedMeshes[type];
    if (!asset.startsWith('models/')) {
      decodedMeshes[type] = vehicleMeshVertices(asset);
    } else if (!meshRequests[type] && !(Date.now() < meshRetryAt[type])) {
      meshRequests[type] = fetch(asset).then(function (response) {
        if (!response.ok) throw new Error('Vehicle model HTTP ' + response.status);
        return response.arrayBuffer();
      }).then(function (bytes) {
        decodedMeshes[type] = vehicleMeshVertices(new Uint8Array(bytes));
        view3d.vehicleSceneChanged();
      }).catch(function () {
        meshRetryAt[type] = Date.now() + 30000;
        setTimeout(view3d.vehicleSceneChanged, 30001);
      })
        .finally(function () { delete meshRequests[type]; });
    }
    return decodedMeshes[type];
  }
  function vehicleMeshVertices(encoded) {
    var bytes = typeof encoded === 'string'
      ? Uint8Array.from(atob(encoded), function (c) { return c.charCodeAt(0); }) : encoded;
    var jsonLength = new DataView(bytes.buffer).getUint32(12, true);
    var doc = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonLength)));
    function values(index) {
      var a = doc.accessors[index], view = doc.bufferViews[a.bufferView];
      return new Float32Array(bytes.buffer, 28 + jsonLength + view.byteOffset, a.count * 3);
    }
    var vertices = [];
    doc.meshes[0].primitives.forEach(function (primitive) {
      var p = values(primitive.attributes.POSITION), n = values(primitive.attributes.NORMAL);
      var tone = Math.pow(doc.materials[primitive.material].pbrMetallicRoughness.baseColorFactor[0], 1 / 2.2);
      for (var i = 0; i < p.length; i += 3) vertices.push(p[i], p[i+1], p[i+2], n[i], n[i+1], n[i+2], tone);
    });
    return new Float32Array(vertices);
  }

  // Every visible vehicle of one mesh type is drawn in a single instanced call: the mesh is the
  // per-vertex data, and each vehicle adds one row of position, headings, scale and colour.
  var VEHICLE_INSTANCE = [['anchor', 4], ['heading', 2], ['endHeadings', 4], ['scale', 1], ['color', 4]];
  var VEHICLE_INSTANCE_FLOATS = 15;
  function vehicleModelLayer(points) {
    var map, program, buffers = {}, loc = {}, rows, instanced, scratch = new Float32Array(VEHICLE_INSTANCE_FLOATS * 16);
    return {
      id: 'v3-models', type: 'custom', renderingMode: '3d',
      onAdd: function (owner, gl) {
        map = owner;
        var ext = gl.drawArraysInstanced ? null : gl.getExtension('ANGLE_instanced_arrays');
        if (!gl.drawArraysInstanced && !ext) throw Error('Instanced drawing is unavailable');
        instanced = ext ? { divisor: function (a, n) { ext.vertexAttribDivisorANGLE(a, n); }, draw: function (count, n) { ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, count, n); } }
          : { divisor: function (a, n) { gl.vertexAttribDivisor(a, n); }, draw: function (count, n) { gl.drawArraysInstanced(gl.TRIANGLES, 0, count, n); } };
        program = gl.createProgram();
        function shader(type, code) {
          var s = gl.createShader(type);
          gl.shaderSource(s, code); gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
          gl.attachShader(program, s); gl.deleteShader(s);
        }
        shader(gl.VERTEX_SHADER, [
          'attribute vec3 pos, normal; attribute float tone; uniform mat4 matrix;',
          'attribute vec4 anchor, endHeadings, color; attribute vec2 heading; attribute float scale;',
          'uniform vec3 sunDir, sunColor, ambient; uniform float lamp, shadow; uniform vec2 reach; varying vec3 light, glow; varying float onGround; varying vec4 paint;',
          'vec3 orient(vec3 p, vec2 heading){ return vec3(dot(p.xz,heading),dot(p.xz,vec2(heading.y,-heading.x)),p.y); }',
          'void main(){',
          '  float pivot = sign(pos.z)*3.6;',
          '  vec2 outer = pos.z > 0.0 ? endHeadings.zw : endHeadings.xy;',
          '  vec2 axis = normalize(mix(heading,outer,smoothstep(3.3,3.9,abs(pos.z))));',
          '  vec3 hinge = vec3(0.0,0.0,pivot);',
          '  vec3 world = orient(hinge,heading)+orient(pos-hinge,axis);',
          // Shadow pass: flatten the model onto the ground along the light.
          '  onGround = shadow; if (shadow > 0.5) { world.xy -= reach*world.z; world.z = 0.0; }',
          '  gl_Position=anchor+matrix*vec4(world*scale,0.0);',
          '  paint = color;',
          '  vec3 facing = orient(normal,axis);',
          '  light = tone*(ambient+sunColor*max(dot(facing,sunDir),0.0));',
          // After dark: lit cabin windows (the mesh's mid-grey glass), white headlights and red tail lights.
          '  float glass = 1.0-step(0.03,abs(tone-0.455)), side = 1.0-step(0.6,abs(normal.y));',
          '  float lamps = step(0.3,pos.y)*step(pos.y,1.15)*step(0.45,abs(pos.x))*step(0.5,tone);',
          '  glow = lamp*(glass*side*vec3(0.95,0.78,0.5)*0.8 + lamps*(step(0.6,normal.z)*vec3(1.0,0.95,0.8)*1.2 + step(normal.z,-0.6)*vec3(1.0,0.1,0.08)*0.9)); }'
        ].join('\n'));
        shader(gl.FRAGMENT_SHADER, 'precision mediump float; uniform float strength; varying vec4 paint; varying vec3 light, glow; varying float onGround; void main(){ gl_FragColor=onGround>0.5 ? vec4(0.0,0.0,0.0,strength*paint.a) : vec4((paint.rgb*light+glow)*paint.a,paint.a); }');
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
        ['matrix','sunDir','sunColor','ambient','lamp','shadow','reach','strength'].forEach(function (k) { loc[k] = gl.getUniformLocation(program,k); });
        ['pos','normal','tone'].concat(VEHICLE_INSTANCE.map(function (a) { return a[0]; })).forEach(function (k) { loc[k] = gl.getAttribLocation(program,k); });
        rows = gl.createBuffer();
      },
      render: function (gl, matrix) {
        if (map.getZoom() < vehicleModelZoom) return;
        var groups = {}, any = false;
        points().forEach(function (f) {
          if (!f.model) return;
          var type = vehicleMeshType(f.type);
          (groups[type] || (groups[type] = [])).push(f); any = true;
        });
        if (!any) return;
        gl.useProgram(program); gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
        gl.uniformMatrix4fv(loc.matrix,false,matrix);
        var daylit = daylight.lighting();
        gl.uniform3fv(loc.sunDir,daylit.dir); gl.uniform3fv(loc.sunColor,daylit.color); gl.uniform3fv(loc.ambient,daylit.ambient); gl.uniform1f(loc.lamp,daylit.lamp); gl.uniform2fv(loc.reach,shadows.reach());
        gl.uniform1f(loc.shadow,0);
        var terrain = map.getTerrain(), cast = shadows.strength(map);
        gl.enableVertexAttribArray(loc.tone); gl.enableVertexAttribArray(loc.pos); gl.enableVertexAttribArray(loc.normal);
        VEHICLE_INSTANCE.forEach(function (a) { gl.enableVertexAttribArray(loc[a[0]]); instanced.divisor(loc[a[0]],1); });
        Object.keys(groups).forEach(function (type) {
          var list = groups[type], mesh = buffers[type];
          if (!mesh) {
            var data = decodedMeshes[type], buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER,buf);
            gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
            mesh = buffers[type] = { buf: buf, count: data.length / 7 };
          }
          if (scratch.length < list.length * VEHICLE_INSTANCE_FLOATS) scratch = new Float32Array(list.length * VEHICLE_INSTANCE_FLOATS * 2);
          list.forEach(function (f, i) {
            var h = (f.bearing || 0) * Math.PI / 180, o = i * VEHICLE_INSTANCE_FLOATS;
            var altitude = terrain ? map.queryTerrainElevation(f.c) || 0 : 0;
            var p = maplibregl.MercatorCoordinate.fromLngLat(f.c,altitude);
            // Translate in double precision before uploading the small clip-space offset.
            for (var k = 0; k < 4; k++) scratch[o+k] = matrix[k]*p.x + matrix[k+4]*p.y + matrix[k+8]*p.z + matrix[k+12];
            var rear = f.sections ? toRad(f.sections[0]) : h, front = f.sections ? toRad(f.sections[2]) : h;
            scratch[o+4] = Math.cos(h); scratch[o+5] = Math.sin(h);
            scratch[o+6] = Math.cos(rear); scratch[o+7] = Math.sin(rear); scratch[o+8] = Math.cos(front); scratch[o+9] = Math.sin(front);
            scratch[o+10] = vehicleModelMetresPerUnit * p.meterInMercatorCoordinateUnits();
            var rgb = parseInt(f.color.slice(1),16);
            scratch[o+11] = (rgb >> 16)/255; scratch[o+12] = ((rgb >> 8)&255)/255; scratch[o+13] = (rgb&255)/255; scratch[o+14] = f.opacity;
          });
          gl.bindBuffer(gl.ARRAY_BUFFER,rows);
          gl.bufferData(gl.ARRAY_BUFFER,scratch.subarray(0,list.length * VEHICLE_INSTANCE_FLOATS),gl.DYNAMIC_DRAW);
          var offset = 0;
          VEHICLE_INSTANCE.forEach(function (a) {
            gl.vertexAttribPointer(loc[a[0]],a[1],gl.FLOAT,false,VEHICLE_INSTANCE_FLOATS*4,offset); offset += a[1]*4;
          });
          gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buf);
          gl.vertexAttribPointer(loc.pos,3,gl.FLOAT,false,28,0); gl.vertexAttribPointer(loc.normal,3,gl.FLOAT,false,28,12);
          gl.vertexAttribPointer(loc.tone,1,gl.FLOAT,false,28,24);
          if (cast) {
            gl.uniform1f(loc.shadow,1); gl.uniform1f(loc.strength,cast);
            shadows.begin(gl); instanced.draw(mesh.count,list.length); shadows.end(gl);
            gl.uniform1f(loc.shadow,0);
          }
          instanced.draw(mesh.count,list.length);
        });
        // Other layers share these attribute slots, so none may stay per-instance.
        VEHICLE_INSTANCE.forEach(function (a) { instanced.divisor(loc[a[0]],0); gl.disableVertexAttribArray(loc[a[0]]); });
        gl.disableVertexAttribArray(loc.tone); gl.disableVertexAttribArray(loc.pos); gl.disableVertexAttribArray(loc.normal);
      },
      onRemove: function (_, gl) {
        Object.values(buffers).forEach(function (m) { gl.deleteBuffer(m.buf); });
        gl.deleteBuffer(rows);
        gl.deleteProgram(program);
      }
    };
  }

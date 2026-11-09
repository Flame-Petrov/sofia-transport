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

  function vehicleModelLayer(points) {
    var map, program, buffers = {}, loc = {};
    return {
      id: 'v3-models', type: 'custom', renderingMode: '3d',
      onAdd: function (owner, gl) {
        map = owner;
        program = gl.createProgram();
        function shader(type, code) {
          var s = gl.createShader(type);
          gl.shaderSource(s, code); gl.compileShader(s);
          if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s));
          gl.attachShader(program, s); gl.deleteShader(s);
        }
        shader(gl.VERTEX_SHADER, [
          'attribute vec3 pos, normal; attribute float tone; uniform mat4 matrix; uniform vec4 anchor;',
          'uniform vec2 heading; uniform vec4 endHeadings; uniform float scale; varying float light;',
          'vec3 orient(vec3 p, vec2 heading){ return vec3(dot(p.xz,heading),dot(p.xz,vec2(heading.y,-heading.x)),p.y); }',
          'void main(){',
          '  float pivot = sign(pos.z)*3.6;',
          '  vec2 outer = pos.z > 0.0 ? endHeadings.zw : endHeadings.xy;',
          '  vec2 axis = normalize(mix(heading,outer,smoothstep(3.3,3.9,abs(pos.z))));',
          '  vec3 hinge = vec3(0.0,0.0,pivot);',
          '  vec3 world = orient(hinge,heading)+orient(pos-hinge,axis);',
          '  gl_Position=anchor+matrix*vec4(world*scale,0.0);',
          '  light=tone*(0.78+0.22*dot(orient(normal,axis),normalize(vec3(-0.4,-0.5,0.8)))); }'
        ].join('\n'));
        shader(gl.FRAGMENT_SHADER, 'precision mediump float; uniform vec4 color; varying float light; void main(){ gl_FragColor=vec4(color.rgb*light*color.a,color.a); }');
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
        ['matrix','anchor','heading','endHeadings','scale','color'].forEach(function (k) { loc[k] = gl.getUniformLocation(program,k); });
        ['pos','normal','tone'].forEach(function (k) { loc[k] = gl.getAttribLocation(program,k); });
      },
      render: function (gl, matrix) {
        if (map.getZoom() < vehicleModelZoom) return;
        gl.useProgram(program); gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
        gl.uniformMatrix4fv(loc.matrix,false,matrix);
        gl.enableVertexAttribArray(loc.tone); gl.enableVertexAttribArray(loc.pos); gl.enableVertexAttribArray(loc.normal);
        points().forEach(function (f) {
          if (!f.model) return;
          var type = vehicleMeshType(f.type), mesh = buffers[type];
          if (!mesh) {
            var data = decodedMeshes[type], buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER,buf);
            gl.bufferData(gl.ARRAY_BUFFER,data,gl.STATIC_DRAW);
            mesh = buffers[type] = { buf: buf, count: data.length / 7 };
          }
          var h = (f.bearing || 0) * Math.PI / 180;
          var altitude = map.getTerrain() ? map.queryTerrainElevation(f.c) || 0 : 0;
          var p = maplibregl.MercatorCoordinate.fromLngLat(f.c,altitude);
          gl.uniform1f(loc.scale, vehicleModelMetresPerUnit * p.meterInMercatorCoordinateUnits());
          // Translate in double precision before uploading the small clip-space offset.
          var anchor = [0,1,2,3].map(function (i) { return matrix[i]*p.x + matrix[i+4]*p.y + matrix[i+8]*p.z + matrix[i+12]; });
          var rgb = parseInt(f.color.slice(1),16);
          gl.uniform4fv(loc.anchor,anchor); gl.uniform2f(loc.heading,Math.cos(h),Math.sin(h));
          var rear = f.sections ? toRad(f.sections[0]) : h, front = f.sections ? toRad(f.sections[2]) : h;
          gl.uniform4f(loc.endHeadings,Math.cos(rear),Math.sin(rear),Math.cos(front),Math.sin(front));
          gl.uniform4f(loc.color,(rgb >> 16)/255,((rgb >> 8)&255)/255,(rgb&255)/255,f.opacity);
          gl.bindBuffer(gl.ARRAY_BUFFER,mesh.buf);
          gl.vertexAttribPointer(loc.pos,3,gl.FLOAT,false,28,0); gl.vertexAttribPointer(loc.normal,3,gl.FLOAT,false,28,12);
          gl.vertexAttribPointer(loc.tone,1,gl.FLOAT,false,28,24);
          gl.drawArrays(gl.TRIANGLES,0,mesh.count);
        });
        gl.disableVertexAttribArray(loc.tone); gl.disableVertexAttribArray(loc.pos); gl.disableVertexAttribArray(loc.normal);
      },
      onRemove: function (_, gl) {
        Object.values(buffers).forEach(function (m) { gl.deleteBuffer(m.buf); });
        gl.deleteProgram(program);
      }
    };
  }

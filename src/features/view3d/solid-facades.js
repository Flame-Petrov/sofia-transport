  // UV coordinates are measured on the footprint, so camera zoom never changes the repeat.
  function solidFacadeLayer(materialId, sourceId, classified, pattern) {
    var map, program, buffer, textures = [], batches = [], origin;
    var attrs, uniforms, dirty = true, lastBuild = -Infinity;
    var materials = ['green','blue','purple','gold','facade','ivory','clay'];
    var meshCache = new Map();
    function terrainChanged() { meshCache.clear(); invalidate(); }
    function invalidate() { dirty = true; }
    function sourceChanged(event) {
      if (event.sourceId === sourceId) invalidate();
      else if (map.getTerrain() && event.sourceId === map.getTerrain().source) terrainChanged();
    }

    function rebuild() {
      var canvas = map.getCanvas();
      var features = map.queryRenderedFeatures([[0,0],[canvas.clientWidth,canvas.clientHeight]],
        {layers:[materialId]});
      var center = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter());
      if (!origin || Math.hypot(center.x-origin.x,center.y-origin.y)>0.001) {
        origin = center;
        origin.unit = origin.meterInMercatorCoordinateUnits();
        meshCache.clear();
      }
      var groups = materials.map(function () { return []; }), seen = new Set();
      var terrain = !!map.getTerrain();
      features.forEach(function (f) {
        var props = f.properties, top = Number(props.render_height), base = Number(props.render_min_height || 0);
        if (!(top > base)) return;
        var index = classified ? materials.indexOf(props.material) : 4 + Math.abs(Number(f.id) || 0) % 3;
        var group = groups[index < 0 ? 4 : index];
        var polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        polygons.forEach(function (rings) {
          // Retain separate parts of the same ID at a tile boundary.
          var key = f.id + '/' + base + '/' + top + '/' + JSON.stringify(rings);
          if (seen.has(key)) return;
          seen.add(key);
          if (meshCache.has(key)) { group.push(meshCache.get(key)); return; }
          var out = [];
          var anchor = maplibregl.MercatorCoordinate.fromLngLat(rings[0][0]);
          var unit = anchor.meterInMercatorCoordinateUnits();
          var elevation = terrain ? map.queryTerrainElevation(rings[0][0]) || 0 : 0;
          var bottom = (base + elevation) * unit / origin.unit;
          var roof = (top + elevation) * unit / origin.unit;
          rings.forEach(function (ring) {
            var prev = maplibregl.MercatorCoordinate.fromLngLat(ring[0]);
            for (var j=1; j<ring.length; j++) {
              var next = maplibregl.MercatorCoordinate.fromLngLat(ring[j]);
              var dx = next.x-prev.x, dy = next.y-prev.y, len = Math.hypot(dx,dy);
              if (!len) continue;
              var x=(prev.x-origin.x)/origin.unit, y=(prev.y-origin.y)/origin.unit;
              var nx=(next.x-origin.x)/origin.unit, ny=(next.y-origin.y)/origin.unit;
              var u=len/unit/6, shade=0.87+0.10*(dx-dy)/len/Math.SQRT2;
              var a=[x,y,bottom,0,base/6,shade], b=[nx,ny,bottom,u,base/6,shade];
              var c=[nx,ny,roof,u,top/6,shade], d=[x,y,roof,0,top/6,shade];
              out.push(...a,...b,...c,...a,...c,...d);
              prev=next;
            }
          });
          var mesh = new Float32Array(out);
          meshCache.set(key,mesh);
          group.push(mesh);
        });
      });
      meshCache.forEach(function(_,key){ if (!seen.has(key)) meshCache.delete(key); });
      var size = groups.reduce(function (n,g) {return g.reduce(function(total,mesh){return total+mesh.length;},n);},0);
      var vertices = new Float32Array(size), offset=0;
      batches = groups.map(function(g) {
        var start=offset/6;
        g.forEach(function(mesh){vertices.set(mesh,offset); offset+=mesh.length;});
        return {start:start,count:offset/6-start};
      });
      return vertices;
    }

    return {
      id:materialId+'-facades', type:'custom', renderingMode:'3d',
      setClassified:function(value) { if (classified!==value) { classified=value; invalidate(); } },
      onAdd:function(owner,gl) {
        map=owner; program=gl.createProgram();
        function attach(type,source) {
          var shader=gl.createShader(type);
          gl.shaderSource(shader,source); gl.compileShader(shader);
          if (!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
          gl.attachShader(program,shader); gl.deleteShader(shader);
        }
        attach(gl.VERTEX_SHADER,'attribute vec3 pos, surface; uniform vec4 anchor; uniform mat4 offsets; varying vec3 detail; void main(){gl_Position=anchor+offsets*vec4(pos,0.);detail=surface;}');
        attach(gl.FRAGMENT_SHADER,'precision mediump float; varying vec3 detail; uniform sampler2D facade; void main(){gl_FragColor=vec4(texture2D(facade,detail.xy).rgb*detail.z,1.);}');
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
        attrs=['pos','surface'].map(function(k){return gl.getAttribLocation(program,k);});
        uniforms=['anchor','offsets','facade'].map(function(k){return gl.getUniformLocation(program,k);});
        buffer=gl.createBuffer();
        textures=materials.map(function(name){
          var tex=gl.createTexture();
          gl.bindTexture(gl.TEXTURE_2D,tex);
          gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,pattern(name));
          gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
          gl.generateMipmap(gl.TEXTURE_2D);
          return tex;
        });
        map.on('move',invalidate); map.on('resize',invalidate); map.on('terrain',terrainChanged);
        map.on('sourcedata',sourceChanged);
      },
      render:function(gl,matrix) {
        var layer=map.getLayer(materialId);
        if (!layer || map.getZoom()<(layer.minzoom || 0)) { dirty=true; return; }
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        var now=performance.now();
        if (dirty && now-lastBuild>=180) {
          gl.bufferData(gl.ARRAY_BUFFER,rebuild(),gl.DYNAMIC_DRAW);
          dirty=false; lastBuild=now;
        } else if (dirty) map.triggerRepaint();
        if (!origin) return;
        gl.useProgram(program);
        gl.uniform4fv(uniforms[0],[0,1,2,3].map(function(i){return matrix[i]*origin.x+matrix[i+4]*origin.y+matrix[i+12];}));
        gl.uniformMatrix4fv(uniforms[1],false,Float32Array.from(matrix,function(v){return v*origin.unit;}));
        gl.activeTexture(gl.TEXTURE0); gl.uniform1i(uniforms[2],0);
        gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1,-1);
        attrs.forEach(function(a,i){gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,3,gl.FLOAT,false,24,i*12);});
        batches.forEach(function(b,i){
          if (b.count) {gl.bindTexture(gl.TEXTURE_2D,textures[i]);gl.drawArrays(gl.TRIANGLES,b.start,b.count);}
        });
        attrs.forEach(function(a){gl.disableVertexAttribArray(a);});
        gl.disable(gl.POLYGON_OFFSET_FILL);
      },
      onRemove:function(owner,gl) {
        owner.off('move',invalidate); owner.off('resize',invalidate); owner.off('terrain',terrainChanged);
        owner.off('sourcedata',sourceChanged);
        textures.forEach(function(t){gl.deleteTexture(t);});
        gl.deleteBuffer(buffer); gl.deleteProgram(program);
      }
    };
  }

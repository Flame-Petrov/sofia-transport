  // UV coordinates are measured on the footprint, so camera zoom never changes the repeat.
  function solidFacadeLayer(materialId, sourceId, classified, pattern) {
    var map, program, buffer, textures = [], batches = [], origin;
    var attrs, uniforms, dirty = true, lastBuild = -Infinity, view, built = -1, asleep = false;
    var materials = ['green','blue','purple','gold','facade','ivory','clay'];
    var meshCache = new Map(), previousKeys = null;
    function terrainChanged() { previousKeys=null; meshCache.clear(); dirty = true; }
    function moved() { view.cameraMoved(); }
    function resized() { view.invalidate(); }
    function sourceChanged(event) {
      if (event.sourceId === sourceId) view.invalidate();
      else if (map.getTerrain() && event.sourceId === map.getTerrain().source) terrainChanged();
    }

    // Two triangles per wall edge, six floats per corner: position, then u, v and shade.
    function wallMesh(rings, base, top, terrain) {
      var edges = 0;
      rings.forEach(function (ring) { edges += Math.max(0, ring.length-1); });
      var mesh = new Float32Array(edges*36), n = 0;
      var first = rings[0][0];
      var unit = 1 / (2*Math.PI*6371008.8*Math.cos(first[1]*Math.PI/180));   // one metre in Mercator units here
      var elevation = terrain ? map.queryTerrainElevation(first) || 0 : 0;
      var bottom = (base + elevation) * unit / origin.unit;
      var roof = (top + elevation) * unit / origin.unit;
      var shade;
      function corner(x,y,z,u,v) { mesh[n++]=x; mesh[n++]=y; mesh[n++]=z; mesh[n++]=u; mesh[n++]=v; mesh[n++]=shade; }
      rings.forEach(function (ring) {
        var px = mercatorX(ring[0][0]), py = mercatorY(ring[0][1]);
        for (var j=1; j<ring.length; j++) {
          var qx = mercatorX(ring[j][0]), qy = mercatorY(ring[j][1]);
          var dx = qx-px, dy = qy-py, len = Math.hypot(dx,dy);
          if (!len) continue;
          var x=(px-origin.x)/origin.unit, y=(py-origin.y)/origin.unit;
          var nx=(qx-origin.x)/origin.unit, ny=(qy-origin.y)/origin.unit;
          var u=len/unit/6;
          shade=0.87+0.10*(dx-dy)/len/Math.SQRT2;
          corner(x,y,bottom,0,base/6); corner(nx,ny,bottom,u,base/6); corner(nx,ny,roof,u,top/6);
          corner(x,y,bottom,0,base/6); corner(nx,ny,roof,u,top/6); corner(x,y,roof,0,top/6);
          px=qx; py=qy;
        }
      });
      return n < mesh.length ? mesh.subarray(0,n) : mesh;
    }

    function rebuild() {
      var center = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter());
      if (!origin || Math.hypot(center.x-origin.x,center.y-origin.y)>0.001) {
        origin = center;
        origin.unit = origin.meterInMercatorCoordinateUnits();
        previousKeys=null; meshCache.clear();
      }
      var groups = materials.map(function () { return []; }), seen = new Set();
      var terrain = !!map.getTerrain();
      view.features.forEach(function (f) {
        var props = f.properties, top = Number(props.render_height), base = Number(props.render_min_height || 0);
        if (!(top > base)) return;
        var index = classified ? materials.indexOf(props.material) : 4 + Math.abs(Number(f.id) || 0) % 3;
        if (index < 0) index = 4;
        var group = groups[index];
        var polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        polygons.forEach(function (rings) {
          // Retain separate parts of the same ID at a tile boundary.
          var key = index + '/' + f.id + '/' + base + '/' + top + '/' + footprintKey(rings);
          if (seen.has(key)) return;
          seen.add(key);
          if (!meshCache.has(key)) meshCache.set(key, wallMesh(rings, base, top, terrain));
          group.push(meshCache.get(key));
        });
      });
      if (sameBuildingKeys(previousKeys,seen)) return null;
      previousKeys=seen;
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
      setClassified:function(value) { if (classified!==value) { classified=value; dirty=true; } },
      onAdd:function(owner,gl) {
        map=owner; program=gl.createProgram();
        view=buildingView(map,materialId); view.invalidate();
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
        map.on('move',moved); map.on('resize',resized); map.on('terrain',terrainChanged);
        map.on('sourcedata',sourceChanged);
      },
      render:function(gl,matrix) {
        var layer=map.getLayer(materialId);
        if (!layer || map.getZoom()<(layer.minzoom || 0)) { asleep=true; return; }
        if (asleep) { asleep=false; dirty=true; view.invalidate(); }
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        // The shared query decides when the visible buildings may have changed.
        var now=performance.now(), version=view.refresh(now), due=dirty || version!==built;
        if (due && now-lastBuild>=180 && now>view.queriedAt) {
          var data=rebuild();
          if (data !== null) gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
          dirty=false; lastBuild=now; built=version;
        } else if (due) map.triggerRepaint();
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
        owner.off('move',moved); owner.off('resize',resized); owner.off('terrain',terrainChanged);
        owner.off('sourcedata',sourceChanged);
        textures.forEach(function(t){gl.deleteTexture(t);});
        gl.deleteBuffer(buffer); gl.deleteProgram(program);
      }
    };
  }

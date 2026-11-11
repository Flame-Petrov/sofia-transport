  // Each wall carries a whole number of window bays and floors from facade-styles.js, so no
  // window is cut at a corner or roofline and camera zoom never changes the repeat.
  var FACADE_VERTEX = 'attribute vec3 pos, surface; attribute vec2 paint; uniform vec4 anchor; uniform mat4 offsets;' +
    'uniform vec3 sunDir, sunColor, ambient;' +
    'varying vec2 uv; varying vec4 wall; varying vec3 band, shade;' +
    'void main(){gl_Position=anchor+offsets*vec4(pos,0.);uv=surface.xy;' +
    // surface.z is the floor count plus 100 for a ground floor or 200 for a windowless wall.
    'float kind=floor(surface.z/100.+.001);band=vec3(surface.z-kind*100.,kind,floor(paint.y));' +
    // paint.x packs the wall colour, paint.y the building seed plus the direction the wall faces.
    'float r=floor(paint.x/65536.),g=floor((paint.x-r*65536.)/256.);' +
    'wall=vec4(vec3(r,g,paint.x-r*65536.-g*256.)/255.,1.);' +
    // The fraction of paint.y is the wall normal's angle in the east/south plane. Light is ambient plus the sun or moon.
    'float ang=(fract(paint.y)-.005)/.99*6.2831853-3.1415927;' +
    'shade=ambient+sunColor*max(cos(ang)*sunDir.x+sin(ang)*sunDir.y,0.);}';
  var FACADE_FRAGMENT = '#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n' +
    'varying vec2 uv; varying vec4 wall; varying vec3 band, shade; uniform sampler2D ground, middle, crown; uniform float lit;' +
    'void main(){float level=min(floor(uv.y),band.x-1.);' +
    // All three sheets are read with continuous coordinates, which keeps mipmapping seamless.
    'vec4 low=texture2D(ground,vec2(uv.x*.5,uv.y)),mid=texture2D(middle,uv*.5),top=texture2D(crown,vec2(uv.x*.5,uv.y-band.x+1.));' +
    'vec4 t=level>=band.x-1. ? top : mid;' +
    'if(band.y>.5&&level<1.)t=low;' +
    'if(band.y>1.5)t=vec4(.93,.93,.93,1.);' +
    // Each window gets its own brightness, and a few have light curtains drawn.
    'float n=fract(sin(dot(vec2(floor(uv.x),level)+band.z*.37,vec2(12.9898,78.233)))*43758.5453);' +
    'vec3 own=t.rgb*(.8+.4*n);' +
    'float dim=1.-smoothstep(.3,.55,dot(t.rgb,vec3(.3,.6,.1)));' +
    'own=mix(own,vec3(.86,.8,.66),.6*step(.88,n)*dim);' +
    'vec3 c=mix(own,t.rgb*wall.rgb,t.a);' +
    'c*=shade*(1.-.14*(1.-smoothstep(0.,.4,uv.y)));' +
    // After dark some windows are lit: the dark glass of the sheet takes a warm or, now and then, a cool light.
    'float glow=dim*step(n,lit);' +
    'vec3 lamp=mix(vec3(1.,.76,.42),vec3(.75,.86,1.),step(.93,fract(n*91.7)))*(.65+.6*fract(n*37.1));' +
    'gl_FragColor=vec4(mix(c,lamp,.9*glow),1.);}';

  function solidFacadeLayer(materialId, sourceId, classified) {
    var map, program, buffer, textures = [], batches = [], origin;
    var attrs, uniforms, shadowProgram, dirty = true, lastBuild = -Infinity, view, built = -1, asleep = false;
    var STRIDE = 8;   // floats per corner: position, then u, v, bands, colour and seed with shade
    var meshCache = new Map(), previousKeys = null;
    function terrainChanged() { previousKeys=null; meshCache.clear(); dirty = true; }
    function moved() { view.cameraMoved(); }
    function resized() { view.invalidate(); }
    function sourceChanged(event) {
      if (event.sourceId === sourceId) view.invalidate();
      else if (map.getTerrain() && event.sourceId === map.getTerrain().source) terrainChanged();
    }

    // Two triangles per wall edge.
    function wallMesh(rings, base, top, terrain, look) {
      var edges = 0, edge = 0, style = facadeStyles.styles[look.style];
      rings.forEach(function (ring) { edges += Math.max(0, ring.length-1); });
      var mesh = new Float32Array(edges*6*STRIDE), n = 0;
      var floors = Math.max(1, Math.min(99, Math.round((top-base)/style.floor)));
      var bands, paint;
      var first = rings[0][0];
      var unit = 1 / (2*Math.PI*6371008.8*Math.cos(first[1]*Math.PI/180));   // one metre in Mercator units here
      var elevation = terrain ? map.queryTerrainElevation(first) || 0 : 0;
      var bottom = (base + elevation) * unit / origin.unit;
      var roof = (top + elevation) * unit / origin.unit;
      function corner(x,y,z,u,v) {
        mesh[n++]=x; mesh[n++]=y; mesh[n++]=z; mesh[n++]=u; mesh[n++]=v; mesh[n++]=bands; mesh[n++]=look.color; mesh[n++]=paint;
      }
      rings.forEach(function (ring) {
        var px = mercatorX(ring[0][0]), py = mercatorY(ring[0][1]);
        var area=0;
        for (var k=1; k<ring.length; k++) area+=ring[k-1][0]*ring[k][1]-ring[k][0]*ring[k-1][1];
        var sgn=area<=0 ? 1 : -1;   // longitude/latitude winding is the reverse of Mercator's
        for (var j=1; j<ring.length; j++) {
          var qx = mercatorX(ring[j][0]), qy = mercatorY(ring[j][1]);
          var dx = qx-px, dy = qy-py, len = Math.hypot(dx,dy);
          if (!len) continue;
          var x=(px-origin.x)/origin.unit, y=(py-origin.y)/origin.unit;
          var nx=(qx-origin.x)/origin.unit, ny=(qy-origin.y)/origin.unit;
          var metres=len/unit, bays=Math.round(metres/style.bay);
          // Stub walls stay plain. Longer ones start on either bay of the two-bay sheets.
          var plain=metres<2.2 || bays<1, u0=plain ? 0 : (edge+look.seed)&1, u=u0+(plain ? 1 : bays);
          bands=floors+(plain ? 200 : base>0 ? 0 : 100);
          // The wall's outward normal in the east/south plane, from the ring's winding, packed into the fraction of the seed.
          paint=look.seed+0.005+0.99*(Math.atan2(-sgn*dx/len,sgn*dy/len)+Math.PI)/(2*Math.PI);
          corner(x,y,bottom,u0,0); corner(nx,ny,bottom,u,0); corner(nx,ny,roof,u,floors);
          corner(x,y,bottom,u0,0); corner(nx,ny,roof,u,floors); corner(x,y,roof,u0,floors);
          px=qx; py=qy; edge++;
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
      var groups = facadeStyles.names.map(function () { return []; }), seen = new Set();
      var terrain = !!map.getTerrain();
      view.features.forEach(function (f) {
        var props = f.properties, top = Number(props.render_height), base = Number(props.render_min_height || 0);
        if (!(top > base)) return;
        var polygons = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
        polygons.forEach(function (rings) {
          // Retain separate parts of the same ID at a tile boundary.
          var look = facadeStyles.look(props, f.id, classified, props.style == null && rings[0][0]);
          var key = look.style + '/' + look.color + '/' + f.id + '/' + base + '/' + top + '/' + footprintKey(rings);
          if (seen.has(key)) return;
          seen.add(key);
          if (!meshCache.has(key)) meshCache.set(key, wallMesh(rings, base, top, terrain, look));
          groups[look.style].push(meshCache.get(key));
        });
      });
      if (sameBuildingKeys(previousKeys,seen)) return null;
      previousKeys=seen;
      meshCache.forEach(function(_,key){ if (!seen.has(key)) meshCache.delete(key); });
      var size = groups.reduce(function (n,g) {return g.reduce(function(total,mesh){return total+mesh.length;},n);},0);
      var vertices = new Float32Array(size), offset=0;
      batches = groups.map(function(g) {
        var start=offset/STRIDE;
        g.forEach(function(mesh){vertices.set(mesh,offset); offset+=mesh.length;});
        return {start:start,count:offset/STRIDE-start};
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
        attach(gl.VERTEX_SHADER,FACADE_VERTEX);
        attach(gl.FRAGMENT_SHADER,FACADE_FRAGMENT);
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
        attrs=['pos','surface','paint'].map(function(k){return gl.getAttribLocation(program,k);});
        uniforms=['anchor','offsets','ground','middle','crown','sunDir','sunColor','ambient','lit'].map(function(k){return gl.getUniformLocation(program,k);});
        buffer=gl.createBuffer();
        try { shadowProgram=shadows.create(gl); } catch (e) { console.warn('3D shadows failed:', e); }
        var sharp=gl.getExtension('EXT_texture_filter_anisotropic');
        // Three sheets per style: ground floor, repeating floors and the top floor.
        textures=facadeStyles.names.map(function(_,index){
          var sheets=facadeStyles.images(index);
          return [sheets.ground,sheets.middle,sheets.crown].map(function(image){
            var tex=gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D,tex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
            gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
            gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);
            gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
            if (sharp) gl.texParameterf(gl.TEXTURE_2D,sharp.TEXTURE_MAX_ANISOTROPY_EXT,4);
            gl.generateMipmap(gl.TEXTURE_2D);
            return tex;
          });
        });
        map.on('move',moved); map.on('resize',resized); map.on('terrain',terrainChanged);
        map.on('sourcedata',sourceChanged);
      },
      render:function(gl,matrix) {
        var layer=map.getLayer(materialId);
        if (!layer || map.getZoom()<(layer.minzoom || 0) || map.getLayoutProperty(materialId,'visibility')==='none') { asleep=true; return; }
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
        var anchor=[0,1,2,3].map(function(i){return matrix[i]*origin.x+matrix[i+4]*origin.y+matrix[i+12];});
        var offsets=Float32Array.from(matrix,function(v){return v*origin.unit;});
        gl.uniform4fv(uniforms[0],anchor); gl.uniformMatrix4fv(uniforms[1],false,offsets);
        [0,1,2].forEach(function(unit){gl.uniform1i(uniforms[2+unit],unit);});
        var light=daylight.lighting();
        gl.uniform3fv(uniforms[5],light.dir); gl.uniform3fv(uniforms[6],light.color); gl.uniform3fv(uniforms[7],light.ambient); gl.uniform1f(uniforms[8],light.lit);
        gl.disable(gl.CULL_FACE); gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
        gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-1,-1);
        attrs.forEach(function(a,i){gl.enableVertexAttribArray(a);gl.vertexAttribPointer(a,i<2 ? 3 : 2,gl.FLOAT,false,STRIDE*4,i*12);});
        batches.forEach(function(b,i){
          if (!b.count) return;
          textures[i].forEach(function(tex,unit){gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,tex);});
          gl.drawArrays(gl.TRIANGLES,b.start,b.count);
        });
        gl.activeTexture(gl.TEXTURE0);
        attrs.forEach(function(a){gl.disableVertexAttribArray(a);});
        gl.disable(gl.POLYGON_OFFSET_FILL);
        shadows.pass(gl,shadowProgram,map,anchor,offsets,STRIDE*4,function(){
          batches.forEach(function(b){ if (b.count) gl.drawArrays(gl.TRIANGLES,b.start,b.count); });
        });
      },
      onRemove:function(owner,gl) {
        owner.off('move',moved); owner.off('resize',resized); owner.off('terrain',terrainChanged);
        owner.off('sourcedata',sourceChanged);
        textures.forEach(function(set){set.forEach(function(t){gl.deleteTexture(t);});});
        gl.deleteBuffer(buffer); gl.deleteProgram(program); if (shadowProgram) gl.deleteProgram(shadowProgram.program);
      }
    };
  }

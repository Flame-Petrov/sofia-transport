  // Close-range Sofia houses. Build the mesh in local metres around the mapped
  // footprint so a rotated street frontage keeps its original alignment.
  var houseDesigns = [
    { name: 'Shuttered gable', hip: 0, pitch: 0.42, wall: [0.96,0.84,0.65], roof: [0.67,0.28,0.16] },
    { name: 'Timber frame', hip: 1, pitch: 0.34, wall: [0.96,0.92,0.80], roof: [0.59,0.26,0.18] },
    { name: 'Brick cornice', hip: 0.35, pitch: 0.38, wall: [0.88,0.66,0.49], roof: [0.61,0.31,0.23] },
    { name: 'Wooden veranda', hip: 1, pitch: 0.27, wall: [0.95,0.85,0.72], roof: [0.72,0.33,0.20] },
    { name: 'Dormer cottage', hip: 0.55, pitch: 0.46, wall: [0.89,0.82,0.63], roof: [0.62,0.25,0.14] }
  ];
  var apartmentDesigns = [
    { name: 'Ochre balcony flats', hip: 1, pitch: 0.24, wall: [0.89,0.72,0.49], roof: [0.62,0.29,0.17] },
    { name: 'Brick stairwell block', hip: 0.3, pitch: 0.21, wall: [0.77,0.48,0.35], roof: [0.49,0.27,0.21] },
    { name: 'Corniced city residence', hip: 0.8, pitch: 0.36, wall: [0.92,0.85,0.71], roof: [0.59,0.26,0.18] },
    { name: 'Gallery apartments', hip: 0, pitch: 0.22, wall: [0.82,0.76,0.65], roof: [0.51,0.28,0.22] },
    { name: 'Modernist walk-up', hip: 1, pitch: 0.035, wall: [0.91,0.89,0.83], roof: [0.43,0.43,0.41] }
  ];
  function houseDesignIndex(id, designs) {
    // Prepared way IDs usually end in 2. Mix the upper digits before choosing.
    var mixed = Math.imul((id >>> 0) ^ Math.floor(id / 4294967296), 0x45d9f3b);
    return ((mixed ^ (mixed >>> 16)) >>> 0) % designs.length;
  }
  function bulgarianHouse(f, vertices, origin, map) {
    var geometry = f.geometry, height = Number(f.properties.render_height);
    if (geometry.type !== 'Polygon' || geometry.coordinates.length !== 1 ||
        geometry.coordinates[0].length !== 5 || height < 3 || height > 28 ||
        Number(f.properties.render_min_height) !== 0) return false;
    var ring = geometry.coordinates[0];
    var site = maplibregl.MercatorCoordinate.fromLngLat(ring[0]);
    var unit = site.meterInMercatorCoordinateUnits();
    var corners = ring.slice(0, 4).map(function (ll) {
      var p = maplibregl.MercatorCoordinate.fromLngLat(ll);
      return [(p.x-site.x)/unit, (p.y-site.y)/unit];
    });
    var edges = corners.map(function (p,i) {
      var q = corners[(i+1)%4];
      return [q[0]-p[0],q[1]-p[1]];
    });
    var lengths = edges.map(function (e) { return Math.hypot(e[0],e[1]); });
    var longest = Math.max.apply(null,lengths);
    if (Math.min.apply(null,lengths) < 4 || longest > 65) return false;
    var designs = height > 12 || longest > 26 ? apartmentDesigns : houseDesigns;
    // Reject skewed, concave and tile-clipped outlines masquerading as houses.
    if (edges.some(function (a,i) {
      var j=(i+1)%4,b=edges[j];
      return Math.abs(a[0]*b[0]+a[1]*b[1]) > 0.14*lengths[i]*lengths[j];
    })) return false;
    if (corners.some(function (_,i) {
      var p=maplibregl.MercatorCoordinate.fromLngLat(ring[i]);
      return [p.x,p.y].some(function (v) {
        var t=Math.round(v*16384*4096)%4096;
        return t===8 || t===4088 || t===0;
      });
    })) return false;
    if (lengths[1]>lengths[0]) corners.push(corners.shift());
    var center = corners.reduce(function (s,p) {return [s[0]+p[0]/4,s[1]+p[1]/4];},[0,0]);
    var elevation = map.getTerrain() ? map.queryTerrainElevation(ring[0]) || 0 : 0;
    var design = designs[houseDesignIndex(f.id, designs)];
    var plaster = design.wall;
    var timber=[0.29,0.18,0.13], glass=[0.23,0.36,0.40], stone=[0.55,0.51,0.44];
    function at(i,z,extra) {
      var p=corners[i], d=Math.hypot(p[0]-center[0],p[1]-center[1]);
      return [p[0]+extra*(p[0]-center[0])/d,p[1]+extra*(p[1]-center[1])/d,z];
    }
    // Corner: position, colour, outward normal and a window-light draw (0 for anything that is not glass).
    function tri(a,b,c,color,shade) {
      var u=[b[0]-a[0],b[1]-a[1],b[2]-a[2]], v=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
      var n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]], m=Math.hypot(n[0],n[1],n[2])||1;
      var out=(a[0]-center[0])*n[0]+(a[1]-center[1])*n[1]+(a[2]-height/2)*n[2]<0 ? -1/m : 1/m;
      var h=Math.sin(a[0]*12.9898+a[1]*78.233+a[2]*37.719)*43758.5453, emit=color===glass ? 0.02+0.96*(h-Math.floor(h)) : 0;
      [a,b,c].forEach(function(p) {
        vertices.push((site.x-origin.x+p[0]*unit)/origin.unit,(site.y-origin.y+p[1]*unit)/origin.unit,
          (p[2]+elevation)*unit/origin.unit,color[0]*shade,color[1]*shade,color[2]*shade,n[0]*out,n[1]*out,n[2]*out,emit);
      });
    }
    function quad(a,b,c,d,color,shade) {tri(a,b,c,color,shade);tri(a,c,d,color,shade);}
    function between(a,b,t) { return a.map(function(v,k){return v+(b[k]-v)*t;}); }
    var width=Math.min(lengths[0],lengths[1]), rise=Math.min(4,width*design.pitch);
    var ridge=[[3,0],[1,2]].map(function(pair) {
      var a=corners[pair[0]],b=corners[pair[1]],p=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      var inset=design.hip*Math.min(0.92,width/Math.max(lengths[0],lengths[1]));
      return [p[0]+(center[0]-p[0])*inset,p[1]+(center[1]-p[1])*inset,height+rise];
    });
    for(var i=0;i<4;i++) {
      var j=(i+1)%4,a=at(i,height,0.55),b=at(j,height,0.55);
      var dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
      var shade=0.87+0.12*((a[0]+b[0])/2-center[0])/Math.max(1,len/2);
      function panel(left,right,bottom,top,color,offset) {
        var l=at(i,0,offset),r=at(j,0,offset);
        function pt(t,z){return [l[0]+(r[0]-l[0])*t,l[1]+(r[1]-l[1])*t,z];}
        quad(pt(left,bottom),pt(right,bottom),pt(right,top),pt(left,top),color,shade);
      }
      panel(0,1,0,height,plaster,0.08);
      panel(0,1,0,0.55,stone,0.11);
      var floors=Math.max(1,Math.round(height/3.4)), bays=Math.max(2,Math.floor(len/3.2));
      var limestone=[0.84,0.80,0.71];
      if(design.name==='Brick stairwell block' && i%2===0){
        panel(0.41,0.59,0,height,limestone,0.13);
      }
      if(design.name==='Modernist walk-up'){
        for(var band=0;band<floors;band++){
          panel(0.04,0.96,(band+0.26)*height/floors,(band+0.82)*height/floors,[0.46,0.51,0.52],0.13);
        }
      }
      if(design.name==='Corniced city residence'){
        for(var course=1;course<=floors;course++){
          panel(0,1,course*height/floors-0.35,course*height/floors,limestone,0.48);
        }
      }
      if(design.name==='Timber frame'){
        for(var post=0;post<=bays;post++){
          var axis=post/bays;
          panel(Math.max(0,axis-0.09/len),Math.min(1,axis+0.09/len),0.55,height,timber,0.20);
        }
        for(var level=1;level<floors;level++) panel(0,1,level*height/floors-0.12,level*height/floors+0.12,timber,0.20);
      }
      if(design.name==='Brick cornice'){
        var brickRed=[0.61,0.32,0.23];
        panel(0,1,height-0.60,height-0.40,brickRed,0.28);
        for(var tooth=0;tooth<bays*3;tooth++){
          panel(tooth/(bays*3),(tooth+0.52)/(bays*3),height-0.81,height-0.60,brickRed,0.24);
        }
      }
      for(var floor=0;floor<floors;floor++) {
        var sill=(floor+0.30)*height/floors, lintel=(floor+0.78)*height/floors;
        for(var bay=0;bay<bays;bay++) {
          var t=(bay+0.5)/bays;
          if(i===0 && floor===0 && bay===Math.floor(bays/2)){
            panel(t-0.65/len,t+0.65/len,0,2.25,timber,0.18);
            panel(t-0.46/len,t+0.46/len,0.08,2.08,[0.47,0.28,0.17],0.22);
            continue;
          }
          panel(t-0.74/len,t+0.74/len,sill-0.10,lintel+0.10,timber,0.15);
          panel(t-0.59/len,t+0.59/len,sill,lintel,glass,0.19);
          panel(t-0.045/len,t+0.045/len,sill,lintel,timber,0.23);
          if(design.name==='Shuttered gable'){
            var shutter=[0.21,0.34,0.29];
            panel(t-1.14/len,t-0.76/len,sill,lintel,shutter,0.19);
            panel(t+0.76/len,t+1.14/len,sill,lintel,shutter,0.19);
          }
        }
      }
      quad(at(i,height-0.22,0.55),at(j,height-0.22,0.55),b,a,timber,shade);
      quad(at(i,height-0.22,0.08),at(j,height-0.22,0.08),at(j,height-0.22,0.55),at(i,height-0.22,0.55),timber,shade);
      var roof=design.roof, light=[1.04,0.90,0.84,0.97][i];
      if(i===0) quad(a,b,ridge[1],ridge[0],roof,light);
      if(i===2) quad(a,b,ridge[0],ridge[1],roof,light);
      if(i%2) tri(a,b,ridge[i===1?1:0],design.hip===0?plaster:roof,light);
      // Narrow fired-clay courses follow each sloping roof plane.
      var leftPeak=ridge[i===0||i===3?0:1],rightPeak=ridge[i<2?1:0];
      if(i%2===0 || design.hip>0){
        var rows=Math.max(4,Math.round(width*0.65));
        for(var row=1;row<rows;row++){
          var strip=[between(a,leftPeak,row/rows),between(b,rightPeak,row/rows),
            between(b,rightPeak,(row+0.12)/rows),between(a,leftPeak,(row+0.12)/rows)];
          strip.forEach(function(p){p[2]+=0.018;});
          quad(strip[0],strip[1],strip[2],strip[3],roof,light*0.84);
        }
      }
      if(i===0){
        // Frontage coordinates: positive depth points into the roof.
        var midpoint=between(a,b,0.5), inward=between(ridge[0],ridge[1],0.5);
        var reach=Math.hypot(inward[0]-midpoint[0],inward[1]-midpoint[1]);
        function front(along,depth,z){
          return [midpoint[0]+along*dx/len+depth*(inward[0]-midpoint[0])/reach,
            midpoint[1]+along*dy/len+depth*(inward[1]-midpoint[1])/reach,z];
        }
        if(design.name==='Ochre balcony flats' || design.name==='Gallery apartments'){
          var gallery=design.name==='Gallery apartments';
          var centers=gallery?[0]:[-len*0.25,len*0.25];
          var halfSpan=gallery?len*0.43:Math.min(2.4,len*0.17);
          for(var storey=1;storey<floors;storey++){
            var slab=storey*height/floors;
            centers.forEach(function(x){
              var left=x-halfSpan,right=x+halfSpan;
              quad(front(left,-1,slab),front(right,-1,slab),front(right,0.6,slab),front(left,0.6,slab),stone,1);
              quad(front(left,-1,slab-0.14),front(right,-1,slab-0.14),front(right,-1,slab+0.85),front(left,-1,slab+0.85),limestone,0.94);
              [left,right].forEach(function(end){
                quad(front(end,-1,slab),front(end,0.6,slab),front(end,0.6,slab+0.85),front(end,-1,slab+0.85),limestone,0.8);
              });
            });
          }
        }
        if(design.name==='Dormer cottage'){
          var start=reach*0.20,back=reach*0.72,base=height+rise*0.19,top=height+rise*0.58;
          var l=front(-1,start,base),r=front(1,start,base),lt=front(-1,start,top),rt=front(1,start,top);
          var peak=front(0,start,top+0.52),rear=front(0,back,top+0.52);
          quad(l,r,rt,lt,plaster,1);tri(lt,rt,peak,plaster,1);
          quad(lt,peak,rear,front(-1,back,top),roof,0.88);
          quad(peak,rt,front(1,back,top),rear,roof,1.06);
          tri(l,lt,front(-1,back,top),plaster,0.82);tri(r,rt,front(1,back,top),plaster,0.82);
          quad(front(-0.48,start-0.02,base+0.12),front(0.48,start-0.02,base+0.12),
            front(0.48,start-0.02,top-0.08),front(-0.48,start-0.02,top-0.08),glass,1);
        }
        if(design.name==='Wooden veranda'){
          var span=Math.min(3.5,len*0.36), outer=-1.05, inner=0.38, low=Math.min(2.7,height-0.5);
          quad(front(-span,outer,low),front(span,outer,low),front(span,inner,low+0.55),front(-span,inner,low+0.55),roof,1);
          quad(front(-span,outer,0.12),front(span,outer,0.12),front(span,inner,0.12),front(-span,inner,0.12),stone,1);
          [-span+0.12,span-0.12].forEach(function(x){
            quad(front(x-0.09,outer,0.1),front(x+0.09,outer,0.1),front(x+0.09,outer,low),front(x-0.09,outer,low),timber,1);
            quad(front(x+0.09,outer,0.1),front(x+0.09,outer+0.18,0.1),front(x+0.09,outer+0.18,low),front(x+0.09,outer,low),timber,0.86);
          });
        }
      }
    }
    var cx=(center[0]+ridge[0][0])/2,cy=(center[1]+ridge[0][1])/2;
    var cap=height+rise+1.05;
    var chimney=[[-0.36,-0.30],[0.36,-0.30],[0.36,0.30],[-0.36,0.30]];
    function brick(i,z){return [cx+chimney[i][0],cy+chimney[i][1],z];}
    chimney.forEach(function(_,i){var j=(i+1)%4;quad(brick(i,height),brick(j,height),brick(j,cap),brick(i,cap),[0.58,0.30,0.22],0.84+0.05*i);});
    quad(brick(0,cap),brick(1,cap),brick(2,cap),brick(3,cap),timber,1);
    return true;
  }

  function sameBuildingKeys(previous, current) {
    if (!previous || previous.size !== current.size) return false;
    for (var key of current) if (!previous.has(key)) return false;
    return true;
  }

  // `canopy` is a fixed-model source (metro roofs, landmarks): { suffix, minZoom, visible(bounds), vertices(map, origin, visible) }.
  // A source with awake() decides for itself whether it is drawn; the others follow the building layer's visibility.
  function bulgarianHouseLayer(materialLayer, sourceId, canopy) {
    var map, program, buffer, matrixLoc, anchorLoc, position, color, normal, emitLoc, lightLocs, shadowProgram, origin;
    var dirty=true, count=0, lastBuild=0, terrain, view, built=-1, asleep=false;
    var previousKeys = null, meshCache = new Map();
    function moved(){ if (canopy) dirty=true; else view.cameraMoved(); }
    function resized(){ if (canopy) dirty=true; else view.invalidate(); }
    function resetGeometry(){previousKeys=null;meshCache.clear();dirty=true;}
    function sourceChanged(event){
      var dem = map.getTerrain();
      if (dem && event.sourceId === dem.source) resetGeometry();
      else if (event.sourceId === sourceId && !canopy) view.invalidate();
    }
    function rebuild(){
      var center = maplibregl.MercatorCoordinate.fromLngLat(map.getCenter());
      if (!origin || Math.hypot(center.x-origin.x,center.y-origin.y)>0.001) {
        origin=center;
        origin.unit=origin.meterInMercatorCoordinateUnits();
        resetGeometry();
      }
      if (canopy) {
        var sections = canopy.visible(map.getBounds());
        if (sameBuildingKeys(previousKeys, sections)) return null;
        previousKeys=sections;
        return canopy.vertices(map, origin, sections);
      }
      var seen=new Set(), usedIds=new Set(), meshes=[], size=0;
      view.features.forEach(function(f){
        var material=f.properties.material;
        if ((material!=='green' && material!=='purple') || usedIds.has(f.id)) return;
        var shape=f.geometry, polygons=shape.type==='Polygon' ? [shape.coordinates] : shape.coordinates;
        var key=f.id+'/'+f.properties.render_height+'/'+f.properties.render_min_height+'/'+polygons.map(footprintKey).join('|');
        if (!meshCache.has(key)) {
          var vertices=[];
          meshCache.set(key,bulgarianHouse(f,vertices,origin,map) ? new Float32Array(vertices) : null);
        }
        seen.add(key);
        var mesh=meshCache.get(key);
        if (mesh) { usedIds.add(f.id); meshes.push(mesh); size+=mesh.length; }
      });
      if (sameBuildingKeys(previousKeys,seen)) return null;
      previousKeys=seen;
      meshCache.forEach(function(_,key){if (!seen.has(key)) meshCache.delete(key);});
      var data=new Float32Array(size), offset=0;
      meshes.forEach(function(mesh){data.set(mesh,offset);offset+=mesh.length;});
      return data;
    }
    return {
      id:materialLayer+(canopy ? canopy.suffix : '-houses'),type:'custom',renderingMode:'3d',
      refresh:function(){dirty=true;},   // the fixed-model source changed what it shows
      onAdd:function(owner,gl){
        map=owner;
        if (!canopy) { view=buildingView(map,materialLayer); view.invalidate(); }
        program=gl.createProgram();
        function attach(type,source){
          var shader=gl.createShader(type);
          gl.shaderSource(shader,source);gl.compileShader(shader);
          if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
          gl.attachShader(program,shader);gl.deleteShader(shader);
        }
        attach(gl.VERTEX_SHADER,'attribute vec3 pos,rgb,nrm; attribute float emit; uniform vec4 anchor; uniform mat4 offsetMatrix; uniform vec3 sunDir,sunColor,ambient; varying vec3 tint; varying float lampOn; void main(){gl_Position=anchor+offsetMatrix*vec4(pos,0.0);tint=rgb*(ambient+sunColor*max(dot(nrm,sunDir),0.0));lampOn=emit;}');
        attach(gl.FRAGMENT_SHADER,'precision mediump float; varying vec3 tint; varying float lampOn; uniform float lit; void main(){float on=step(0.001,lampOn)*step(lampOn,lit);gl_FragColor=vec4(mix(tint,vec3(1.0,0.76,0.42)*(0.7+0.5*fract(lampOn*57.3)),0.9*on),1.0);}');
        gl.linkProgram(program);
        if(!gl.getProgramParameter(program,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
        position=gl.getAttribLocation(program,'pos');color=gl.getAttribLocation(program,'rgb');normal=gl.getAttribLocation(program,'nrm');emitLoc=gl.getAttribLocation(program,'emit');
        lightLocs=['sunDir','sunColor','ambient','lit'].map(function(k){return gl.getUniformLocation(program,k);});
        matrixLoc=gl.getUniformLocation(program,'offsetMatrix');anchorLoc=gl.getUniformLocation(program,'anchor');
        buffer=gl.createBuffer();
        try { shadowProgram=shadows.create(gl); } catch (e) { console.warn('3D shadows failed:', e); }
        map.on('move',moved);map.on('resize',resized);map.on('sourcedata',sourceChanged);map.on('terrain',resetGeometry);
      },
      render:function(gl,matrix){
        if(map.getZoom()<(canopy ? canopy.minZoom : 15) /* app zoom 16 */ || (canopy && canopy.awake ? !canopy.awake() : map.getLayoutProperty(materialLayer,'visibility')==='none')){
          asleep=true;return;
        }
        if (asleep) { asleep=false; dirty=true; if (view) view.invalidate(); }
        gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
        var now=performance.now(),currentTerrain=!!map.getTerrain();
        // The shared query decides when the visible buildings may have changed.
        var version = view ? view.refresh(now) : built;
        var due = dirty || version!==built;
        var free = !view || now-view.queriedAt>=30;   // walls take the frame after a query
        if((due && free && now-lastBuild>200) || terrain!==currentTerrain){
          if (terrain!==currentTerrain) resetGeometry();
          var data = rebuild();
          if (data !== null) {
            count = data.length / 10;
            gl.bufferData(gl.ARRAY_BUFFER,data,gl.DYNAMIC_DRAW);
          }
          lastBuild=now;dirty=false;terrain=currentTerrain;built=version;
        } else if(due) map.triggerRepaint();
        if(!count)return;
        gl.useProgram(program);gl.disable(gl.CULL_FACE);gl.enable(gl.DEPTH_TEST);gl.depthMask(true);
        var anchor=[0,1,2,3].map(function(i){return matrix[i]*origin.x+matrix[i+4]*origin.y+matrix[i+12];});
        gl.uniform4fv(anchorLoc,anchor);
        gl.uniformMatrix4fv(matrixLoc,false,Float32Array.from(matrix,function(v){return v*origin.unit;}));
        var light=daylight.lighting();
        gl.uniform3fv(lightLocs[0],light.dir);gl.uniform3fv(lightLocs[1],light.color);gl.uniform3fv(lightLocs[2],light.ambient);gl.uniform1f(lightLocs[3],light.lit);
        [position,color,normal,emitLoc].forEach(function(a){gl.enableVertexAttribArray(a);});
        gl.vertexAttribPointer(position,3,gl.FLOAT,false,40,0);gl.vertexAttribPointer(color,3,gl.FLOAT,false,40,12);
        gl.vertexAttribPointer(normal,3,gl.FLOAT,false,40,24);gl.vertexAttribPointer(emitLoc,1,gl.FLOAT,false,40,36);
        gl.drawArrays(gl.TRIANGLES,0,count);
        [position,color,normal,emitLoc].forEach(function(a){gl.disableVertexAttribArray(a);});
        shadows.pass(gl,shadowProgram,map,anchor,Float32Array.from(matrix,function(v){return v*origin.unit;}),40,function(){gl.drawArrays(gl.TRIANGLES,0,count);});
      },
      onRemove:function(owner,gl){
        owner.off('move',moved);owner.off('resize',resized);owner.off('sourcedata',sourceChanged);owner.off('terrain',resetGeometry);
        gl.deleteBuffer(buffer);gl.deleteProgram(program);if(shadowProgram)gl.deleteProgram(shadowProgram.program);
      }
    };
  }

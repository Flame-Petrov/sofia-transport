  // Ground shadows for the day and night cycle. MapLibre has none, so each custom layer draws its own
  // triangles again, flattened onto the ground along the light direction: a point at height h moves
  // by h * reach away from the sun. The reach is the true shadow length (1 / tan altitude) up to 1.5
  // heights and eases toward 3 heights below that, so a low sun does not smear shadows across the map.
  // The stencil keeps overlapping triangles to one layer of darkness. Only with the cycle on, on flat ground, and only while the sun or moon gives direct light.
  var shadows = (function () {
    var VERTEX = 'attribute vec3 pos; uniform vec4 anchor; uniform mat4 offsets; uniform vec2 reach;' +
      'void main(){vec3 p=pos; p.xy-=reach*p.z; gl_Position=anchor+offsets*vec4(p.xy,0.,0.);}';
    var FRAGMENT = 'precision mediump float; uniform float strength; void main(){gl_FragColor=vec4(0.,0.,0.,strength);}';
    function strength(map) {
      if (!daylight.enabled() || (map && map.getTerrain && map.getTerrain())) return 0;
      var s = daylight.lighting().color[1] * 1.1;
      return s < 0.02 ? 0 : Math.min(0.42, s);
    }
    // East and south ground offset per unit of height, away from the light.
    var KNEE = 1.5, LIMIT = 3;
    function reach() {
      var d = daylight.lighting().dir, flat = Math.hypot(d[0], d[1]);
      if (!flat) return [0, 0];
      var raw = flat / Math.max(d[2], 1e-3);
      var len = raw <= KNEE ? raw : KNEE + (LIMIT - KNEE) * (1 - Math.exp(-(raw - KNEE) / (LIMIT - KNEE)));
      return [d[0] / flat * len, d[1] / flat * len];
    }
    function compile(gl) {
      var program = gl.createProgram();
      [[gl.VERTEX_SHADER, VERTEX], [gl.FRAGMENT_SHADER, FRAGMENT]].forEach(function (pair) {
        var shader = gl.createShader(pair[0]);
        gl.shaderSource(shader, pair[1]); gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader); gl.deleteShader(shader);
      });
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(program));
      var loc = { pos: gl.getAttribLocation(program, 'pos') };
      ['anchor', 'offsets', 'reach', 'strength'].forEach(function (k) { loc[k] = gl.getUniformLocation(program, k); });
      return { program: program, loc: loc };
    }
    // Begin and end a shadow pass: blending, a clean stencil, no depth writes.
    function begin(gl) {
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false); gl.enable(gl.DEPTH_TEST);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1, 1);
      gl.enable(gl.STENCIL_TEST); gl.stencilMask(0xFF); gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT);
      gl.stencilFunc(gl.EQUAL, 0, 0xFF); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
    }
    function end(gl) {
      gl.disable(gl.STENCIL_TEST); gl.stencilMask(0xFF); gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.depthMask(true);
    }
    // Draw one layer's buffer (already bound) as shadows. `draw` issues the layer's drawArrays calls.
    function pass(gl, sp, map, anchor, offsets, stride, draw) {
      var k = strength(map);
      if (!k || !sp) return;
      gl.useProgram(sp.program);
      gl.uniform4fv(sp.loc.anchor, anchor); gl.uniformMatrix4fv(sp.loc.offsets, false, offsets);
      gl.uniform2fv(sp.loc.reach, reach()); gl.uniform1f(sp.loc.strength, k);
      begin(gl);
      gl.enableVertexAttribArray(sp.loc.pos);
      gl.vertexAttribPointer(sp.loc.pos, 3, gl.FLOAT, false, stride, 0);
      draw();
      gl.disableVertexAttribArray(sp.loc.pos);
      end(gl);
    }
    return { create: compile, pass: pass, strength: strength, reach: reach, begin: begin, end: end };
  })();

  // Façade styles for the textured 3D walls. Every style paints three small sheets, each two
  // window bays wide: a ground floor, two repeating middle floors and a top floor with its
  // cornice or parapet. Wall pixels are grey detail at alpha 255 and take the building's tint
  // in the shader. Glass, frames and doors keep their own colour at alpha 0.
  var facadeStyles = (function () {
    var CELL = 64;
    var WHITE = [232, 229, 222], DARK = [62, 64, 68], GLASS = [74, 86, 100];
    var CONCRETE = [204, 199, 189], IRON = [58, 58, 60];

    function sheet(floors) {
      var image = new ImageData(2 * CELL, floors * CELL), data = image.data, w = image.width, h = image.height;
      return {
        image: image, floors: floors,
        // A rectangle clipped to cell (bay, floor), measured from the cell's bottom-left corner.
        // Row 0 of the image is the bottom of the wall, matching the wall's v coordinate.
        box: function (bay, floor, x, y, bw, bh, paint, alpha) {
          var wall = typeof paint === 'number';
          var x0 = bay * CELL + Math.max(0, x), x1 = bay * CELL + Math.min(CELL, x + bw);
          var y0 = floor * CELL + Math.max(0, y), y1 = floor * CELL + Math.min(CELL, y + bh);
          for (var py = y0; py < y1; py++) {
            for (var px = x0; px < x1; px++) {
              var o = (py * w + px) * 4;
              data[o] = wall ? paint : paint[0]; data[o + 1] = wall ? paint : paint[1];
              data[o + 2] = wall ? paint : paint[2]; data[o + 3] = wall ? 255 : alpha || 0;
            }
          }
        },
        // Fine plaster grain on wall pixels, so large tinted areas are never perfectly flat.
        grain: function (amount) {
          for (var py = 0; py < h; py++) {
            for (var px = 0; px < w; px++) {
              var o = (py * w + px) * 4;
              if (data[o + 3] !== 255) continue;
              var n = (((px * 73856093) ^ (py * 19349663)) >>> 0) % (2 * amount + 1) - amount;
              data[o] += n; data[o + 1] += n; data[o + 2] += n;
            }
          }
        }
      };
    }

    function cells(p, paint) {
      for (var f = 0; f < p.floors; f++) for (var b = 0; b < 2; b++) paint(b, f);
    }
    function noise(a, b) { return (((a * 73856093) ^ (b * 19349663)) >>> 0) % 97 / 96; }

    // Framed glazing with a sky gradient, optional glazing bars and a sill.
    function pane(p, b, f, x, y, w, h, o) {
      o = o || {};
      var frame = o.frame || WHITE, glass = o.glass || GLASS, t = o.t == null ? 2 : o.t, c, r;
      if (o.sill) p.box(b, f, x - 2, y - 2, w + 4, 2, o.sill === true ? CONCRETE : o.sill);
      p.box(b, f, x, y, w, h, frame);
      var gh = h - 2 * t;
      for (r = 0; r < gh; r++) {
        var k = r / gh;
        p.box(b, f, x + t, y + t + r, w - 2 * t, 1, [glass[0] + k * 26, glass[1] + k * 28, glass[2] + k * 30], o.alpha);
      }
      for (c = 1; c < (o.cols || 1); c++) p.box(b, f, x + Math.round(c * w / o.cols), y + t, 1, gh, frame);
      for (r = 1; r < (o.rows || 1); r++) p.box(b, f, x + t, y + Math.round(r * h / o.rows), w - 2 * t, 1, frame);
    }
    // A window or door with a round head.
    function arch(p, b, f, x, y, w, h, fill, surround) {
      var radius = w / 2;
      function shape(px, py, pw, ph, paint) {
        var r = pw / 2;
        p.box(b, f, px, py, pw, ph - r, paint);
        for (var d = 0; d < r; d++) {
          var half = Math.round(Math.sqrt(r * r - d * d));
          p.box(b, f, px + r - half, py + ph - r + d, 2 * half, 1, paint);
        }
      }
      if (surround) shape(x - 3, y, w + 6, h + 3, surround);
      shape(x, y, w, h, fill);
      return radius;
    }
    function railing(p, b, f, x, y, w, h) {
      p.box(b, f, x, y + h - 1, w, 1, IRON);
      for (var i = 0; i < w; i += 3) p.box(b, f, x + i, y, 1, h, IRON);
    }
    function shutters(p, b, f, x, y, w, h, wood) {
      p.box(b, f, x - 6, y, 5, h, wood); p.box(b, f, x + w + 1, y, 5, h, wood);
      for (var i = 2; i < h; i += 4) { p.box(b, f, x - 6, y + i, 5, 1, [wood[0] - 22, wood[1] - 18, wood[2] - 14]); p.box(b, f, x + w + 1, y + i, 5, 1, [wood[0] - 22, wood[1] - 18, wood[2] - 14]); }
    }
    function bricks(p, b, f) {
      p.box(b, f, 0, 0, CELL, CELL, 206);
      for (var course = 0; course < 13; course++) {
        for (var k = -1; k < 7; k++) {
          var x = k * 10 + (course % 2) * 5;
          p.box(b, f, x + 1, course * 5 + 1, 9, 4, 226 + Math.round(noise(course + f * 13, k + b * 7) * 22));
        }
      }
    }
    function ashlar(p, b, f, joint) {
      p.box(b, f, 0, 0, CELL, CELL, joint);
      for (var course = 0; course < 4; course++) {
        for (var k = -1; k < 3; k++) {
          var x = k * 32 + (course % 2) * 16;
          p.box(b, f, x + 1, course * 16 + 1, 31, 15, 226 + Math.round(noise(course + f * 4 + 3, k + b * 2 + 5) * 24));
        }
      }
    }
    function ribs(p, b, f) {
      for (var x = 0; x < CELL; x += 4) { p.box(b, f, x, 0, 2, CELL, 242); p.box(b, f, x + 2, 0, 2, CELL, 224); }
    }

    var painters = {
      // Rendered masonry with sash windows: the default city building.
      plaster: function (g, m, t) {
        function floor(p, b, f) {
          p.box(b, f, 0, 0, CELL, CELL, 238); p.box(b, f, 0, 0, CELL, 2, 220);
          p.box(b, f, 18, 51, 28, 3, 250); p.box(b, f, 18, 50, 28, 1, 212);
          pane(p, b, f, 21, 16, 22, 34, { cols: 2, rows: 3, sill: true });
        }
        cells(m, function (b, f) { floor(m, b, f); if (b === 1 && f === 1) railing(m, b, f, 19, 14, 26, 14); });
        cells(g, function (b) {
          g.box(b, 0, 0, 0, CELL, CELL, 232); g.box(b, 0, 0, 0, CELL, 10, 194);
          g.box(b, 0, 0, 58, CELL, 2, 206); g.box(b, 0, 0, 60, CELL, 4, 250);
          if (b === 0) {
            g.box(b, 0, 20, 0, 24, 50, WHITE); g.box(b, 0, 23, 0, 18, 36, [96, 72, 54]);
            g.box(b, 0, 31, 0, 1, 36, [70, 52, 40]); pane(g, b, 0, 23, 38, 18, 10, { t: 1, cols: 2 });
          } else {
            g.box(b, 0, 6, 48, 52, 5, 204);
            pane(g, b, 0, 8, 12, 48, 34, { frame: [78, 72, 66], cols: 3 });
          }
        });
        cells(t, function (b) {
          floor(t, b, 0);
          t.box(b, 0, 0, 53, CELL, 2, 198); t.box(b, 0, 0, 55, CELL, 9, 252); t.box(b, 0, 0, 59, CELL, 1, 226);
        });
      },
      // Prefabricated panel block with visible joints and loggias.
      panel: function (g, m, t) {
        function floor(p, b, f, glazed) {
          p.box(b, f, 0, 0, CELL, CELL, 236); p.box(b, f, 0, 0, 1, CELL, 198); p.box(b, f, 0, 0, CELL, 2, 198);
          if (b === 0) pane(p, b, f, 12, 20, 40, 28, { frame: [228, 228, 224], cols: 3, sill: true });
          else {
            p.box(b, f, 8, 8, 48, 46, [72, 76, 84]); p.box(b, f, 14, 28, 36, 22, [98, 106, 116]);
            if (glazed) pane(p, b, f, 8, 26, 48, 28, { frame: [214, 214, 208], cols: 4, glass: [92, 104, 116] });
            p.box(b, f, 8, 8, 48, 18, 214); p.box(b, f, 8, 25, 48, 1, 190);
          }
        }
        cells(m, function (b, f) { floor(m, b, f, f === 1); });
        cells(g, function (b) {
          g.box(b, 0, 0, 0, CELL, CELL, 226); g.box(b, 0, 0, 0, 1, CELL, 196); g.box(b, 0, 0, 0, CELL, 14, 178);
          if (b === 0) pane(g, b, 0, 16, 26, 32, 22, { frame: [228, 228, 224], cols: 2, sill: true });
          else {
            g.box(b, 0, 10, 44, 44, 4, [150, 150, 148]);
            pane(g, b, 0, 20, 0, 24, 42, { frame: [80, 80, 84], cols: 2, glass: [70, 80, 92] });
          }
        });
        cells(t, function (b) {
          floor(t, b, 0, false);
          t.box(b, 0, 0, 55, CELL, 1, 188); t.box(b, 0, 0, 56, CELL, 6, 224); t.box(b, 0, 0, 62, CELL, 2, [120, 120, 122]);
        });
      },
      // Brick cooperative with concrete lintels.
      brick: function (g, m, t) {
        function floor(p, b, f) {
          bricks(p, b, f);
          p.box(b, f, 19, 48, 26, 4, CONCRETE);
          pane(p, b, f, 22, 16, 20, 32, { cols: 2, rows: 2, sill: true });
        }
        cells(m, function (b, f) {
          floor(m, b, f);
          if (b === 1 && f === 0) { m.box(b, f, 12, 11, 40, 3, [190, 186, 178]); railing(m, b, f, 12, 14, 40, 15); }
        });
        cells(g, function (b) {
          bricks(g, b, 0); g.box(b, 0, 0, 0, CELL, 11, [150, 144, 136]);
          if (b === 0) {
            g.box(b, 0, 20, 0, 24, 48, CONCRETE); g.box(b, 0, 23, 0, 18, 44, [84, 62, 48]);
            pane(g, b, 0, 26, 28, 12, 12, { t: 1, frame: [84, 62, 48] });
          } else {
            g.box(b, 0, 19, 48, 26, 4, CONCRETE);
            pane(g, b, 0, 22, 20, 20, 28, { cols: 2, sill: true });
          }
        });
        cells(t, function (b) {
          floor(t, b, 0);
          t.box(b, 0, 0, 54, CELL, 2, 200);
          for (var x = 0; x < CELL; x += 8) t.box(b, 0, x, 56, 5, 3, 232);
          t.box(b, 0, 0, 59, CELL, 5, CONCRETE);
        });
      },
      // Recent residential block: smooth render, dark frames and glass balconies.
      modern: function (g, m, t) {
        function floor(p, b, f) {
          p.box(b, f, 0, 0, CELL, CELL, 244); p.box(b, f, 0, 0, CELL, 2, 208);
          if (b === 0) {
            var flip = f === 1;
            p.box(b, f, flip ? 10 : 40, 8, 14, 44, [98, 96, 94]);
            pane(p, b, f, flip ? 26 : 10, 8, 28, 44, { frame: DARK, cols: 2 });
          } else {
            pane(p, b, f, 8, 6, 48, 46, { frame: DARK, cols: 3 });
            p.box(b, f, 4, 5, 56, 18, [158, 178, 188]); p.box(b, f, 4, 22, 56, 1, [70, 72, 76]);
            p.box(b, f, 2, 2, 60, 3, [112, 112, 114]);
          }
        }
        cells(m, function (b, f) { floor(m, b, f); });
        cells(g, function (b) {
          g.box(b, 0, 0, 0, CELL, CELL, 214); g.box(b, 0, 0, 0, CELL, 4, [96, 96, 98]);
          g.box(b, 0, 0, 52, CELL, 12, 196);
          if (b === 0) pane(g, b, 0, 2, 4, 60, 44, { frame: DARK, cols: 3 });
          else pane(g, b, 0, 16, 0, 32, 46, { frame: DARK, cols: 2, glass: [84, 96, 108] });
        });
        cells(t, function (b) {
          floor(t, b, 0);
          t.box(b, 0, 0, 54, CELL, 3, 204); t.box(b, 0, 0, 57, CELL, 7, [92, 92, 96]);
        });
      },
      // Office with ribbon windows between rendered spandrels.
      office: function (g, m, t) {
        function floor(p, b, f) {
          p.box(b, f, 0, 0, CELL, CELL, 236); p.box(b, f, 0, 0, CELL, 1, 214);
          pane(p, b, f, 0, 20, CELL, 28, { frame: [84, 88, 94], t: 1, cols: 4, glass: [62, 78, 96] });
          p.box(b, f, 0, 20, 2, 28, [84, 88, 94]);
        }
        cells(m, function (b, f) { floor(m, b, f); });
        cells(g, function (b) {
          g.box(b, 0, 0, 0, CELL, CELL, 218); g.box(b, 0, 0, 54, CELL, 10, 230);
          pane(g, b, 0, 6, 2, 58, 50, { frame: DARK, cols: b ? 4 : 2, glass: [66, 80, 96] });
          g.box(b, 0, 0, 0, 6, 54, 206);
        });
        cells(t, function (b) {
          floor(t, b, 0);
          t.box(b, 0, 0, 54, CELL, 7, 228); t.box(b, 0, 0, 53, CELL, 1, 196); t.box(b, 0, 0, 61, CELL, 3, [128, 128, 130]);
        });
      },
      // Curtain wall. The glass is half tinted, so towers differ in hue.
      glass: function (g, m, t) {
        function floor(p, b, f) {
          for (var r = 0; r < CELL; r++) {
            var k = r / CELL, spandrel = r < 13;
            p.box(b, f, 0, r, CELL, 1, spandrel ? [128, 142, 156] : [176 + k * 34, 190 + k * 32, 204 + k * 30], 150);
          }
          p.box(b, f, 0, 0, CELL, 2, [60, 66, 74]); p.box(b, f, 0, 13, CELL, 1, [84, 92, 102]);
          p.box(b, f, 0, 0, 1, CELL, [60, 66, 74]); p.box(b, f, 32, 0, 1, CELL, [60, 66, 74]);
        }
        cells(m, function (b, f) { floor(m, b, f); });
        cells(g, function (b) {
          floor(g, b, 0);
          g.box(b, 0, 0, 0, CELL, 13, [150, 166, 182], 150); g.box(b, 0, 0, 0, CELL, 4, [70, 70, 74]);
          if (b === 1) pane(g, b, 0, 14, 4, 36, 44, { frame: [50, 54, 60], cols: 2, glass: [70, 86, 104] });
        });
        cells(t, function (b) { floor(t, b, 0); t.box(b, 0, 0, 56, CELL, 8, [84, 90, 98]); });
      },
      // Big-box shop: glazed ground floor under a coloured fascia, blank panels above.
      retail: function (g, m, t) {
        function floor(p, b, f) {
          p.box(b, f, 0, 0, CELL, CELL, 240); p.box(b, f, 0, 0, CELL, 1, 222);
          p.box(b, f, 0, 0, 1, CELL, 222); p.box(b, f, 32, 0, 1, CELL, 222);
        }
        cells(m, function (b, f) {
          floor(m, b, f);
          if (b === 0 && f === 1) pane(m, b, f, 6, 38, 52, 12, { frame: DARK, t: 1, cols: 4 });
        });
        cells(g, function (b) {
          g.box(b, 0, 0, 0, CELL, CELL, 236); g.box(b, 0, 0, 44, CELL, 14, 150); g.box(b, 0, 0, 43, CELL, 1, 120);
          pane(g, b, 0, 0, 4, CELL, 38, { frame: DARK, cols: b ? 4 : 2, glass: [80, 94, 108] });
          g.box(b, 0, 0, 0, CELL, 4, [110, 110, 112]);
        });
        cells(t, function (b) {
          floor(t, b, 0);
          t.box(b, 0, 0, 54, CELL, 4, 214); t.box(b, 0, 0, 58, CELL, 6, [100, 104, 110]);
        });
      },
      // Corrugated shed with a translucent strip and a roller door.
      industrial: function (g, m, t) {
        cells(m, function (b, f) {
          ribs(m, b, f);
          if (f === 1) {
            m.box(b, f, 0, 36, CELL, 14, [168, 180, 186]);
            for (var x = 0; x < CELL; x += 16) m.box(b, f, x, 36, 1, 14, [120, 128, 134]);
          }
        });
        cells(g, function (b) {
          ribs(g, b, 0); g.box(b, 0, 0, 0, CELL, 12, [156, 154, 150]);
          if (b === 1) {
            g.box(b, 0, 10, 0, 44, 50, [128, 134, 140]);
            for (var y = 3; y < 50; y += 4) g.box(b, 0, 10, y, 44, 1, [106, 112, 118]);
          } else g.box(b, 0, 26, 0, 13, 32, [90, 96, 104]);
        });
        cells(t, function (b) {
          ribs(t, b, 0); t.box(b, 0, 0, 57, CELL, 2, 200); t.box(b, 0, 0, 59, CELL, 5, [110, 114, 120]);
        });
      },
      // School, hospital or office of state: pilasters and large square windows.
      public: function (g, m, t) {
        function floor(p, b, f) {
          p.box(b, f, 0, 0, CELL, CELL, 240); p.box(b, f, 0, 0, 4, CELL, 222); p.box(b, f, 60, 0, 4, CELL, 222);
          p.box(b, f, 0, 0, CELL, 2, 216);
          pane(p, b, f, 10, 14, 44, 36, { cols: 3, rows: 2, sill: true });
        }
        cells(m, function (b, f) { floor(m, b, f); });
        cells(g, function (b) {
          g.box(b, 0, 0, 0, CELL, CELL, 230); g.box(b, 0, 0, 0, CELL, 10, 190);
          g.box(b, 0, 0, 0, 4, CELL, 214); g.box(b, 0, 60, 0, 4, CELL, 214);
          if (b === 0) pane(g, b, 0, 10, 18, 44, 32, { cols: 3, sill: true });
          else {
            g.box(b, 0, 12, 6, 40, 48, 252); g.box(b, 0, 8, 0, 48, 6, [172, 168, 160]);
            g.box(b, 0, 17, 6, 30, 38, [86, 70, 58]); g.box(b, 0, 31, 6, 1, 38, [60, 48, 40]);
            pane(g, b, 0, 17, 44, 30, 8, { t: 1, cols: 3 });
          }
        });
        cells(t, function (b) {
          floor(t, b, 0);
          t.box(b, 0, 0, 53, CELL, 2, 196); t.box(b, 0, 0, 55, CELL, 9, 252);
        });
      },
      // Garages and sheds: blank render over lift-up doors.
      garage: function (g, m, t) {
        cells(m, function (b, f) {
          m.box(b, f, 0, 0, CELL, CELL, 234);
          if (b === 0 && f === 1) pane(m, b, f, 22, 24, 20, 16, { cols: 2 });
        });
        cells(g, function (b) {
          var door = b ? [136, 100, 78] : [118, 114, 108];
          g.box(b, 0, 0, 0, CELL, CELL, 234); g.box(b, 0, 6, 0, 52, 47, 206); g.box(b, 0, 8, 0, 48, 45, door);
          for (var y = 5; y < 45; y += 6) g.box(b, 0, 8, y, 48, 1, [door[0] - 22, door[1] - 20, door[2] - 18]);
          g.box(b, 0, 0, 59, CELL, 5, [100, 96, 92]);
        });
        cells(t, function (b) {
          t.box(b, 0, 0, 0, CELL, CELL, 234);
          if (b === 1) pane(t, b, 0, 22, 22, 20, 16, { cols: 2 });
          t.box(b, 0, 0, 56, CELL, 3, 208); t.box(b, 0, 0, 59, CELL, 5, [100, 96, 92]);
        });
      },
      // Dressed stone for monuments.
      stone: function (g, m, t) {
        cells(m, function (b, f) {
          ashlar(m, b, f, 198);
          if (b === 0) arch(m, b, f, 22, 8, 20, 44, [66, 72, 82], 250);
        });
        cells(g, function (b) {
          ashlar(g, b, 0, 180); g.box(b, 0, 0, 0, CELL, 9, 202);
          if (b === 1) { arch(g, b, 0, 18, 0, 28, 52, [80, 60, 46], 250); g.box(b, 0, 31, 0, 1, 40, [56, 42, 34]); }
        });
        cells(t, function (b) {
          ashlar(t, b, 0, 198);
          t.box(b, 0, 0, 48, CELL, 1, 190); t.box(b, 0, 0, 49, CELL, 15, 250);
          for (var x = 0; x < CELL; x += 8) t.box(b, 0, x, 50, 4, 4, 214);
        });
      },
      // Church walls: smooth render, lancet windows and an arched portal.
      church: function (g, m, t) {
        cells(m, function (b, f) {
          m.box(b, f, 0, 0, CELL, CELL, 242);
          if (b === 0) arch(m, b, f, 26, 6, 12, 48, [64, 70, 84], 222);
          else if (f === 1) { arch(m, b, f, 23, 20, 18, 18, 222); arch(m, b, f, 26, 23, 12, 12, [64, 70, 84]); }
        });
        cells(g, function (b) {
          g.box(b, 0, 0, 0, CELL, CELL, 240); g.box(b, 0, 0, 0, CELL, 12, [176, 168, 154]);
          if (b === 0) { arch(g, b, 0, 20, 0, 24, 50, [82, 62, 48], 222); g.box(b, 0, 31, 0, 1, 38, [58, 44, 36]); }
          else arch(g, b, 0, 27, 22, 10, 30, [64, 70, 84], 222);
        });
        cells(t, function (b) {
          t.box(b, 0, 0, 0, CELL, CELL, 242);
          if (b === 0) arch(t, b, 0, 26, 6, 12, 40, [64, 70, 84], 222);
          t.box(b, 0, 0, 52, CELL, 2, 200); t.box(b, 0, 0, 54, CELL, 10, 252);
          for (var x = 2; x < CELL; x += 8) arch(t, b, 0, x, 54, 4, 6, 220);
        });
      },
      // Family house: few shuttered windows, a stone plinth and a timber eave.
      house: function (g, m, t) {
        var wood = [126, 92, 66];
        function win(p, b, f, x, y) { shutters(p, b, f, x, y, 18, 24, wood); pane(p, b, f, x, y, 18, 24, { cols: 2, sill: true }); }
        cells(m, function (b, f) { m.box(b, f, 0, 0, CELL, CELL, 242); if (b === f) win(m, b, f, 23, 18); });
        cells(g, function (b) {
          g.box(b, 0, 0, 0, CELL, CELL, 242); g.box(b, 0, 0, 0, CELL, 12, [158, 148, 134]);
          for (var x = b ? 0 : 8; x < CELL; x += 16) g.box(b, 0, x, 0, 1, 12, [128, 120, 108]);
          g.box(b, 0, 0, 6, CELL, 1, [128, 120, 108]);
          if (b === 0) { g.box(b, 0, 22, 2, 20, 44, WHITE); g.box(b, 0, 24, 2, 16, 40, [104, 74, 52]); pane(g, b, 0, 27, 26, 10, 12, { t: 1, frame: [104, 74, 52] }); }
          else win(g, b, 0, 23, 20);
        });
        cells(t, function (b) {
          t.box(b, 0, 0, 0, CELL, CELL, 242);
          if (b === 0) win(t, b, 0, 23, 14);
          t.box(b, 0, 0, 54, CELL, 4, 212); t.box(b, 0, 0, 58, CELL, 6, [108, 80, 58]);
        });
      }
    };

    // bay and floor are the nominal sizes in metres that one texture cell covers.
    var styles = [
      { name: 'plaster', bay: 3.2, floor: 3.3, tints: [[222,190,130],[236,224,196],[226,190,178],[238,218,160],[208,206,200],[196,214,196],[196,208,220],[236,200,168],[240,238,232],[208,160,140]] },
      { name: 'panel', bay: 3.6, floor: 3.1, tints: [[196,196,192],[214,204,186],[234,220,170],[200,220,190],[232,190,170],[190,208,224],[236,236,232],[178,176,170]] },
      { name: 'brick', bay: 3.2, floor: 3.3, tints: [[176,96,74],[150,84,66],[190,120,84],[206,178,128],[140,98,78],[168,110,92]] },
      { name: 'modern', bay: 3.6, floor: 3.2, tints: [[242,240,236],[122,124,128],[190,184,176],[224,208,184],[196,120,90],[228,228,224],[206,214,206]] },
      { name: 'office', bay: 3.2, floor: 3.6, tints: [[214,210,202],[180,184,188],[232,228,220],[160,150,140],[200,190,170]] },
      { name: 'glass', bay: 3, floor: 3.7, tints: [[150,180,205],[140,175,170],[175,165,150],[120,140,165],[185,195,205]] },
      { name: 'retail', bay: 6, floor: 4.5, tints: [[236,232,222],[222,200,150],[200,205,210],[226,178,150],[180,196,170],[214,120,96]] },
      { name: 'industrial', bay: 5, floor: 4.5, tints: [[190,196,200],[170,180,170],[206,200,186],[150,160,175],[196,176,160],[220,220,216]] },
      { name: 'public', bay: 3.6, floor: 3.7, tints: [[232,214,170],[226,206,190],[214,214,206],[238,228,206],[206,186,160]] },
      { name: 'garage', bay: 3.2, floor: 2.8, tints: [[186,182,176],[200,190,170],[170,170,172],[196,180,166]] },
      { name: 'stone', bay: 4, floor: 4.5, tints: [[226,212,180],[214,204,186],[232,222,198]] },
      { name: 'church', bay: 4.5, floor: 4.5, tints: [[232,222,200],[222,200,160],[238,234,226],[214,190,170]] },
      { name: 'house', bay: 3.4, floor: 3, tints: [[240,232,214],[234,214,170],[226,196,176],[214,222,206],[244,244,238],[220,200,160],[208,178,150]] }
    ];
    var names = styles.map(function (s) { return s.name; });
    // Styles the prepared tiles do not name fall back on the four broad classes.
    var legacy = { gold: ['stone'], blue: ['glass', 'panel'], purple: ['panel', 'office', 'public'], green: ['plaster', 'brick', 'modern'] };
    var sheets = [];

    function images(index) {
      if (!sheets[index]) {
        var g = sheet(1), m = sheet(2), t = sheet(1);
        painters[styles[index].name](g, m, t);
        [g, m, t].forEach(function (p) { p.grain(styles[index].name === 'garage' ? 5 : 2); });
        sheets[index] = { ground: g.image, middle: m.image, crown: t.image };
      }
      return sheets[index];
    }

    function scramble(seed) {
      var h = Math.imul((seed | 0) + 0x9e3779b9, 0x85ebca6b);
      h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
      return (h ^ (h >>> 16)) >>> 0;
    }

    // The style, seed and wall colour of one footprint. Prepared tiles store a seed only for
    // parts of a larger building; other footprints derive it from their ID. `spot` seeds
    // street tiles, whose features merge many buildings under one ID.
    function look(properties, id, classified, spot) {
      var seed = properties.seed != null ? Number(properties.seed) :
        spot ? scramble(Math.round(spot[0] * 1e5) + scramble(Math.round(spot[1] * 1e5))) % 1000 :
        Math.floor(Math.abs(Number(id) || 0) / 10) % 1000;
      var h = scramble(seed), index = 0;
      if (classified) {
        index = names.indexOf(properties.style);
        if (index < 0) {
          var choices = legacy[properties.material] || legacy.green;
          index = names.indexOf(choices[(h >>> 20) % choices.length]);
        }
      }
      var style = styles[index], tint = style.tints[h % style.tints.length];
      var tagged = classified && /^#[0-9a-f]{6}$/i.test(properties.wall || '') ? properties.wall : null;
      if (tagged) tint = [1, 3, 5].map(function (i) { return parseInt(tagged.substr(i, 2), 16); });
      // A slight brightness shift separates neighbours that drew the same tint.
      var shift = tagged ? 1 : 0.94 + ((h >>> 8) % 13) / 100;
      var rgb = tint.map(function (c) { return Math.max(0, Math.min(255, Math.round(c * shift))); });
      return { style: index, seed: seed % 256, color: rgb[0] * 65536 + rgb[1] * 256 + rgb[2] };
    }

    // One bay of a style in a given tint, for previews and the model catalog.
    function swatch(name, tint, size) {
      var index = names.indexOf(name), source = images(index).middle, out = new ImageData(size, size);
      var step = CELL / size;
      for (var y = 0; y < size; y++) {
        for (var x = 0; x < size; x++) {
          var sum = [0, 0, 0];
          for (var dy = 0; dy < step; dy++) {
            for (var dx = 0; dx < step; dx++) {
              var o = (((size - 1 - y) * step + dy) * source.width + x * step + dx) * 4, a = source.data[o + 3] / 255;
              for (var c = 0; c < 3; c++) sum[c] += source.data[o + c] * (1 - a + a * tint[c] / 255);
            }
          }
          for (c = 0; c < 3; c++) out.data[(y * size + x) * 4 + c] = sum[c] / (step * step);
          out.data[(y * size + x) * 4 + 3] = 255;
        }
      }
      return out;
    }

    return { styles: styles, names: names, images: images, look: look, swatch: swatch };
  })();

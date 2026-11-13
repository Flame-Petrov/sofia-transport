"""Write src/features/view3d/tree-tiles.js: every tree the 3D view draws, packed per zoom-14 tile.

Usage (Python with osmium, shapely and numpy, e.g. the venv in old/osm-work):
    python tools/tree_data.py PATH/TO/Sofia.osm.pbf

Three sources, in this order of trust:
  1. Mapped trees (natural=tree). The species, genus or leaf type picks the model; a mapped height wins.
  2. Tree rows (natural=tree_row): a tree every ROW_SPACING metres along the way.
  3. Parks, woods and forests: a jittered grid thinned by low-frequency noise, so groves and glades alternate.
     Buildings, roads and paths, water, railways, pitches, playgrounds and car parks are kept clear, and
     no filled tree stands within 5 m of a mapped one. Woods and forests are filled only within FOREST_RADIUS
     of the centre, so Vitosha's forest is not packed into the page.

A tile is binary, gzipped and base64-encoded. It holds 16 cells (4 x 4, about 450 m square), each sorted
by its trees: a header of 16 little-endian uint32 cell counts, then three columns for all its trees in cell
order: uint16 x and uint16 y within the tile (0..65535 west to east and north to south) and one byte of
kind (high 4 bits) and height step (low 4 bits; height = 3 + 1.6 * step metres).
"""
import base64, gzip, json, math, struct, sys
from pathlib import Path

import numpy as np
import osmium
import shapely
from shapely import wkb
from shapely.geometry import LineString, Point
from shapely.strtree import STRtree

SITE = Path(__file__).resolve().parent.parent
OUT = SITE / "src/features/view3d/tree-tiles.js"
CENTRE = (23.3219, 42.6977)
KX, KY = 111320 * math.cos(math.radians(CENTRE[1])), 110574
Z = 14
ROW_SPACING = 8
FOREST_RADIUS = 7500   # metres from the centre; woods beyond it stay as the basemap draws them
KINDS = ["broad", "conifer", "pine", "poplar", "thuja", "birch", "willow", "small"]
K = {name: i for i, name in enumerate(KINDS)}
# Typical heights (metres) by kind: a fill tree takes a value between the two.
HEIGHTS = {"broad": (9, 18), "conifer": (9, 20), "pine": (10, 19), "poplar": (14, 24), "thuja": (5, 10),
           "birch": (9, 15), "willow": (8, 13), "small": (4, 7)}
GENUS = {
    "Populus": "poplar", "Betula": "birch", "Salix": "willow", "Thuja": "thuja", "Cupressus": "thuja", "Juniperus": "thuja",
    "Chamaecyparis": "thuja", "Taxus": "thuja", "Pinus": "pine", "Picea": "conifer", "Abies": "conifer", "Cedrus": "conifer",
    "Sequoiadendron": "conifer", "Larix": "conifer", "Pseudotsuga": "conifer", "Prunus": "small", "Malus": "small",
    "Pyrus": "small", "Cercis": "small", "Magnolia": "small", "Ficus": "small", "Morus": "small", "Catalpa": "small",
}


def local(lon, lat):
    return (lon - CENTRE[0]) * KX, (lat - CENTRE[1]) * KY


def kind_of(tags):
    genus = (tags.get("genus") or tags.get("species", "").split(" ")[0] or "").strip().capitalize()
    if genus in GENUS:
        return GENUS[genus]
    if tags.get("leaf_type") == "needleleaved":
        return "conifer"
    return "broad"


def rand(*keys):
    """A repeatable number in [0, 1) from integers."""
    h = 2166136261
    for k in keys:
        h = ((h ^ (int(k) & 0xFFFFFFFF)) * 16777619) & 0xFFFFFFFF
    h ^= h >> 13
    h = (h * 0x5BD1E995) & 0xFFFFFFFF
    h ^= h >> 15
    return h / 2 ** 32


def noise(x, y, scale):
    """Smooth value noise in [0, 1) on a grid of `scale` metres."""
    gx, gy = x / scale, y / scale
    x0, y0 = np.floor(gx).astype(np.int64), np.floor(gy).astype(np.int64)
    fx, fy = gx - x0, gy - y0
    fx, fy = fx * fx * (3 - 2 * fx), fy * fy * (3 - 2 * fy)
    def corner(a, b):
        h = (a * 374761393 + b * 668265263) & 0xFFFFFFFF
        h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
        return (h & 0xFFFF) / 65536
    c00, c10, c01, c11 = corner(x0, y0), corner(x0 + 1, y0), corner(x0, y0 + 1), corner(x0 + 1, y0 + 1)
    return (c00 * (1 - fx) + c10 * fx) * (1 - fy) + (c01 * (1 - fx) + c11 * fx) * fy


ROAD_WIDTH = {"motorway": 14, "trunk": 13, "primary": 12, "secondary": 11, "tertiary": 9, "unclassified": 7,
              "residential": 7, "service": 5, "living_street": 6, "pedestrian": 6, "track": 3.5, "footway": 3,
              "path": 2.5, "cycleway": 3, "steps": 3, "bridleway": 3}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    factory = osmium.geom.WKBFactory()
    mapped, rows, areas, clear = [], [], [], []
    for o in osmium.FileProcessor(sys.argv[1]).with_areas().with_locations():
        t = o.tags
        if o.is_node():
            if t.get("natural") == "tree" and o.location.valid():
                mapped.append((*local(o.location.lon, o.location.lat), kind_of(t), t.get("height"), o.id))
            continue
        if o.is_way():
            h = t.get("highway")
            if t.get("natural") == "tree_row":
                rows.append((LineString([local(n.lon, n.lat) for n in o.nodes]), kind_of(t), o.id))
            elif h in ROAD_WIDTH and t.get("tunnel") not in ("yes",) and t.get("layer", "0") in ("0", "-0", ""):
                clear.append(LineString([local(n.lon, n.lat) for n in o.nodes]).buffer(ROAD_WIDTH[h] / 2 + 1, quad_segs=2))
            elif t.get("railway") in ("rail", "tram", "light_rail", "subway") and t.get("tunnel") != "yes":
                clear.append(LineString([local(n.lon, n.lat) for n in o.nodes]).buffer(3.5, quad_segs=2))
            elif t.get("waterway") in ("river", "canal", "stream"):
                clear.append(LineString([local(n.lon, n.lat) for n in o.nodes]).buffer(4 if t["waterway"] == "stream" else 9, quad_segs=2))
            continue
        if not o.is_area():
            continue
        fill = None
        if t.get("leisure") in ("park", "garden") or t.get("landuse") in ("village_green",):
            fill = "park"
        elif t.get("natural") == "wood" or t.get("landuse") == "forest":
            fill = "wood"
        blocked = ("building" in t and t["building"] != "no") or t.get("natural") in ("water", "bare_rock", "scree") or \
            t.get("leisure") in ("pitch", "playground", "track", "stadium", "swimming_pool", "sports_centre", "ice_rink", "dog_park") or \
            t.get("amenity") in ("parking", "fountain") or t.get("landuse") in ("reservoir", "basin", "railway", "construction", "cemetery") or \
            t.get("water") or t.get("highway") or t.get("area:highway") or t.get("man_made") in ("bridge", "pier") or t.get("place") == "square"
        if not fill and not blocked:
            continue
        try:
            g = wkb.loads(factory.create_multipolygon(o), hex=True)
        except Exception:
            continue
        g = shapely.transform(g, lambda p: np.column_stack([(p[:, 0] - CENTRE[0]) * KX, (p[:, 1] - CENTRE[1]) * KY]))
        if not g.is_valid:
            g = g.buffer(0)
        if fill:
            leaf = t.get("leaf_type", "mixed" if fill == "wood" else "")
            areas.append((g, fill, leaf, o.id))
        else:
            clear.append(g.buffer(2.0 if "building" in t else 0.5, quad_segs=2))
    print(len(mapped), "mapped trees,", len(rows), "tree rows,", len(areas), "parks and woods,", len(clear), "clear zones", flush=True)

    trees = []   # (x, y, kind, height)
    for x, y, kind, height, oid in mapped:
        lo, hi = HEIGHTS[kind]
        try:
            h = float(str(height).replace("m", "").strip())
        except (TypeError, ValueError):
            h = lo + (hi - lo) * rand(oid, 7)
        trees.append((x, y, kind, h))
    for line, kind, oid in rows:
        n = max(1, int(line.length // ROW_SPACING))
        lo, hi = HEIGHTS[kind]
        for i in range(n + 1):
            p = line.interpolate(i * line.length / n if n else 0)
            trees.append((p.x, p.y, kind, lo + (hi - lo) * (0.6 + 0.4 * rand(oid, i))))

    tree_index = STRtree([Point(x, y) for x, y, *_ in trees]) if trees else None
    clear_index = STRtree(clear)
    filled = 0
    for g, fill, leaf, oid in areas:
        c = g.centroid
        if fill == "wood" and math.hypot(c.x, c.y) > FOREST_RADIUS:
            continue
        spacing = 7.5 if fill == "wood" else 12
        hits = clear_index.query(g)
        free = g.difference(shapely.union_all([clear[i] for i in hits])) if len(hits) else g
        if free.is_empty:
            continue
        x0, y0, x1, y1 = free.bounds
        gx, gy = np.meshgrid(np.arange(math.floor(x0 / spacing), math.ceil(x1 / spacing) + 1),
                             np.arange(math.floor(y0 / spacing), math.ceil(y1 / spacing) + 1))
        gx, gy = gx.ravel(), gy.ravel()
        if not len(gx):
            continue
        jx = np.array([rand(a, b, 1) for a, b in zip(gx, gy)])
        jy = np.array([rand(a, b, 2) for a, b in zip(gx, gy)])
        px, py = (gx + 0.15 + 0.7 * jx) * spacing, (gy + 0.15 + 0.7 * jy) * spacing
        # Groves and glades: low-frequency noise thins parks more than woods.
        keep = noise(px, py, 70) < (0.78 if fill == "wood" else 0.55)
        px, py = px[keep], py[keep]
        inside = shapely.contains_xy(free, px, py)
        px, py = px[inside], py[inside]
        for x, y in zip(px, py):
            if tree_index is not None and len(tree_index.query(Point(x, y).buffer(5))):
                continue
            r = rand(int(x * 10), int(y * 10), 3)
            if leaf == "needleleaved":
                kind = "conifer" if r < 0.55 else "pine"
            elif leaf == "broadleaved":
                kind = "broad" if r < 0.86 else ("birch" if r < 0.94 else "small")
            elif fill == "wood":
                kind = "broad" if r < 0.62 else "conifer" if r < 0.78 else "pine" if r < 0.9 else "birch"
            else:
                kind = "broad" if r < 0.66 else "conifer" if r < 0.74 else "pine" if r < 0.82 else "birch" if r < 0.88 \
                    else "small" if r < 0.95 else "poplar" if r < 0.98 else "willow"
            lo, hi = HEIGHTS[kind]
            trees.append((x, y, kind, lo + (hi - lo) * rand(int(x * 10), int(y * 10), 4)))
            filled += 1
    print(len(trees), "trees,", filled, "from parks and woods", flush=True)

    tiles = {}
    n = 2 ** Z
    for x, y, kind, h in trees:
        lon, lat = CENTRE[0] + x / KX, CENTRE[1] + y / KY
        fx = (lon + 180) / 360 * n
        fy = (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n
        tx, ty = int(fx), int(fy)
        u, v = min(65535, int((fx - tx) * 65536)), min(65535, int((fy - ty) * 65536))
        step = max(0, min(15, round((h - 3) / 1.6)))
        cell = (v >> 14) * 4 + (u >> 14)
        tiles.setdefault(f"{tx}/{ty}", []).append((cell, v, u, (K[kind] << 4) | step))
    table = {}
    total = 0
    for key in sorted(tiles):
        rows_ = sorted(tiles[key])
        counts = [0] * 16
        for cell, *_ in rows_:
            counts[cell] += 1
        data = struct.pack("<16I", *counts)
        data += np.array([r[2] for r in rows_], "<u2").tobytes() + np.array([r[1] for r in rows_], "<u2").tobytes()
        data += bytes(r[3] for r in rows_)
        packed = gzip.compress(data, 9, mtime=0)
        total += len(packed)
        table[key] = base64.b64encode(packed).decode("ascii")
    lines = ["  // Trees for the 3D view, per zoom-14 tile. Generated by tools/tree_data.py from OpenStreetMap (ODbL); do not edit by hand.",
             "  // Kinds: " + ", ".join(f"{i} {k}" for i, k in enumerate(KINDS)) + ".",
             "  var sofiaTreeTiles = " + json.dumps(table, separators=(",", ":")) + ";"]
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    counts = {k: 0 for k in KINDS}
    for _, _, kind, _ in trees:
        counts[kind] += 1
    print(len(table), "tiles,", round(total / 1024), "KB gzipped;", counts)


main()

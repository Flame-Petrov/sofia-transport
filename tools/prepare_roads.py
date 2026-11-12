"""Build the 3D road and rail tiles for the tilted view from the BBBike Sofia PBF.

Usage: python tools/prepare_roads.py EXTRACT [--only X/Y] [--embed-radius KM]

Run in the Python 3.12 venv in old/osm-work (osmium, shapely 2.1+, numpy). The normal
HTML build uses the checked-in result and needs none of these packages. The tile
format and the runtime are described in docs/3d-roads.md.

Geometry is prepared in Web Mercator with every width multiplied by the local
Mercator scale, which over Sofia differs from true metres by under 0.2 %.
"""

import argparse
import base64
from collections import defaultdict
import gzip
import json
import math
from pathlib import Path
import re
import struct

import numpy as np
import osmium
import shapely
from shapely.geometry import LineString, Polygon, box

SITE = Path(__file__).resolve().parents[1]
OUTPUT = SITE / "src/features/view3d/road-tiles.js"
ZOOM = 15
WORLD = math.pi * 6378137
TILE = 2 * WORLD / 2**ZOOM
# A tile spans 49152 steps and a vertex may lie up to 8192 steps outside it, so a
# ribbon piece that starts in one tile and ends just over its edge still fits uint16.
STEPS, MARGIN = 49152, 8192
STEP = TILE / STEPS
VERSION = 1
CENTRE = (23.3219, 42.6977)   # tiles nearest to this point are embedded first

# Materials, shared with src/features/view3d/road-layer.js.
ASPHALT, PAVING, SIDEWALK, KERB, TRACK_ROAD, TRACK_BED, BALLAST, DASH, SOLID, ZEBRA, RAIL = range(11)
# Detail levels in index order: a far tile draws a shorter prefix.
SURFACE, WALKS, BEDS, MARKS, RAILS = range(5)

# Carriageway width in metres when neither `width` nor `lanes` is mapped: (two-way, one-way).
WIDTH = {"motorway": (11, 8), "trunk": (10.5, 7.5), "primary": (10, 7), "secondary": (8, 6.5),
         "tertiary": (7, 5.5), "unclassified": (5.5, 4), "residential": (5.5, 4), "living_street": (4.5, 3.5),
         "service": (3.5, 3), "pedestrian": (5, 5),
         "motorway_link": (5, 4.5), "trunk_link": (5, 4.5), "primary_link": (5, 4.5),
         "secondary_link": (5, 4.5), "tertiary_link": (5, 4.5)}
LANE = 3.25
WALKED = {"primary", "secondary", "tertiary", "unclassified", "residential"}
MAJOR = {"motorway", "trunk", "primary", "secondary"}
SIDEWALK_WIDTH, KERB_CM = 2.0, 15
DENSIFY = 60.0          # longest ribbon piece in metres; must stay well inside the tile margin
JUNCTION_GAP = 7.0      # markings stop this far from a junction, plus half the road


def number(value):
    match = re.match(r"\s*(\d+(?:\.\d+)?)\s*(m|mm)?\s*$", value or "")
    if match:
        return float(match[1]) * (0.001 if match[2] == "mm" else 1)


class Way:
    __slots__ = ("kind", "klass", "nodes", "xy", "width", "oneway", "lanes", "walk", "gauge", "area")


def mercator(lon, lat):
    x = np.radians(lon) * 6378137
    y = np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * 6378137
    return np.column_stack([x, y])


def read(path):
    roads, tracks, crossings, buildings = [], [], {}, []
    for obj in osmium.FileProcessor(path).with_locations():
        tags = obj.tags
        if obj.is_node():
            if tags.get("highway") == "crossing" and tags.get("crossing") not in ("no", "unmarked", "informal") \
                    and tags.get("crossing:markings") != "no":
                crossings[obj.id] = True
            continue
        if not obj.is_way():
            continue
        highway, railway = tags.get("highway"), tags.get("railway")
        if tags.get("building") not in (None, "no") and obj.is_closed():
            try:
                pts = [(n.lon, n.lat) for n in obj.nodes]
            except osmium.InvalidLocationError:
                continue
            if len(pts) >= 4:
                buildings.append(mercator(*np.array(pts).T))
            continue
        road = highway in WIDTH
        track = railway in ("tram", "rail", "light_rail", "subway")
        if not road and not track:
            continue
        try:
            layer = int(tags.get("layer", "0"))
        except ValueError:
            layer = 0
        if tags.get("tunnel") not in (None, "no") or tags.get("covered") == "yes" or layer < 0                 or tags.get("location") == "underground" or tags.get("indoor") == "yes":
            continue
        try:
            pts = [(n.lon, n.lat) for n in obj.nodes]
        except osmium.InvalidLocationError:
            continue
        if len(pts) < 2:
            continue
        way = Way()
        way.nodes = [n.ref for n in obj.nodes]
        way.xy = mercator(*np.array(pts).T)
        way.area = False
        if road:
            way.kind, way.klass = "road", highway
            way.oneway = tags.get("oneway") in ("yes", "1", "-1", "true") or tags.get("junction") == "roundabout" \
                or highway in ("motorway", "motorway_link")
            way.lanes = int(number(tags.get("lanes")) or 0)
            width = number(tags.get("width"))
            if not width and way.lanes:
                width = max(way.lanes * LANE, 3.0)
            way.width = min(max(width or WIDTH[highway][1 if way.oneway else 0], 2.5), 30)
            walk = tags.get("sidewalk") or tags.get("sidewalk:both")
            way.walk = highway in WALKED if walk is None else walk not in ("no", "none", "separate")
            way.area = highway == "pedestrian" and tags.get("area") == "yes" and obj.is_closed() and len(pts) >= 4
            roads.append(way)
        else:
            way.kind, way.klass = "track", "tram" if railway == "tram" else "rail"
            gauge = number(tags.get("gauge"))
            way.gauge = gauge / 1000 if gauge and gauge > 100 else (1.009 if railway == "tram" else 1.435)
            if tags.get("service") in ("yard", "siding", "spur", "crossover") and railway != "tram":
                way.klass = "rail"
            tracks.append(way)
    return roads, tracks, crossings, buildings


class Line:
    """A densified centreline with a miter normal and the distance along it at every vertex."""

    def __init__(self, xy, scale, start=0.0):
        seg = np.hypot(*np.diff(xy, axis=0).T)
        keep = np.concatenate([[True], seg > 1e-6])
        xy = xy[keep]
        if len(xy) < 2:
            self.p = None
            return
        seg = np.hypot(*np.diff(xy, axis=0).T)
        pieces = np.maximum(1, np.ceil(seg / (DENSIFY * scale))).astype(int)
        out = [xy[:1]]
        for a, b, n in zip(xy[:-1], xy[1:], pieces):
            t = np.arange(1, n + 1)[:, None] / n
            out.append(a + (b - a) * t)
        self.p = np.vstack(out)
        d = np.diff(self.p, axis=0)
        length = np.hypot(*d.T)
        unit = d / length[:, None]
        left = np.column_stack([-unit[:, 1], unit[:, 0]])
        normal = np.vstack([left[:1], left[:-1] + left[1:], left[-1:]])
        size = np.hypot(*normal.T)
        normal /= np.maximum(size, 1e-9)[:, None]
        # Miter length, limited on sharp corners.
        cos = np.concatenate([[1], np.clip(np.einsum("ij,ij->i", normal[1:-1], left[1:]), 0.5, 1), [1]])
        self.n = normal / cos[:, None] * scale
        self.d = start + np.concatenate([[0], np.cumsum(length)]) / scale
        self.mid = (self.p[:-1] + self.p[1:]) / 2


def subline(xy, cum, a, b):
    """The part of a polyline between distances a and b along it."""
    if b - a < 0.5:
        return None
    inside = (cum > a) & (cum < b)
    pts = [np.array([np.interp(a, cum, xy[:, 0]), np.interp(a, cum, xy[:, 1])])]
    pts += list(xy[inside])
    pts.append(np.array([np.interp(b, cum, xy[:, 0]), np.interp(b, cum, xy[:, 1])]))
    return np.array(pts)


class Tiles:
    def __init__(self):
        self.parts = defaultdict(lambda: [[] for _ in range(5)])   # tile -> level -> (n, 3, 6) triangle arrays
        self.lines = defaultdict(list)                             # tile -> (kind, global xy steps)

    @staticmethod
    def steps(xy):
        """Mercator metres to global steps: x east, y south."""
        return np.column_stack([np.rint((xy[:, 0] + WORLD) / STEP), np.rint((WORLD - xy[:, 1]) / STEP)])

    def add(self, key, level, tris):
        if len(tris):
            self.parts[key][level].append(tris)

    def flat(self, key, level, tri_xy, z, material):
        """Triangles (n, 3, 2) in Mercator metres, level with the ground."""
        n = len(tri_xy)
        if not n:
            return
        out = np.zeros((n, 3, 6))
        out[:, :, :2] = self.steps(tri_xy.reshape(-1, 2)).reshape(n, 3, 2)
        out[:, :, 2], out[:, :, 3] = z, material
        self.add(key, level, out)

    def ribbon(self, line, level, o1, o2, z1, z2, material, mask=None, flags=0):
        """A strip between two offsets from a line. Each piece goes to the tile holding its midpoint."""
        if line.p is None:
            return
        left = self.steps(line.p + line.n * o1)
        right = self.steps(line.p + line.n * o2)
        dist = np.rint(line.d * 10)
        tx = np.floor((line.mid[:, 0] + WORLD) / TILE).astype(int)
        ty = np.floor((WORLD - line.mid[:, 1]) / TILE).astype(int)
        index = np.arange(len(tx)) if mask is None else np.nonzero(mask)[0]
        if not len(index):
            return
        # Distances repeat every 63 m, a whole number of every stripe period, which keeps them
        # small enough for shaders without high precision. A piece counts on past the repeat.
        d0 = dist[index] % 630
        d1 = d0 + dist[index + 1] - dist[index]
        quad = np.zeros((len(index), 4, 6))
        quad[:, 0, :2], quad[:, 1, :2] = left[index], right[index]
        quad[:, 2, :2], quad[:, 3, :2] = right[index + 1], left[index + 1]
        quad[:, 0, 2] = quad[:, 3, 2] = z1
        quad[:, 1, 2] = quad[:, 2, 2] = z2
        quad[:, :, 3], quad[:, :, 4] = material, flags
        quad[:, 0, 5] = quad[:, 1, 5] = d0
        quad[:, 2, 5] = quad[:, 3, 5] = d1
        tris = np.concatenate([quad[:, [0, 1, 2]], quad[:, [0, 2, 3]]], axis=1).reshape(-1, 3, 6)
        keys = tx[index] * 100000 + ty[index]
        for k in np.unique(keys):
            self.add((int(k) // 100000, int(k) % 100000), level, tris[np.repeat(keys == k, 2)])


def triangles(geometry):
    """Constrained Delaunay triangles of polygons as an (n, 3, 2) array."""
    polys = [g for g in shapely.get_parts(geometry) if isinstance(g, Polygon) and g.area > 1e-4]
    if not polys:
        return np.zeros((0, 3, 2))
    parts = shapely.get_parts(shapely.constrained_delaunay_triangles(polys))
    parts = parts[shapely.area(parts) > 1e-6]
    if not len(parts):
        return np.zeros((0, 3, 2))
    tris = shapely.get_coordinates(parts).reshape(-1, 4, 2)[:, :3]
    # Neighbours in space become neighbours in the file, which keeps the differences small.
    mid = tris.mean(1)
    cell = np.floor((mid - mid.min(0)) / 25).astype(np.int64)
    return tris[np.lexsort((mid[:, 0], cell[:, 0], cell[:, 1]))]


def polygons(geometry):
    parts = [g for g in shapely.get_parts(geometry) if isinstance(g, Polygon) and not g.is_empty]
    return shapely.union_all(parts) if parts else Polygon()


def encode(levels, lines, tx, ty):
    """One tile as bytes. See docs/3d-roads.md for the layout."""
    ox, oy = tx * STEPS - MARGIN, ty * STEPS - MARGIN
    vertices, indices, prefix, total = [], [], [], 0
    seen = {}
    for level in levels:
        if level:
            tris = np.concatenate(level)
            # Drop triangles that the rounding collapsed.
            a, b, c = tris[:, 0, :3], tris[:, 1, :3], tris[:, 2, :3]
            keep = ~((a == b).all(1) | (b == c).all(1) | (a == c).all(1))
            rows = tris[keep].reshape(-1, 6).astype(np.int64)
            rows[:, 0] -= ox
            rows[:, 1] -= oy
            if rows.size and (rows[:, :2].min() < 0 or rows[:, :2].max() > 65535):
                raise ValueError(f"Vertex outside tile {tx}/{ty}")
            for row in map(tuple, rows.tolist()):
                at = seen.get(row)
                if at is None:
                    at = seen[row] = len(vertices)
                    vertices.append(row)
                indices.append(at)
        total = len(indices)
        prefix.append(total)
    if not vertices:
        return None, 0
    table = np.array(vertices, dtype=np.int64)
    wide = len(vertices) > 65535
    # Columns of wrapping differences compress far better than interleaved vertices.
    # The reader in road-store.js adds them up again and interleaves the result.
    def column(values, kind):
        return np.diff(values, prepend=0).astype(np.int64).astype(kind).tobytes()
    body = b"".join(column(table[:, i], "<u2") for i in (0, 1, 2, 5))
    body += table[:, 3].astype("u1").tobytes() + table[:, 4].astype("u1").tobytes()
    body += b"\0" * (-len(body) % 4)
    index = column(np.array(indices), "<u4" if wide else "<u2")
    index += b"\0" * (-len(index) % 4)
    centre = [len(lines)]
    for kind, pts in lines:
        pts = pts.astype(np.int64) - (ox, oy)
        delta = np.diff(pts, axis=0)
        if pts.min() < 0 or pts.max() > 65535 or np.abs(delta).max(initial=0) > 32767:
            raise ValueError(f"Centreline outside tile {tx}/{ty}")
        centre += [kind, len(pts), int(pts[0, 0]), int(pts[0, 1])] + delta.reshape(-1).tolist()
    centre = np.array(centre, dtype=np.int64).astype("<u2").tobytes() if lines else b""
    header = struct.pack("<4sHHII5IhhI", b"SRD1", VERSION, 1 if wide else 0, len(vertices), total, *prefix,
                         int(table[:, 2].min()), int(table[:, 2].max()), len(centre))
    return header + body + index + centre, [p // 3 for p in prefix]


def build(roads, tracks, crossings, buildings, only=None):
    tiles = Tiles()
    lat = math.radians(CENTRE[1])
    scale = 1 / math.cos(lat)   # Mercator metres per ground metre

    # Junctions: a node shared by three road ends, or lying inside one way and used by another.
    uses, inner = defaultdict(int), defaultdict(int)
    for way in roads:
        for i, node in enumerate(way.nodes):
            uses[node] += 1
            if 0 < i < len(way.nodes) - 1:
                inner[node] += 1
    junction = lambda node: uses[node] >= 3 or (uses[node] == 2 and inner[node] >= 1)
    road_lines, pedestrian = [], []
    for way in roads:
        if way.area:
            pedestrian.append(polygons(shapely.make_valid(Polygon(way.xy))))
        else:
            road_lines.append(way)
    centre = [LineString(w.xy) for w in road_lines]
    half = np.array([w.width / 2 * scale for w in road_lines])
    paved = np.array([w.klass == "pedestrian" for w in road_lines])
    carriage = shapely.buffer(centre, half, quad_segs=3)
    walk = shapely.buffer(centre, half + SIDEWALK_WIDTH * scale, quad_segs=3)
    walked = np.array([w.walk for w in road_lines])
    tree = shapely.STRtree(carriage)
    block_tree = shapely.STRtree(shapely.make_valid(np.array([Polygon(b) for b in buildings], dtype=object)))
    blocks = block_tree.geometries
    area_tree = shapely.STRtree(pedestrian) if pedestrian else None
    track_shapes = [LineString(t.xy) for t in tracks]

    xs = np.concatenate([w.xy[:, 0] for w in roads + tracks])
    ys = np.concatenate([w.xy[:, 1] for w in roads + tracks])
    x0, x1 = int((xs.min() + WORLD) // TILE), int((xs.max() + WORLD) // TILE)
    y0, y1 = int((WORLD - ys.max()) // TILE), int((WORLD - ys.min()) // TILE)

    # Markings, crossings and tracks: ribbons along each way.
    for way in road_lines:
        if way.klass in ("pedestrian", "service", "living_street"):
            continue
        seg = np.hypot(*np.diff(way.xy, axis=0).T)
        cum = np.concatenate([[0], np.cumsum(seg)]) / scale
        length = cum[-1]
        gap = JUNCTION_GAP + way.width / 2
        stops = sorted(cum[i] for i, node in enumerate(way.nodes) if junction(node))
        spans, at = [], 0.0
        for s in stops:
            if s - gap > at:
                spans.append((at, s - gap))
            at = max(at, s + gap)
        if length > at:
            spans.append((at, length))
        lanes = way.lanes
        if not lanes:
            lanes = max(1, round(way.width / LANE)) if way.oneway and way.klass in MAJOR else 1 if way.oneway else 2
        marks = []   # (offset, material)
        if way.oneway:
            for i in range(1, lanes):
                marks.append((way.width * (i / lanes - 0.5), DASH))
        else:
            if way.klass in MAJOR or lanes >= 4:
                marks.append((0, SOLID))
            elif way.klass == "tertiary" or lanes >= 2 and way.width >= 6:
                marks.append((0, DASH))
            side = lanes // 2
            for i in range(1, side):
                for sign in (-1, 1):
                    marks.append((sign * way.width / 2 * i / side, DASH))
        for a, b in spans:
            piece = subline(way.xy, cum, a, b)
            if piece is None or not marks:
                continue
            line = Line(piece, scale, a)
            for offset, material in marks:
                tiles.ribbon(line, MARKS, offset - 0.075, offset + 0.075, 1, 1, material)
        # Zebra stripes run along the road, so their distance runs across it.
        for i, node in enumerate(way.nodes):
            if node not in crossings or way.klass in ("motorway", "trunk"):
                continue
            j = min(max(i, 1), len(way.xy) - 1)
            along = way.xy[j] - way.xy[j - 1]
            norm = np.hypot(*along)
            if norm < 1e-6:
                continue
            along /= norm
            across = np.array([-along[1], along[0]])
            w = way.width / 2 - 0.3
            ends = np.array([way.xy[i] - across * w * scale, way.xy[i] + across * w * scale])
            line = Line(ends, scale)
            if line.p is not None:
                line.n = np.tile(along * scale, (len(line.p), 1))
                tiles.ribbon(line, MARKS, -1.5, 1.5, 1, 1, ZEBRA)

    for way, shape in zip(tracks, track_shapes):
        line = Line(way.xy, scale)
        if line.p is None:
            continue
        g = way.gauge / 2
        if way.klass == "tram":
            near = tree.query(shape, predicate="intersects")
            road = shapely.union_all(carriage[near]) if len(near) else Polygon()
            on_road = shapely.contains_xy(road, line.mid[:, 0], line.mid[:, 1]) if not road.is_empty else np.zeros(len(line.mid), bool)
            tiles.ribbon(line, BEDS, -g - 0.45, g + 0.45, 1, 1, TRACK_ROAD, on_road)
            tiles.ribbon(line, BEDS, -g - 0.75, g + 0.75, 4, 4, TRACK_BED, ~on_road)
            for sign in (-1, 1):
                tiles.ribbon(line, RAILS, sign * g - 0.07, sign * g + 0.07, 3, 3, RAIL, on_road)
                tiles.ribbon(line, RAILS, sign * g - 0.07, sign * g + 0.07, 16, 16, RAIL, ~on_road)
        else:
            # Ballast: two slopes, drawn before the top that hides the far one.
            tiles.ribbon(line, BEDS, -2.3, -1.6, 0, 30, BALLAST, flags=1)
            tiles.ribbon(line, BEDS, 1.6, 2.3, 30, 0, BALLAST, flags=1)
            tiles.ribbon(line, BEDS, -1.6, 1.6, 30, 30, BALLAST)
            for sign in (-1, 1):
                tiles.ribbon(line, RAILS, sign * g - 0.07, sign * g + 0.07, 46, 46, RAIL)
        # Centrelines for snapping vehicles, cut where the line changes tile.
        steps = tiles.steps(line.p)
        tx = np.floor((line.mid[:, 0] + WORLD) / TILE).astype(int)
        ty = np.floor((WORLD - line.mid[:, 1]) / TILE).astype(int)
        start = 0
        for i in range(1, len(tx) + 1):
            if i == len(tx) or tx[i] != tx[start] or ty[i] != ty[start]:
                tiles.lines[(int(tx[start]), int(ty[start]))].append((0 if way.klass == "tram" else 1, steps[start:i + 1]))
                start = i

    # Surfaces: per tile, so every union stays small.
    todo = [(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)]
    if only:
        todo = [only]
    for count, (x, y) in enumerate(todo):
        left, top = x * TILE - WORLD, WORLD - y * TILE
        tile = box(left, top - TILE, left + TILE, top)
        pad = tile.buffer(40 * scale)
        near = tree.query(pad, predicate="intersects")
        key = (x, y)
        areas = [pedestrian[i] for i in area_tree.query(pad, predicate="intersects")] if area_tree else []
        if not len(near) and not areas:
            continue
        asphalt = shapely.union_all(carriage[near[~paved[near]]]) if (~paved[near]).any() else Polygon()
        paving = shapely.union_all(list(carriage[near[paved[near]]]) + areas)
        paving = polygons(paving.difference(asphalt)) if not paving.is_empty else paving
        # Buffer arcs and near-straight runs carry far more points than the picture needs.
        asphalt, paving = polygons(asphalt.simplify(0.12 * scale)), polygons(paving.simplify(0.12 * scale))
        ground = shapely.union_all([asphalt, paving])
        tiles.flat(key, SURFACE, triangles(asphalt.intersection(tile)), 0, ASPHALT)
        tiles.flat(key, SURFACE, triangles(paving.intersection(tile)), 0, PAVING)
        sides = near[walked[near]]
        if len(sides):
            houses = blocks[block_tree.query(pad, predicate="intersects")]
            pavement = shapely.union_all(walk[sides]).difference(ground)
            if len(houses):
                pavement = pavement.difference(shapely.union_all(houses))
            pavement = polygons(pavement.buffer(-0.2 * scale, quad_segs=1).buffer(0.2 * scale, quad_segs=1).simplify(0.25 * scale))   # no slivers
            inside = polygons(pavement.intersection(tile))
            # Kerb faces where the pavement meets the carriageway, before the top that hides the far ones.
            edge = ground.boundary.intersection(pavement.buffer(0.05 * scale)).intersection(tile)
            runs = [g for g in shapely.get_parts(edge) if g.geom_type == "LineString" and g.length > 0.2]
            for run in runs:
                pts = shapely.get_coordinates(run)
                a, b = pts[:-1], pts[1:]
                d = b - a
                size = np.hypot(*d.T)
                ok = size > 1e-3
                a, b, d, size = a[ok], b[ok], d[ok], size[ok]
                if not len(a):
                    continue
                normal = np.column_stack([-d[:, 1], d[:, 0]]) / size[:, None]
                probe = (a + b) / 2 + normal * 0.3 * scale
                flip = shapely.contains_xy(pavement, probe[:, 0], probe[:, 1])
                normal[flip] *= -1
                # The face looks into the road. Flags hold its direction in the east/south plane.
                angle = np.arctan2(-normal[:, 1], normal[:, 0])
                flag = 2 + np.rint((angle + np.pi) / (2 * np.pi) * 253).astype(int) % 253
                sa, sb = tiles.steps(a), tiles.steps(b)
                quad = np.zeros((len(a), 4, 6))
                quad[:, 0, :2], quad[:, 1, :2], quad[:, 2, :2], quad[:, 3, :2] = sa, sb, sb, sa
                quad[:, 2, 2] = quad[:, 3, 2] = KERB_CM
                quad[:, :, 3] = KERB
                quad[:, :, 4] = flag[:, None]
                tiles.add(key, WALKS, np.concatenate([quad[:, [0, 1, 2]], quad[:, [0, 2, 3]]], axis=1).reshape(-1, 3, 6))
            tiles.flat(key, WALKS, triangles(inside), KERB_CM, SIDEWALK)
        if count % 100 == 0:
            print(f"  surfaces {count}/{len(todo)}", flush=True)

    out, stats = {}, []
    keys = set(tiles.parts) | set(tiles.lines)
    for key in sorted(keys):
        if only and key != only:
            continue
        data, tris = encode(tiles.parts[key], tiles.lines.get(key, []), *key)
        if data:
            out[key] = data
            stats.append(tris)
    return out, np.array(stats), (x0, y0, x1, y1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("extract", type=Path)
    parser.add_argument("--only", help="build one tile, for example 18499/12069, and write nothing")
    parser.add_argument("--embed-radius", type=float, default=0,
                        help="embed only tiles within this many km of the centre in the standalone page (0 embeds all)")
    args = parser.parse_args()
    with osmium.io.Reader(str(args.extract)) as reader:
        date = reader.header().get("osmosis_replication_timestamp")
    roads, tracks, crossings, buildings = read(str(args.extract))
    print(f"{len(roads)} roads, {len(tracks)} tracks, {len(crossings)} crossings, {len(buildings)} buildings", flush=True)
    only = tuple(map(int, args.only.split("/"))) if args.only else None
    tiles, stats, bounds = build(roads, tracks, crossings, buildings, only)
    packed = {key: gzip.compress(data, compresslevel=9, mtime=0) for key, data in tiles.items()}
    raw = [len(d) for d in tiles.values()]
    zipped = [len(d) for d in packed.values()]
    print(f"{len(tiles)} tiles, {sum(raw):,} bytes raw (largest {max(raw):,}), {sum(zipped):,} gzipped (largest {max(zipped):,})")
    print("triangles per detail level (cumulative): total", stats.sum(0).tolist(), "largest tile", stats.max(0).tolist(),
          "median tile", np.median(stats, 0).astype(int).tolist())
    if only:
        return
    cx = (math.radians(CENTRE[0]) * 6378137 + WORLD) / TILE
    cy = (WORLD - math.log(math.tan(math.pi / 4 + math.radians(CENTRE[1]) / 2)) * 6378137) / TILE
    reach = args.embed_radius * 1000 / math.cos(math.radians(CENTRE[1])) / TILE
    table = {}
    for (x, y), data in sorted(packed.items()):
        embedded = not reach or math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= reach
        text = base64.b64encode(data).decode("ascii")
        # A leading "-" marks a tile the standalone page leaves out; the hosted build still publishes it.
        table[f"{x}/{y}"] = text if embedded else "-" + text
    OUTPUT.write_text(f"  // © OpenStreetMap contributors, ODbL. BBBike Sofia {date}. Generated by tools/prepare_roads.py.\n"
                      f"  var sofiaRoadBounds = {json.dumps(bounds)};\n"
                      + "  var sofiaRoadTiles = " + json.dumps(table, indent=2) + ";\n", encoding="utf-8")
    kept = sum(1 for v in table.values() if not v.startswith("-"))
    print(f"{OUTPUT} {OUTPUT.stat().st_size:,} bytes, {kept} of {len(table)} tiles embedded in the standalone page")


if __name__ == "__main__":
    main()

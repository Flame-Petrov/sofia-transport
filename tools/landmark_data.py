"""Write src/features/view3d/landmark-data.js from an OSM extract and the bundled building tiles.

Usage (Python with osmium, shapely and mapbox_vector_tile, e.g. the venv in old/osm-work):
    python tools/landmark_data.py PATH/TO/Sofia.osm.pbf

Each site gets the centre and long-axis bearing of its footprint's smallest enclosing rectangle,
the footprint in that rectangle's frame (u along the axis, v to its left, metres) and the ids of
the bundled building features the model replaces.
"""
import base64, gzip, json, math, sys
from pathlib import Path

import mapbox_vector_tile as mvt
import osmium
import shapely
from shapely import wkb
from shapely.affinity import affine_transform
from shapely.geometry import MultiPolygon, Point, shape

SITE = Path(__file__).resolve().parent.parent
TILES = SITE / "src/features/view3d/building-tiles.js"
OUT = SITE / "src/features/view3d/landmark-data.js"

# (kind, OSM type, id, English name)
LANDMARKS = [
    ("nevsky", "way", 155447771, "Alexander Nevsky Cathedral"),
    ("ndk", "way", 157725682, "National Palace of Culture"),
    ("theatre", "way", 1026031878, "Ivan Vazov National Theatre"),
    ("nedelya", "way", 162789700, "Sveta Nedelya Cathedral"),
    ("mosque", "way", 96640830, "Banya Bashi Mosque"),
    ("russian", "way", 162791009, "Russian Church of St Nicholas"),
    ("party", "rel", 3442483, "Largo (former Party House)"),
    ("tvtower", "way", 159638612, "Sofia TV Tower"),
    ("synagogue", "way", 96646570, "Sofia Synagogue"),
    ("tsar", "way", 310482763, "Monument to the Tsar Liberator"),
    ("sofia", "way", 1473691885, "Statue of Sveta Sofia"),
    ("levski", "node", 212950297, "Monument to Vasil Levski"),
    ("stadium", "way", 341968882, "Vasil Levski National Stadium"),
    ("stadium", "way", 1331127486, "Bulgarian Army Stadium"),
    ("stadium", "way", 292953722, "Georgi Asparuhov Stadium"),
    ("stadium", "way", 292960618, "Lokomotiv Stadium"),
    ("stadium", "way", 292949229, "Slavia Stadium"),
    ("university", "rel", 17925652, "Sofia University (Rectorate)"),
    ("university", "rel", 16731924, "Technical University, Block 1"),
    ("university", "rel", 2294688, "UACEG, new building"),
    ("university", "rel", 2232264, "New Bulgarian University, Building 3"),
    ("university", "way", 680883918, "National Academy of Arts"),
]
MALL_MIN_AREA = 2000  # m2


def tile_xy(lon, lat, z=14):
    n = 2 ** z
    return (lon + 180) / 360 * n, (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * n


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    wanted = {(t, i): (kind, name) for kind, t, i, name in LANDMARKS}
    rank = {(t, i): n for n, (kind, t, i, name) in enumerate(LANDMARKS)}
    factory = osmium.geom.WKBFactory()
    found = []
    for o in osmium.FileProcessor(sys.argv[1]).with_areas().with_locations():
        if o.is_node():
            hit = wanted.get(("node", o.id))
            if hit:
                found.append((hit[0], hit[1], Point(o.location.lon, o.location.lat).buffer(0.00002), dict(o.tags), rank[("node", o.id)]))
            continue
        if not o.is_area():
            continue
        key = ("way" if o.from_way() else "rel", o.orig_id())
        hit = wanted.get(key)
        tags = o.tags
        mall = tags.get("shop") == "mall" or tags.get("building") == "mall"
        if not hit and not (mall and tags.get("building") not in (None, "no")):
            continue
        geometry = wkb.loads(factory.create_multipolygon(o), hex=True)
        if hit:
            found.append((hit[0], hit[1], geometry, dict(tags), rank[key]))
        elif geometry.area * 111320 * 111320 * 0.735 >= MALL_MIN_AREA and key not in wanted:
            found.append(("mall", tags.get("name:en") or tags.get("name") or "Mall", geometry, dict(tags), key[1]))

    table = json.loads(TILES.read_text(encoding="utf-8").split("  var sofiaBuildingTiles = ", 1)[1].strip().rstrip(";"))
    cache = {}

    def features(tx, ty):
        key = f"{tx}/{ty}"
        if key not in cache:
            rows = []
            if key in table:
                decoded = mvt.decode(gzip.decompress(base64.b64decode(table[key])), default_options={"y_coord_down": True})
                for layer in decoded.values():
                    extent = layer["extent"]

                    def lonlat(points):
                        mx = (tx + points[:, 0] / extent) / 2 ** 14
                        my = (ty + points[:, 1] / extent) / 2 ** 14
                        import numpy
                        return numpy.column_stack([mx * 360 - 180, numpy.degrees(numpy.arctan(numpy.sinh(math.pi * (1 - 2 * my))))])

                    for feature in layer["features"]:
                        g = shapely.transform(shape(feature["geometry"]), lonlat)
                        rows.append((feature.get("id"), g if g.is_valid else g.buffer(0), float(feature["properties"].get("render_height") or 0)))
            cache[key] = rows
        return cache[key]

    sites = []
    order = {kind: n for n, (kind, *_rest) in enumerate(LANDMARKS)}
    for kind, name, geometry, tags, osm_id in sorted(found, key=lambda row: (99 if row[0] == "mall" else 0, row[4])):
        c = geometry.centroid
        kx, ky = 111320 * math.cos(math.radians(c.y)), 110574
        local = affine_transform(geometry, [kx, 0, 0, ky, -c.x * kx, -c.y * ky])
        rect = local.minimum_rotated_rectangle
        pts = list(rect.exterior.coords)[:4]
        e1 = (pts[1][0] - pts[0][0], pts[1][1] - pts[0][1])
        e2 = (pts[2][0] - pts[1][0], pts[2][1] - pts[1][1])
        long = e1 if math.hypot(*e1) >= math.hypot(*e2) else e2
        bearing = math.degrees(math.atan2(long[0], long[1])) % 180
        rc = rect.centroid
        b = math.radians(bearing)
        ux, uy = math.sin(b), math.cos(b)
        simple = local.simplify(1.2)
        polygon = max(simple.geoms, key=lambda p: p.area) if isinstance(simple, MultiPolygon) else simple
        outline = []
        for x, y in polygon.exterior.coords[:-1]:
            outline += [round((x - rc.x) * ux + (y - rc.y) * uy, 1), round(-(x - rc.x) * uy + (y - rc.y) * ux, 1)]
        ids = set()
        near, core = geometry.buffer(0.00008), geometry.buffer(0.00003)
        west, south, east, north = near.bounds
        x0, y1 = tile_xy(west, south)
        x1, y0 = tile_xy(east, north)
        parts = {}
        for tx in range(int(x0), int(x1) + 1):
            for ty in range(int(y0), int(y1) + 1):
                for fid, g, tall in features(tx, ty):
                    if fid is None or g.is_empty or not g.intersects(near):
                        continue
                    if g.intersection(core).area >= 0.6 * g.area:
                        parts[fid] = (g.area, tall)
        try:
            height = float(tags.get("height", ""))
        except ValueError:
            height = 0
        try:
            levels = float(tags.get("building:levels", ""))
        except ValueError:
            levels = 0
        if kind == "mall":
            if not parts:
                continue
            # A mall keeps its mapped height. Taller parts, such as office towers, stay as they are drawn.
            mapped = max(parts.values())[1]
            height = min(45, max(12, height or levels * 5.5 or (mapped if mapped > 6 else 14)))
            parts = {fid: row for fid, row in parts.items() if row[1] <= height + 3}
        ids = set(parts)
        sites.append({
            "k": kind, "n": name,
            "at": [round(c.x + rc.x / kx, 7), round(c.y + rc.y / ky, 7)],
            "b": round(bearing, 1), "h": height, "l": levels, "p": outline, "ids": sorted(ids),
        })
    lines = ["  // Landmark and mall sites for landmarks.js. Generated by tools/landmark_data.py from OpenStreetMap (ODbL); do not edit by hand.",
             "  var landmarkSites = ["]
    lines += ["    " + json.dumps(site, ensure_ascii=False, separators=(",", ":")) + "," for site in sites]
    lines[-1] = lines[-1].rstrip(",")
    lines.append("  ];")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")
    print(len(sites), "sites:", ", ".join(s["n"] for s in sites))


main()

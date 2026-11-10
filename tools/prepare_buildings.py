"""Build the offline Sofia building layer from the rectangular BBBike Sofia PBF.

Run with osmium, shapely, pyproj and mapbox-vector-tile installed. The normal
HTML build uses the checked-in result and needs none of these packages.
"""

import argparse
import base64
from collections import Counter, defaultdict
from dataclasses import dataclass
import gzip
import json
import math
from pathlib import Path
import re

import mapbox_vector_tile
import osmium
from pyproj import Transformer
import shapely
from shapely.geometry import box, Polygon, MultiPolygon


OUTPUT = Path(__file__).resolve().parents[1] / "src/features/view3d/building-tiles.js"
ZOOM = 14
WORLD = math.pi * 6378137
TILE = 2 * WORLD / 2**ZOOM
BUFFER = TILE * 8 / 4096
# The municipal listings and the corresponding OSM footprints are recorded in
# docs/3d-building-textures.md. Check both IDs again when updating the extract.
REVIEWED = {1554477712: "Q43282", 1714377802: "Q2598073"}
UTM = Transformer.from_crs(4326, 32634, always_xy=True)
MERCATOR = Transformer.from_crs(4326, 3857, always_xy=True)


@dataclass
class Building:
    id: int
    geometry: object
    part: bool
    height: int
    base: int
    monument: bool
    kind: str = ""
    cladding: str = ""
    wall: str = ""
    roof: str = ""
    hidden: bool = False
    material: str = ""
    style: str = ""
    seed: int = 0


def number(value):
    if value:
        match = re.fullmatch(r"\s*(-?\d+(?:\.\d+)?)\s*(m|ft|')?\s*", value)
        if match:
            return float(match[1]) * (0.3048 if match[2] in ("ft", "'") else 1)


def elevation(tags, height_keys, level_keys, default, rounding):
    for key in height_keys:
        metres = number(tags.get(key))
        if metres is not None:
            return rounding(metres)
    for key in level_keys:
        levels = number(tags.get(key))
        if levels is not None:
            return rounding(levels * 3.66)
    return default


COLOURS = {"white": "#f0eee8", "lightyellow": "#f0e6b4", "brown": "#8c6248", "tan": "#d2b48c", "red": "#b4503c",
           "maroon": "#7a3a34", "navy": "#34425e", "darkgrey": "#6e7074", "grey": "#9a9a98", "gray": "#9a9a98",
           "black": "#3c3c3e", "beige": "#e0d2b4", "yellow": "#e6cc6e", "green": "#6e9470", "blue": "#5a7aa6",
           "orange": "#d08c50", "pink": "#e0b0a8", "silver": "#b4b8bc"}


def colour(value):
    """A mapped colour as #rrggbb, or nothing when it is not a plain hex value or a common name."""
    value = (value or "").strip().lower()
    if re.fullmatch(r"#?[0-9a-f]{6}", value):
        return "#" + value.lstrip("#")
    if re.fullmatch(r"#[0-9a-f]{3}", value):
        return "#" + "".join(c * 2 for c in value[1:])
    return COLOURS.get(value, "")


def usage(tags):
    """The building's use from its own value or from what it houses."""
    kind = tags.get("building") or tags.get("building:part") or ""
    if kind in ("yes", "no", ""):
        if tags.get("amenity") == "place_of_worship":
            kind = "church"
        elif tags.get("shop"):
            kind = "retail"
        elif tags.get("office"):
            kind = "office"
        elif tags.get("tourism") in ("hotel", "hostel", "motel"):
            kind = "hotel"
        elif tags.get("amenity") in ("school", "kindergarten", "university", "college", "hospital", "clinic",
                                     "townhall", "courthouse", "police", "fire_station", "library", "community_centre"):
            kind = "public"
        elif tags.get("man_made") in ("works", "storage_tank", "silo", "pumping_station"):
            kind = "industrial"
        else:
            kind = ""
    return kind


def polygonal(geometry):
    if isinstance(geometry, (Polygon, MultiPolygon)):
        return geometry
    return shapely.union_all([p for p in shapely.get_parts(geometry) if isinstance(p, (Polygon, MultiPolygon))])


def read_buildings(path):
    buildings, memberships, outlines = {}, {}, set()
    factory = osmium.geom.WKBFactory()
    for obj in osmium.FileProcessor(path).with_areas():
        tags = obj.tags
        if obj.is_relation() and tags.get("type") == "building":
            roles = defaultdict(list)
            for member in obj.members:
                if member.type in ("w", "r"):
                    roles[member.role].append(member.ref * 10 + (2 if member.type == "w" else 3))
            outlines.update(roles["outline"])
            if len(roles["outline"]) == 1:
                memberships.update(dict.fromkeys(roles["part"], roles["outline"][0]))
        if not obj.is_area():
            continue
        part = tags.get("building:part") not in (None, "no")
        if not part and tags.get("building") in (None, "no"):
            continue
        geom = shapely.from_wkb(factory.create_multipolygon(obj))
        if not geom.is_valid:
            geom = polygonal(shapely.make_valid(geom))
        if geom.is_empty:
            continue
        fid = obj.orig_id() * 10 + (2 if obj.from_way() else 3)
        monument = tags.get("historic") == "monument" or (fid in REVIEWED and tags.get("wikidata") == REVIEWED[fid])
        height = elevation(tags, ("height", "building:height"), ("levels", "building:levels"), 5, math.ceil)
        base = elevation(tags, ("min_height", "building:min_height"), ("min_level", "building:min_level"), 0, math.floor)
        # The covered metro uses its own open, curved mesh.
        if fid in {6318019402, 6318019432, 6318019462, 6318019492, 6318019522,
                   6318019552, 6318019582, 6318019622, 6302364622, 6302364632, 14248382822, 14248382832, 14248382842}:
            continue
        if height >= 3660 or base >= 3660:
            continue
        buildings[fid] = Building(fid, geom, part, height, base, monument, usage(tags),
                                  tags.get("building:material") or "", colour(tags.get("building:colour")),
                                  colour(tags.get("roof:colour")))
    for fid in outlines & buildings.keys():
        buildings[fid].hidden = True
    return buildings, memberships


WORSHIP = {"church", "cathedral", "chapel", "mosque", "synagogue", "temple", "monastery", "religious"}
SHEDS = {"garage", "garages", "carport", "shed", "hut", "kiosk", "service", "container", "roof", "toilets"}
WORKS = {"industrial", "warehouse", "factory", "manufacture", "hangar", "depot", "barn", "farm_auxiliary",
         "greenhouse", "storage_tank", "silo", "transformer_tower"}
SHOPS = {"retail", "supermarket", "mall", "kiosk_row"}
CIVIC = {"school", "kindergarten", "university", "college", "hospital", "government", "public", "civic",
         "train_station", "sports_hall", "fire_station", "library", "museum", "theatre"}
HOMES = {"house", "detached", "semidetached_house", "bungalow", "terrace", "cabin", "farm", "villa"}
FLATS = {"apartments", "residential", "dormitory"}


def facade(kind, cladding, monument, roof, span, area, seed):
    """One of the styles in src/features/view3d/facade-styles.js.

    The mapped use decides first. Untyped buildings are judged by their height,
    longest side and area, with the seed choosing between equally plausible looks.
    """
    pick = lambda *names: names[seed % len(names)]
    if monument:
        return "stone"
    if kind in WORSHIP:
        return "church"
    if cladding in ("glass", "mirror"):
        return "glass"
    if kind in SHEDS:
        return "garage"
    if kind in WORKS or cladding in ("metal", "metal_sheet"):
        return "industrial"
    if kind in SHOPS:
        return "retail"
    if kind in CIVIC:
        return "public"
    if kind in ("office", "commercial"):
        return "glass" if roof >= 30 else "office"
    if kind == "hotel":
        return "glass" if roof >= 40 else "modern"
    if kind in HOMES:
        return "house"
    if cladding == "brick":
        return "brick"
    if kind in FLATS:
        if roof >= 14 and span >= 35:
            return "panel"
        if roof >= 20:
            return pick("panel", "modern")
        return pick("plaster", "brick", "modern", "plaster")
    if roof >= 45:
        return "glass"
    if roof >= 30:
        return pick("panel", "glass", "panel", "modern", "panel")
    if span >= 45:
        if roof <= 8:
            return pick("industrial", "retail", "industrial")
        return "panel" if roof >= 15 else pick("public", "office", "brick")
    if roof <= 5 and area < 60:
        return "garage"
    if roof <= 8 and area < 300:
        return "house"
    return pick("plaster", "brick", "plaster", "modern")


def own_seed(fid):
    """The seed the app derives from a feature ID when the tile stores none."""
    return fid // 10 % 1000


def classify(buildings, memberships):
    outlines = [b for b in buildings.values() if not b.part]
    tree = shapely.STRtree([b.geometry for b in outlines])
    groups = defaultdict(list)
    for b in buildings.values():
        parent = buildings.get(memberships.get(b.id))
        if b.part and parent is None:
            # Share a class only with a containing outline. A nearby POI or an
            # overlapping apartment block is insufficient evidence of ownership.
            candidates = [outlines[i] for i in tree.query(b.geometry, predicate="covered_by")]
            parent = min(candidates, key=lambda p: p.geometry.area, default=None)
        groups[parent.id if parent else b.id].append(b)
    for fid, parts in groups.items():
        parent = buildings[fid]
        roof = max([parent.height] + [p.height for p in parts])
        monument = parent.monument or any(p.monument for p in parts)
        metric = shapely.transform(parent.geometry, UTM.transform, interleaved=False)
        corners = list(metric.minimum_rotated_rectangle.exterior.coords)
        span = max(math.dist(a, b) for a, b in zip(corners, corners[1:]))
        if monument:
            material = "gold"
        elif roof >= 30:
            material = "blue"
        else:
            material = "purple" if span >= 45 else "green"
        # Every part of a building shares one look, so a tower matches its podium.
        seed = own_seed(fid)
        kind = parent.kind or next((p.kind for p in parts if p.kind), "")
        cladding = parent.cladding or next((p.cladding for p in parts if p.cladding), "")
        style = facade(kind, cladding, monument, roof, span, metric.area, seed)
        for part in parts:
            part.material, part.style, part.seed = material, style, seed
            part.wall = part.wall or parent.wall
            part.roof = part.roof or parent.roof


def make_tiles(buildings, bounds):
    visible = [b for b in buildings.values() if not b.hidden]
    geometries = shapely.transform([b.geometry for b in visible], MERCATOR.transform, interleaved=False)
    tree = shapely.STRtree(geometries)
    west, south, east, north = bounds
    tiles = {}
    for x in range(math.ceil((west + WORLD + BUFFER) / TILE), math.floor((east + WORLD - BUFFER) / TILE)):
        for y in range(math.ceil((WORLD - north + BUFFER) / TILE), math.floor((WORLD - south - BUFFER) / TILE)):
            left, top = x * TILE - WORLD, WORLD - y * TILE
            tile = box(left, top - TILE, left + TILE, top)
            clip = box(left - BUFFER, top - TILE - BUFFER, left + TILE + BUFFER, top + BUFFER)
            features = []
            for i in sorted(tree.query(clip, predicate="intersects")):
                geom = geometries[i]
                if not clip.covers(geom):
                    geom = polygonal(geom.intersection(clip))
                if geom.is_empty or geom.area == 0:
                    continue
                b = visible[i]
                properties = {"material": b.material, "render_height": b.height, "render_min_height": b.base,
                              "style": b.style}
                # Only a part that belongs to another outline needs its building's seed spelled out.
                if b.seed != own_seed(b.id):
                    properties["seed"] = b.seed
                if b.wall:
                    properties["wall"] = b.wall
                if b.roof:
                    properties["roof"] = b.roof
                features.append({"id": b.id, "geometry": geom, "properties": properties})
            data = mapbox_vector_tile.encode({"name": "building", "features": features},
                                             default_options={"quantize_bounds": tile.bounds})
            tiles[f"{x}/{y}"] = base64.b64encode(gzip.compress(data, compresslevel=9, mtime=0)).decode("ascii")
    return tiles


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("extract", type=Path)
    args = parser.parse_args()
    with osmium.io.Reader(str(args.extract)) as reader:
        header = reader.header()
        extent = header.box()
        date = header.get("osmosis_replication_timestamp")
    bounds = MERCATOR.transform_bounds(extent.bottom_left.lon, extent.bottom_left.lat,
                                       extent.top_right.lon, extent.top_right.lat)
    buildings, memberships = read_buildings(str(args.extract))
    classify(buildings, memberships)
    tiles = make_tiles(buildings, bounds)
    OUTPUT.write_text(f"  // © OpenStreetMap contributors, ODbL. BBBike Sofia {date}. Generated by tools/prepare_buildings.py.\n"
                      + "  var sofiaBuildingTiles = " + json.dumps(tiles, indent=2) + ";\n", encoding="utf-8")
    print(f"{len(tiles)} tiles, {OUTPUT.stat().st_size:,} bytes,", dict(Counter(b.material for b in buildings.values())),
          dict(Counter(b.style for b in buildings.values())))


if __name__ == "__main__":
    main()

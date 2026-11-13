"""Monument sites for tools/landmark_data.py: which OSM objects are 3D monuments, a spec for each (from the
inspected list in tools/monument_specs.json, or else from the OSM tags) and the way each one faces.

The spec fields are described in docs/3d-landmarks.md#monuments; monument-models.js draws them.
"""
import json, math

import shapely
import shapely.ops
from shapely.geometry import Point
from shapely.strtree import STRtree

FLAT_MEMORIALS = {"plaque", "stolperstein", "bench", "tombstone", "blue_plaque"}
FLAT_ARTWORK = {"mural", "graffiti", "painting", "poem", "mosaic", "coat_of_arms", "relief"}
SPEC_FIELDS = ("form", "pose", "figures", "top", "top_material", "animal", "lying", "pedestal", "pedestal_h", "figure_h", "total_h",
               "width", "depth", "material", "pedestal_material", "color", "features", "ring_d", "shaft_w")
ANIMALS = [("пингвин", "penguin"), ("лъв", "lion"), ("мечк", "bear"), ("мече", "bear"), ("сърн", "deer"), ("елен", "deer"),
           ("куче", "dog"), ("бик", "bull"), ("котк", "cat"), ("котар", "cat"), ("видра", "otter"), ("катерич", "squirrel"), ("риб", "fish")]
BIRDS = ("гълъб", "птиц", "орел", "орли", "бухал", "щъркел", "сова", "лебед", "dove", "bird")
SAINT = ("св.", "свети", "света", "патриарх", "екзарх", "епископ", "папа", "кирил", "паисий", "климент")
SOLDIER = ("опълчен", "войн", "воин", "партизан", "летец", "летци", "полк", "солдат")
MATERIALS = {"bronze": "bronze", "stone": "white_stone", "granite": "granite", "marble": "marble", "concrete": "concrete",
             "metal": "steel", "steel": "steel", "limestone": "limestone", "copper": "green_bronze"}
KX, KY = 111320 * math.cos(math.radians(42.69)), 110574


def is_monument(tags):
    """A three-dimensional monument, statue, bust, memorial or sculpture (plaques, murals and the like are flat)."""
    if tags.get("indoor") == "yes" or tags.get("location") in ("indoor", "underground"):
        return False
    historic = tags.get("historic")
    if historic in ("monument", "memorial"):
        return tags.get("memorial") not in FLAT_MEMORIALS
    return tags.get("tourism") == "artwork" and tags.get("artwork_type") not in FLAT_ARTWORK


def spec_from_tags(tags, seed):
    """A spec for a monument nobody has inspected: its form from the memorial or artwork type and its name."""
    raw = tags.get("name") or ""
    name = raw.lower()
    memorial, art, kind = tags.get("memorial"), tags.get("artwork_type"), tags.get("historic")
    first = (tags.get("material") or "").split(";")[0].strip()
    spec = {"material": MATERIALS.get(first, "bronze")}
    try:
        height = float((tags.get("height") or "").replace("m", "").strip())
    except ValueError:
        height = 0
    words = [w for w in raw.replace(".", ". ").split() if w.isalpha()]
    person = bool(tags.get("subject:wikidata")) or (2 <= len(words) <= 4 and all(w[:1].isupper() for w in words))
    if memorial == "bust" or art == "bust":
        spec.update(form="bust")
    elif memorial == "head":
        spec.update(form="head", pedestal="block")
    elif memorial == "stele":
        spec.update(form="stele", material=MATERIALS.get(first, "granite"))
    elif memorial == "obelisk":
        spec.update(form="obelisk", material=MATERIALS.get(first, "granite"))
    elif memorial in ("stone", "rock"):
        spec.update(form="stone", material="granite")
    elif memorial == "cross":
        spec.update(form="cross", material="white_stone")
    elif memorial == "eternal_flame":
        spec.update(form="flame")
    elif memorial == "aircraft":
        spec.update(form="aircraft", pedestal_material="concrete")
    elif memorial == "war_memorial" or (kind == "monument" and not person and memorial is None and art is None):
        form = ["pylon", "obelisk", "stele"][int(seed * 3)]
        spec.update(form=form, material=MATERIALS.get(first, "granite" if form == "obelisk" else "white_stone"))
        if form == "pylon":
            spec["top"] = "none"
        if any(w in name for w in SOLDIER):
            spec.update(form="group", figures=2, pose="soldier", pedestal="block")
    elif any(w in name for w in BIRDS):
        spec.update(form="bird", features=["wings"])
    elif "конник" in name:
        spec.update(form="equestrian")
    elif any(w in name for w, _ in ANIMALS):
        spec.update(form="animal", animal=next(a for w, a in ANIMALS if w in name), lying="лежащ" in name)
    elif any(w in name for w in ("майка", "семейство", "деца", "братя")) or " и " in name:
        spec.update(form="group", figures=3 if any(w in name for w in ("семейство", "деца")) else 2, pose="robe" if "майка" in name else "stand")
    elif memorial in ("statue", "person", "sculpture") or art == "statue" or person:
        pose = "robe" if any(w in name for w in SAINT) else "soldier" if any(w in name for w in SOLDIER) else \
            ["stand", "stride", "book", "stand", "arm"][int(seed * 5)]
        spec.update(form="statue", pose=pose)
        if art in ("statue", "sculpture") and not person:
            spec.update(pedestal="low", pedestal_h=0.3, figure_h=1.8)
    else:
        spec.update(form="abstract")
    if height:
        spec["total_h"] = height
    return spec


def load_specs(path):
    """The inspected specs by OSM key; a later row for the same key adds to or replaces an earlier one's fields."""
    specs = {}
    for name in sorted(path.parent.glob(path.stem + "*.json")):
        for row in json.loads(name.read_text(encoding="utf-8")):
            specs.setdefault(row["key"], {}).update({k: v for k, v in row.items() if v not in (None, "", [])})
    return specs


def monument_sites(monuments, paths, features, tile_xy, specs):
    """One site of kind `monument` per 3D monument: its spec, facing and the small building features it replaces.
    `monuments` holds (key, lon/lat geometry, tags); `paths` street and path lines in lon/lat."""
    local_paths = [shapely.transform(p, lambda a: a * [KX, KY]) for p in paths]
    index = STRtree(local_paths)
    out, placed = [], []
    for key, geometry, tags in sorted(monuments, key=lambda m: (m[0][0] != "n", int(m[0][1:]))):
        row = specs.get(key)
        if row and row.get("skip"):
            continue
        c = geometry.centroid if geometry.geom_type != "Point" else geometry
        if c.is_empty:
            continue
        name = tags.get("name:bg") or tags.get("name") or tags.get("name:en") or (row or {}).get("name") or "Monument"
        here = Point(c.x * KX, c.y * KY)
        # The same monument mapped twice (a node and an outline, or two nodes): keep the first.
        if any(here.distance(p) < 3 and (n == name or not tags.get("name")) for p, n in placed):
            continue
        placed.append((here, name))
        seed = (int(key[1:]) * 2654435761 % 2 ** 32) / 2 ** 32
        spec = spec_from_tags(tags, seed)
        if row:
            if row.get("form") and row["form"] != spec.get("form"):
                spec = {}   # a different form: the tag guesses no longer fit
            spec.update({f: row[f] for f in SPEC_FIELDS if row.get(f) not in (None, "", [])})
        # Facing: the spec's bearing, else toward the nearest street or path within 40 m.
        facing = row.get("facing") if row else None
        if not isinstance(facing, (int, float)):
            facing = None
            near = index.query(here.buffer(40))
            if len(near):
                best = min(near, key=lambda i: local_paths[i].distance(here))
                q = shapely.ops.nearest_points(local_paths[best], here)[0]
                if q.distance(here) > 0.5:
                    facing = math.degrees(math.atan2(q.x - here.x, q.y - here.y)) % 360
        facing = round(float(facing if facing is not None else seed * 360), 1)
        half = 1.2
        if geometry.geom_type != "Point":
            b = shapely.transform(geometry, lambda a: a * [KX, KY]).bounds
            half = max(1.2, min(25, max(b[2] - b[0], b[3] - b[1]) / 2))
            if spec.get("form") in ("wall", "group", "abstract") and "width" not in spec:
                spec["width"] = round(min(40, half * 2), 1)
        half = max(half, float(spec.get("width") or 0) / 2, float(spec.get("depth") or 0) / 2, float(spec.get("ring_d") or 0) / 2)
        total = float(spec.get("total_h") or 0) or float(spec.get("figure_h") or 0) + float(spec.get("pedestal_h") or 0)
        # Tiny building features standing for the pedestal are replaced by the model.
        ids = []
        core = c.buffer(0.00002 + half / 111000)
        west, south, east, north = core.bounds
        x0, y1 = tile_xy(west, south)
        x1, y0 = tile_xy(east, north)
        for tx in range(int(x0), int(x1) + 1):
            for ty in range(int(y0), int(y1) + 1):
                for fid, g, tall in features(tx, ty):
                    if fid is not None and not g.is_empty and g.intersects(core) and g.area * KX * KY < max(60, (half * 2.5) ** 2):
                        ids.append(fid)
        site = {"k": "monument", "n": name, "at": [round(c.x, 7), round(c.y, 7)], "b": facing, "h": round(total, 1), "l": 0,
                "p": [-half, -half, half, -half, half, half, -half, half], "ids": sorted(set(ids)), "s": spec, "key": key}
        if total < 10 and half < 8:
            site["z"] = 15   # small: drawn from MapLibre zoom 15 (16 on the flat map)
        if row:
            site["src"] = row.get("source", "spec")
        out.append(site)
    return out

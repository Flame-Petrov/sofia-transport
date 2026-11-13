"""Build the standalone Sofia Live Transport page using Python 3."""

import argparse
import base64
import gzip
import json
from pathlib import Path
import re
from tempfile import NamedTemporaryFile


SITE = Path(__file__).resolve().parent
SOURCE = SITE / "src"
LOCAL_RELEASE = "107_public-transport.html"
INCLUDE = re.compile(r"^\{\{include ([\w./-]+)\}\}\n", re.MULTILINE)


def render(standalone):
    tiles = {}
    template = SOURCE / "page.html"
    used = {template}

    def include(match):
        path = (SOURCE / match[1]).resolve()
        if SOURCE not in path.parents or path in used:
            raise ValueError(f"Invalid or repeated include: {match[1]}")
        used.add(path)
        content = path.read_text(encoding="utf-8")
        if not standalone and path.name == "building-tiles.js":
            credit, table = content.split("  var sofiaBuildingTiles = ", 1)
            manifest = {}
            for key, value in json.loads(table.strip().removesuffix(";")).items():
                if not re.fullmatch(r"\d+/\d+", key):
                    raise ValueError(f"Invalid building tile key: {key}")
                relative = f"tiles/buildings/14/{key}.pbf"
                tiles[SITE / relative] = gzip.decompress(base64.b64decode(value))
                manifest[key] = relative
            return credit + "  var sofiaBuildingTiles = " + json.dumps(manifest) + ";\n"
        if path.name == "road-tiles.js":
            # A leading "-" marks a tile the standalone page leaves out: it keeps an empty entry there,
            # which the app reads as "not prepared here" and shows the flat street lines instead.
            head, table = content.split("  var sofiaRoadTiles = ", 1)
            manifest = {}
            for key, value in json.loads(table.strip().removesuffix(";")).items():
                if not re.fullmatch(r"\d+/\d+", key):
                    raise ValueError(f"Invalid road tile key: {key}")
                if standalone:
                    manifest[key] = "" if value.startswith("-") else value
                else:
                    relative = f"tiles/roads/15/{key}.bin.gz"
                    tiles[SITE / relative] = base64.b64decode(value.removeprefix("-"))
                    manifest[key] = relative
            return head + "  var sofiaRoadTiles = " + json.dumps(manifest, separators=(",", ":")) + ";\n"
        if path.name == "tree-tiles.js":
            # The standalone page embeds every tree tile; the hosted page fetches each when it is first in view.
            head, table = content.split("  var sofiaTreeTiles = ", 1)
            if standalone:
                return content
            manifest = {}
            for key, value in json.loads(table.strip().removesuffix(";")).items():
                if not re.fullmatch(r"\d+/\d+", key):
                    raise ValueError(f"Invalid tree tile key: {key}")
                relative = f"tiles/trees/14/{key}.bin.gz"
                tiles[SITE / relative] = base64.b64decode(value)
                manifest[key] = relative
            return head + "  var sofiaTreeTiles = " + json.dumps(manifest, separators=(",", ":")) + ";\n"
        return content

    page = INCLUDE.sub(include, template.read_text(encoding="utf-8"))
    for model in ("bus", "tram", "trolleybus"):
        payload = f"models/{model}.glb"
        if standalone:
            payload = base64.b64encode((SITE / payload).read_bytes()).decode("ascii")
        page = page.replace("{{vehicle-model " + model + "}}", payload)
    if "{{include " in page:
        raise ValueError("Malformed or nested include in source")
    unused = sorted(p for p in SOURCE.rglob("*") if p.suffix in {".js", ".css", ".html"} and p not in used)
    if unused:
        raise ValueError("Source missing from page.html: " + ", ".join(str(p.relative_to(SOURCE)) for p in unused))
    return page.encode("utf-8"), tiles


def write_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = NamedTemporaryFile(dir=path.parent, delete=False)
    name = Path(tmp.name)
    try:
        with tmp:
            tmp.write(data)
        name.replace(path)
    finally:
        name.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify generated files without writing")
    args = parser.parse_args()
    hosted, outputs = render(standalone=False)
    outputs[SITE / "index.html"] = hosted
    if (SITE.parent / "serve.py").is_file():
        outputs[SITE.parent / LOCAL_RELEASE], _ = render(standalone=True)
    stale = [p for p, data in outputs.items() if not p.is_file() or p.read_bytes() != data]
    if args.check and stale:
        parser.exit(1, "Rebuild required: " + ", ".join(str(p) for p in stale) + "\n")
    for path in stale:
        write_atomic(path, outputs[path])
    print(f"Verified {len(outputs)} outputs including {SITE / 'index.html'}")


if __name__ == "__main__":
    main()

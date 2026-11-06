"""Build the standalone Sofia Live Transport page using Python 3."""

import argparse
from pathlib import Path
import re
from tempfile import NamedTemporaryFile


SITE = Path(__file__).resolve().parent
SOURCE = SITE / "src"
LOCAL_RELEASE = "102_public-transport.html"
INCLUDE = re.compile(r"^\{\{include ([\w./-]+)\}\}\n", re.MULTILINE)


def render():
    template = SOURCE / "page.html"
    used = {template}

    def include(match):
        path = (SOURCE / match[1]).resolve()
        if SOURCE not in path.parents or path in used:
            raise ValueError(f"Invalid or repeated include: {match[1]}")
        used.add(path)
        return path.read_text(encoding="utf-8")

    page = INCLUDE.sub(include, template.read_text(encoding="utf-8"))
    if "{{include " in page:
        raise ValueError("Malformed or nested include in source")
    unused = sorted(p for p in SOURCE.rglob("*") if p.suffix in {".js", ".css", ".html"} and p not in used)
    if unused:
        raise ValueError("Source missing from page.html: " + ", ".join(str(p.relative_to(SOURCE)) for p in unused))
    return page.encode("utf-8")


def write_atomic(path, data):
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
    outputs = [SITE / "index.html"]
    if (SITE.parent / "serve.py").is_file():
        outputs.append(SITE.parent / LOCAL_RELEASE)
    data = render()
    stale = [p for p in outputs if not p.is_file() or p.read_bytes() != data]
    if args.check and stale:
        parser.exit(1, "Rebuild required: " + ", ".join(str(p) for p in stale) + "\n")
    for path in stale:
        write_atomic(path, data)
    print("Verified " + ", ".join(str(p) for p in outputs))


if __name__ == "__main__":
    main()

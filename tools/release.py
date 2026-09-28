"""Validate and promote retained Keyframe release candidates."""

import hashlib
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

from PIL import Image, UnidentifiedImageError

PACKS = tuple(f"Keyframe-{size}x.zip" for size in (512, 256, 128, 64, 32))
TAG = re.compile(r"^v(0\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-(?:alpha|beta)\.[1-9]\d*)?)$")
PNG = b"\x89PNG\r\n\x1a\n"


def fail(message):
    raise ValueError(message)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def version_channel(tag):
    match = TAG.fullmatch(tag)
    if not match:
        fail("Tag must be a Keyframe 0.x.y alpha, beta or stable version")
    version = match.group(1)
    channel = "alpha" if "-alpha." in version else "beta" if "-beta." in version else "stable"
    return version, channel


def png_dimensions(data, label):
    """Check chunk integrity, then decode every pixel (not just the PNG header)."""
    try:
        with Image.open(io.BytesIO(data)) as image:
            if image.format != "PNG":
                fail(f"Invalid PNG: {label}")
            image.verify()
        with Image.open(io.BytesIO(data)) as image:
            image.load()
            return image.size
    except (OSError, SyntaxError, UnidentifiedImageError, Image.DecompressionBombError) as exc:
        fail(f"Invalid PNG: {label}: {exc}")


def svg_dimensions(source, resolution):
    root = ET.parse(source).getroot()
    viewbox = root.get("viewBox", "").replace(",", " ").split()
    if len(viewbox) != 4:
        fail(f"Missing source viewBox: {source}")
    width, height = map(float, viewbox[2:])
    if width <= 0 or height <= 0:
        fail(f"Invalid source dimensions: {source}")
    return resolution, round(resolution * height / width)


def expected_assets(resolution, pbr=False):
    """Inventory for the release compiler's default palette and explicit PBR profile."""
    textures = {}
    root = Path("textures")
    dyes = ("white", "orange", "magenta", "light_blue", "yellow", "lime", "pink",
            "gray", "light_gray", "cyan", "purple", "blue", "brown", "green", "red", "black")
    for source in root.rglob("*"):
        if not source.is_file():
            continue
        relative = source.relative_to(root)
        prefix = "assets/minecraft/textures/" + relative.parent.as_posix() + "/"
        if source.suffix == ".svg":
            stem = source.stem
            stems = [f"{dye}_{stem.removesuffix('.template')}" for dye in dyes] if stem.endswith(".template") else [stem]
            for output in stems:
                name = prefix + output + ".png"
                textures[name] = svg_dimensions(source, resolution)
                if pbr and (stem.endswith(".template") or "_overlay" not in relative.as_posix()):
                    for suffix in ("_n.png", "_s.png"):
                        textures[prefix + output + suffix] = (resolution, resolution)
            if not stem.endswith(".template"):
                companion = any((source.parent / (stem + suffix)).is_file()
                                for suffix in (".svg.mcmeta", ".png.mcmeta", ".mcmeta"))
                if companion:
                    textures[prefix + stem + ".png.mcmeta"] = None
                if stem in ("short_grass", "short_grass_1", "short_grass_2"):
                    alias = stem.removeprefix("short_")
                    textures[prefix + alias + ".png"] = textures[prefix + stem + ".png"]
                    if companion:
                        textures[prefix + alias + ".png.mcmeta"] = None
                    if pbr:
                        for suffix in ("_n.png", "_s.png"):
                            textures[prefix + alias + suffix] = (resolution, resolution)
        elif source.suffix in (".png", ".json", ".mcmeta"):
            textures["assets/minecraft/textures/" + relative.as_posix()] = (
                png_dimensions(source.read_bytes(), str(source)) if source.suffix == ".png" else None
            )
    # The animation compiler also emits one strip and metadata from frame folders,
    # while the ordinary recursive rasterizer retains the individual frame PNGs.
    animation_module = Path("tools/lib/animation-packager.mjs").read_text(encoding="utf-8")
    presets_block = animation_module.split("export const DEFAULT_ANIMATION_PRESETS = {", 1)[1].split("};", 1)[0]
    presets = set(re.findall(r"^  (\w+):", presets_block, re.MULTILINE))
    categories = {"block", "blocks", "item", "items", "gui", "entity", "entities", "model",
                  "models", "font", "environment", "painting", "particle", "effect"}
    item_ids = {"cooked_beef", "golden_apple", "compass_nexus", "plot_compass", "spiral_core", "ninja6_token"}
    for folder in root.rglob("*"):
        if not folder.is_dir() or folder.name.lower() in categories:
            continue
        frames = list(folder.glob("*.svg"))
        numeric = sum(bool(re.fullmatch(r"(\d+|frame_?\d+|f_?\d+)", frame.stem.lower())) for frame in frames)
        metadata = any((folder / filename).is_file() for filename in (
            folder.name + ".png.mcmeta", folder.name + ".svg.mcmeta", "animation.json"))
        if not frames or not (metadata or folder.name in presets or numeric >= len(frames) / 2):
            continue
        # Natural frame ordering matches the compiler's frame_2-before-frame_10 order.
        frames.sort(key=lambda frame: [int(part) if part.isdecimal() else part.lower()
                                      for part in re.split(r"(\d+)", frame.name)])
        category = "item" if "item" in folder.relative_to(root).parts or folder.parent.name == "items" or folder.name in item_ids else "block"
        prefix = f"assets/minecraft/textures/{category}/{folder.name}"
        width, height = svg_dimensions(frames[0], resolution)
        textures[prefix + ".png"] = (width, height * len(frames))
        textures[prefix + ".png.mcmeta"] = None
    template = {}
    for path in Path("pack_template/assets").rglob("*"):
        if path.is_file():
            template[path.relative_to("pack_template").as_posix()] = (
                png_dimensions(path.read_bytes(), str(path)) if path.suffix == ".png" else None
            )
    if not textures or not template:
        fail("Source texture or pack template inventory is empty")
    return {**textures, **template, "pack.mcmeta": None, "pack.png": (128, 128)}


def check_animation(metadata, dimensions, resolution, label):
    animation = metadata.get("animation")
    if not isinstance(animation, dict):
        fail(f"Invalid animation metadata: {label}")
    width = animation.get("width", resolution)
    height = animation.get("height", resolution)
    if (type(width) is not int or type(height) is not int or width <= 0 or height <= 0
            or dimensions[0] % width or dimensions[1] % height):
        fail(f"Invalid animation layout: {label}")
    count = (dimensions[0] // width) * (dimensions[1] // height)
    frames = animation.get("frames", list(range(count)))
    if not isinstance(frames, list) or not frames:
        fail(f"Invalid animation frames: {label}")
    for frame in frames:
        index = frame.get("index") if isinstance(frame, dict) else frame
        if type(index) is not int or not 0 <= index < count:
            fail(f"Invalid animation frame index: {label}")
        if isinstance(frame, dict) and (type(frame.get("time", 1)) is not int or frame.get("time", 1) <= 0):
            fail(f"Invalid animation frame time: {label}")
    if type(animation.get("frametime", 1)) is not int or animation.get("frametime", 1) <= 0:
        fail(f"Invalid animation frametime: {label}")


def check_pack(data, name, version, pbr=False):
    if name not in PACKS:
        fail("Unexpected pack filename")
    size = name.removeprefix("Keyframe-").removesuffix("x.zip")
    inventory = expected_assets(int(size), pbr)
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entries = archive.infolist()
            names = [entry.filename for entry in entries if not entry.is_dir()]
            if len(names) != len(set(names)) or any(
                name.startswith("/") or "\\" in name or ".." in Path(name).parts
                for name in names
            ):
                fail("Unsafe or duplicate ZIP entry")
            if archive.testzip() is not None:
                fail("ZIP CRC failure")
            if "pack.mcmeta" not in names or "pack.png" not in names:
                fail("Pack metadata or icon missing")
            metadata = json.loads(archive.read("pack.mcmeta"))
            if metadata.get("keyframe_version") != version:
                fail("Embedded pack version differs from candidate")
            pack = metadata.get("pack", {})
            if not isinstance(pack.get("pack_format"), int) or f"{size}x" not in pack.get("description", ""):
                fail("Pack metadata does not match resolution")
            if set(names) != set(inventory):
                missing = sorted(set(inventory) - set(names))
                extra = sorted(set(names) - set(inventory))
                fail(f"Pack inventory mismatch; missing={missing}, extra={extra}")
            for entry_name in names:
                if entry_name.endswith(".png"):
                    dimensions = png_dimensions(archive.read(entry_name), entry_name)
                    if dimensions != inventory[entry_name]:
                        fail(f"Wrong PNG dimensions: {entry_name}: {dimensions}, expected {inventory[entry_name]}")
                    companion = entry_name + ".mcmeta"
                    if companion in names:
                        check_animation(json.loads(archive.read(companion)), dimensions, int(size), companion)
                elif entry_name.endswith((".json", ".mcmeta")):
                    json.loads(archive.read(entry_name))
                else:
                    fail(f"Unexpected asset type: {entry_name}")
    except (zipfile.BadZipFile, KeyError, json.JSONDecodeError) as exc:
        fail(f"Invalid pack {name}: {exc}")


def validate(directory, tag, source):
    directory = Path(directory)
    manifest = read_json(directory / "candidate.json")
    version, channel = version_channel(tag)
    package_version = read_json("package.json")["version"]
    if version != package_version:
        fail("Tag and package.json version differ")
    if manifest.get("schema") != 1 or manifest.get("tag") != tag or manifest.get("version") != version or manifest.get("channel") != channel:
        fail("Candidate identity, version or channel mismatch")
    if manifest.get("source_sha") != source or not re.fullmatch(r"[0-9a-f]{40}", source):
        fail("Candidate source commit mismatch")
    run_id, attempt = str(manifest.get("run_id")), str(manifest.get("attempt"))
    if not run_id.isdecimal() or not attempt.isdecimal() or int(run_id) < 1 or int(attempt) < 1:
        fail("Invalid originating run")
    expected_id = f"{run_id}-{attempt}-{source[:12]}-{tag}"
    if manifest.get("candidate_id") != expected_id or manifest.get("artifact_name") != f"keyframe-candidate-{run_id}-{attempt}":
        fail("Candidate or artifact identity mismatch")
    if manifest.get("destinations") != ["github-release"] or set(manifest.get("files", {})) != set(PACKS):
        fail("Candidate destinations or pack list mismatch")
    if {entry.name for entry in directory.iterdir()} != set(PACKS) | {"candidate.json"}:
        fail("Downloaded candidate has missing or extra files")
    for name in PACKS:
        data = (directory / name).read_bytes()
        if digest(data) != manifest["files"][name]:
            fail(f"Candidate digest mismatch: {name}")
        check_pack(data, name, version)
    return manifest


def make_manifest(directory, tag):
    version, channel = version_channel(tag)
    if read_json("package.json")["version"] != version:
        fail("Tag and package.json version differ")
    source = os.environ["GITHUB_SHA"]
    run_id, attempt = os.environ["GITHUB_RUN_ID"], os.environ["GITHUB_RUN_ATTEMPT"]
    directory = Path(directory)
    if {item.name for item in directory.glob("Keyframe-*.zip")} != set(PACKS):
        fail("Build produced missing or extra packs")
    manifest = {
        "schema": 1, "source_sha": source, "tag": tag, "version": version,
        "channel": channel, "run_id": int(run_id), "attempt": int(attempt),
        "candidate_id": f"{run_id}-{attempt}-{source[:12]}-{tag}",
        "artifact_name": f"keyframe-candidate-{run_id}-{attempt}",
        "destinations": ["github-release"],
        "files": {name: digest((directory / name).read_bytes()) for name in PACKS},
    }
    (directory / "candidate.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    validate(directory, tag, source)


def evidence(candidate, destination):
    manifest = read_json(Path(candidate) / "candidate.json")
    validate(candidate, manifest["tag"], manifest["source_sha"])
    if int(os.environ["GITHUB_RUN_ID"]) != manifest["run_id"] or int(os.environ["GITHUB_RUN_ATTEMPT"]) != manifest["attempt"]:
        fail("Verification did not run with the candidate")
    record = {
        "schema": 1, "result": "passed", "candidate_id": manifest["candidate_id"],
        "manifest_sha256": digest((Path(candidate) / "candidate.json").read_bytes()),
        "files": manifest["files"], "verification_run_id": manifest["run_id"],
        "verification_attempt": manifest["attempt"],
    }
    Path(destination).mkdir(exist_ok=True)
    (Path(destination) / "evidence.json").write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")


def check_evidence(candidate, evidence_dir, manifest):
    evidence_path = Path(evidence_dir) / "evidence.json"
    if {entry.name for entry in Path(evidence_dir).iterdir()} != {"evidence.json"}:
        fail("Missing or extra evidence files")
    record = read_json(evidence_path)
    if record != {
        "schema": 1, "result": "passed", "candidate_id": manifest["candidate_id"],
        "manifest_sha256": digest((Path(candidate) / "candidate.json").read_bytes()),
        "files": manifest["files"], "verification_run_id": manifest["run_id"],
        "verification_attempt": manifest["attempt"],
    }:
        fail("Passing test evidence does not match candidate")


def api(method, url, payload=None, accept="application/vnd.github+json"):
    token = os.environ["GH_TOKEN"]
    data = json.dumps(payload).encode() if isinstance(payload, dict) else payload
    request = urllib.request.Request(
        url, data=data, method=method,
        headers={"Authorization": f"Bearer {token}", "Accept": accept,
                 "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "keyframe-release",
                 **({"Content-Type": "application/json" if isinstance(payload, dict) else "application/octet-stream"} if payload is not None else {})},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            body = response.read()
            if accept == "application/octet-stream" or url.startswith("https://uploads.github.com/"):
                return body
            return json.loads(body) if body else None
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        fail(f"GitHub API {method} failed with HTTP {exc.code}")


def notes(version, channel):
    contents = Path("CHANGELOG.md").read_text(encoding="utf-8")
    base = version.split("-")[0]
    for heading in (version, base):
        match = re.search(rf"(?ms)^## \[{re.escape(heading)}\].*?\n(.*?)(?=^## |\Z)", contents)
        if match and match.group(1).strip():
            return match.group(1).strip()
    if channel == "stable":
        fail(f"CHANGELOG.md has no [{base}] section")
    return "Pre-release. See CHANGELOG.md [Unreleased] for work in progress."


def remote_tag(repo, tag):
    ref = api("GET", f"https://api.github.com/repos/{repo}/git/ref/tags/{urllib.parse.quote(tag)}")
    if not ref:
        fail("Release tag is missing")
    obj = ref["object"]
    for _ in range(5):
        if obj["type"] == "commit":
            return obj["sha"]
        if obj["type"] != "tag":
            fail("Release tag does not point to a commit")
        obj = api("GET", f"https://api.github.com/repos/{repo}/git/tags/{obj['sha']}")["object"]
    fail("Release tag nesting is too deep")


def check_run(repo, manifest):
    run = api("GET", f"https://api.github.com/repos/{repo}/actions/runs/{manifest['run_id']}")
    if not run or run.get("conclusion") != "success" or run.get("head_sha") != manifest["source_sha"] or run.get("event") != "workflow_dispatch" or ".github/workflows/release.yml" not in run.get("path", ""):
        fail("Originating candidate run is not a successful release workflow run")
    if run.get("run_attempt") != manifest["attempt"]:
        fail("Candidate run attempt differs")


def check_release(release, manifest, marker):
    if release["tag_name"] != manifest["tag"] or release["prerelease"] != (manifest["channel"] != "stable"):
        fail("Existing release metadata conflicts with candidate")
    if marker not in release.get("body", ""):
        fail("Existing release identity differs; reconcile manually")
    assets = {asset["name"]: asset for asset in release["assets"]}
    if len(assets) != len(release["assets"]) or not set(assets).issubset(PACKS):
        fail("Existing release contains duplicate or unexpected assets")
    for name, asset in assets.items():
        if asset["state"] != "uploaded":
            fail("Existing asset is incomplete")
        downloaded = api("GET", asset["url"], accept="application/octet-stream")
        if downloaded is None or digest(downloaded) != manifest["files"][name]:
            fail(f"Published asset differs: {name}; reconcile manually")
    return assets


def find_release(base, tag):
    found = []
    for page in range(1, 11):
        releases = api("GET", f"{base}/releases?per_page=100&page={page}")
        if not isinstance(releases, list):
            fail("Could not enumerate releases for reconciliation")
        found.extend(item for item in releases if item["tag_name"] == tag)
        if len(releases) < 100:
            break
    else:
        fail("Release inventory exceeds reconciliation limit")
    if len(found) > 1:
        fail("Multiple releases use the intended tag")
    return found[0] if found else None


def publish(candidate, evidence_dir, tag, source, run_id):
    manifest = validate(candidate, tag, source)
    if str(manifest["run_id"]) != run_id:
        fail("Requested candidate run differs")
    check_evidence(candidate, evidence_dir, manifest)
    repo = os.environ["GITHUB_REPOSITORY"]
    check_run(repo, manifest)
    if remote_tag(repo, tag) != source:
        fail("Tag moved after candidate verification")
    body = notes(manifest["version"], manifest["channel"])
    marker = f"<!-- keyframe-candidate:{manifest['candidate_id']} manifest-sha256:{digest((Path(candidate) / 'candidate.json').read_bytes())} -->"
    base = f"https://api.github.com/repos/{repo}"
    release = find_release(base, tag)
    if release is None:
        release = api("POST", f"{base}/releases", {
            "tag_name": tag, "target_commitish": source, "name": tag,
            "body": body + "\n\n" + marker, "draft": True,
            "prerelease": manifest["channel"] != "stable", "generate_release_notes": True,
        })
    for name in PACKS:
        validate(candidate, tag, source)
        check_evidence(candidate, evidence_dir, manifest)
        check_run(repo, manifest)
        if remote_tag(repo, tag) != source:
            fail("Tag moved during promotion")
        release = find_release(base, tag)
        if release is None:
            fail("Draft release disappeared during promotion")
        assets = check_release(release, manifest, marker)
        if name in assets:
            continue
        upload_url = release["upload_url"].split("{")[0] + "?name=" + urllib.parse.quote(name)
        api("POST", upload_url, (Path(candidate) / name).read_bytes())
    release = find_release(base, tag)
    if release is None:
        fail("Release disappeared before final verification")
    if set(check_release(release, manifest, marker)) != set(PACKS):
        fail("Release assets are incomplete")
    if remote_tag(repo, tag) != source:
        fail("Tag moved before publication")
    if release["draft"]:
        api("PATCH", f"{base}/releases/{release['id']}", {"draft": False})


def main():
    command, *args = sys.argv[1:]
    if command == "manifest" and len(args) == 2:
        make_manifest(*args)
    elif command == "validate" and len(args) == 3:
        validate(*args)
    elif command == "evidence" and len(args) == 2:
        evidence(*args)
    elif command == "publish" and len(args) == 5:
        publish(*args)
    else:
        fail("Usage: release.py manifest|validate|evidence|publish ...")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError) as error:
        print(f"release: {error}", file=sys.stderr)
        sys.exit(1)

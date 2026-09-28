import http.server
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.request
import zipfile

from PIL import Image

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import release


class ReleaseCandidateTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        self.candidate = self.root / "candidate"
        self.candidate.mkdir()
        self.source = "a" * 40
        self.tag = "v0.1.0-alpha.1"
        self.version = "0.1.0-alpha.1"
        self.make_packs()
        self.manifest = {
            "schema": 1, "source_sha": self.source, "tag": self.tag,
            "version": self.version, "channel": "alpha",
            "run_id": 42, "attempt": 1,
            "candidate_id": f"42-1-{self.source[:12]}-{self.tag}",
            "artifact_name": "keyframe-candidate-42-1",
            "destinations": ["github-release"],
            "files": {name: release.digest((self.candidate / name).read_bytes()) for name in release.PACKS},
        }
        self.save()
        self.package = patch.object(release, "read_json", side_effect=self.read_json)
        self.package.start()
        self.addCleanup(self.package.stop)
        inventory = patch.object(
            release, "expected_assets",
            side_effect=lambda resolution, pbr=False: {
                "pack.mcmeta": None, "pack.png": (128, 128),
                "assets/minecraft/textures/block/stone.png": (resolution, resolution),
                "assets/minecraft/textures/block/grass.png": (resolution, resolution),
            },
        )
        inventory.start()
        self.addCleanup(inventory.stop)

    def read_json(self, path):
        if str(path) == "package.json":
            return {"version": self.version}
        return json.loads(Path(path).read_text(encoding="utf-8"))

    @staticmethod
    def png(width, height):
        output = io.BytesIO()
        Image.new("RGBA", (width, height), (120, 60, 30, 255)).save(output, format="PNG")
        return output.getvalue()

    def pack(self, size, version=None, include_icon=True):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr("pack.mcmeta", json.dumps(release.expected_metadata(size, version or self.version)))
            if include_icon:
                archive.writestr("pack.png", self.png(128, 128))
            archive.writestr("assets/minecraft/textures/block/stone.png", self.png(size, size))
            archive.writestr("assets/minecraft/textures/block/grass.png", self.png(size, size))
        return output.getvalue()

    def make_packs(self):
        for size in (512, 256, 128, 64, 32):
            (self.candidate / f"Keyframe-{size}x.zip").write_bytes(self.pack(size))

    def save(self):
        (self.candidate / "candidate.json").write_text(json.dumps(self.manifest), encoding="utf-8")

    def test_complete_candidate(self):
        self.assertEqual(release.validate(self.candidate, self.tag, self.source), self.manifest)

    def test_missing_extra_changed_and_broken_packs(self):
        for mutation in ("missing", "extra", "changed", "crc", "icon", "version"):
            with self.subTest(mutation=mutation):
                target = self.candidate / release.PACKS[0]
                original = target.read_bytes()
                if mutation == "missing":
                    target.unlink()
                elif mutation == "extra":
                    (self.candidate / "unexpected.zip").write_bytes(b"x")
                elif mutation == "changed":
                    target.write_bytes(original + b"x")
                elif mutation == "crc":
                    target.write_bytes(b"not a ZIP")
                    self.manifest["files"][target.name] = release.digest(target.read_bytes())
                    self.save()
                elif mutation == "icon":
                    target.write_bytes(self.pack(512, include_icon=False))
                    self.manifest["files"][target.name] = release.digest(target.read_bytes())
                    self.save()
                else:
                    target.write_bytes(self.pack(512, version="0.9.0"))
                    self.manifest["files"][target.name] = release.digest(target.read_bytes())
                    self.save()
                with self.assertRaises(ValueError):
                    release.validate(self.candidate, self.tag, self.source)
                target.write_bytes(original)
                (self.candidate / "unexpected.zip").unlink(missing_ok=True)
                self.manifest["files"][target.name] = release.digest(original)
                self.save()

    def rewrite_pack(self, changed=None, removed=(), added=None):
        target = self.candidate / release.PACKS[0]
        output = io.BytesIO()
        with zipfile.ZipFile(target) as original, zipfile.ZipFile(output, "w") as archive:
            for entry in original.infolist():
                if entry.filename not in removed:
                    archive.writestr(entry, (changed or {}).get(entry.filename, original.read(entry)))
            for name, data in (added or {}).items():
                archive.writestr(name, data)
        target.write_bytes(output.getvalue())
        # Rehash deliberately: these failures must come from artifact tests, not digest checks.
        self.manifest["files"][target.name] = release.digest(target.read_bytes())
        self.save()

    def test_rehashed_malformed_truncated_and_wrong_dimension_pngs(self):
        for asset in ("pack.png", "assets/minecraft/textures/block/stone.png"):
            for data in (release.PNG + b"not-an-image", self.png(512, 512)[:-12],
                         self.png(32, 32), self.png(512, 1024)):
                with self.subTest(asset=asset, bytes=len(data)):
                    self.rewrite_pack(changed={asset: data})
                    with self.assertRaises(ValueError):
                        release.validate(self.candidate, self.tag, self.source)
                    self.make_packs()

    def test_rehashed_missing_alias_and_extra_internal_entries(self):
        self.rewrite_pack(removed=("assets/minecraft/textures/block/grass.png",))
        with self.assertRaisesRegex(ValueError, "inventory mismatch"):
            release.validate(self.candidate, self.tag, self.source)
        self.make_packs()
        for name, data in (("assets/minecraft/textures/block/extra.png", self.png(512, 512)),
                           ("assets/minecraft/models/extra.json", b"{}"),
                           ("assets/minecraft/textures/block/stone_n.png", self.png(512, 512))):
            with self.subTest(name=name):
                self.rewrite_pack(added={name: data})
                with self.assertRaisesRegex(ValueError, "inventory mismatch"):
                    release.validate(self.candidate, self.tag, self.source)
                self.make_packs()

    def test_corrupted_download_cannot_receive_passing_evidence(self):
        self.rewrite_pack(changed={"assets/minecraft/textures/block/stone.png": release.PNG + b"bad"})
        destination = self.root / "evidence"
        with patch.dict(os.environ, {"GITHUB_RUN_ID": "42", "GITHUB_RUN_ATTEMPT": "1"}):
            with self.assertRaisesRegex(ValueError, "Invalid PNG"):
                release.evidence(self.candidate, destination)
        self.assertFalse(destination.exists())

    def test_tag_and_identity_mismatch(self):
        for tag, source in (("v0.1.0-beta.1", self.source), (self.tag, "b" * 40)):
            with self.assertRaises(ValueError):
                release.validate(self.candidate, tag, source)
        self.version = "0.1.1"
        with self.assertRaises(ValueError):
            release.validate(self.candidate, self.tag, self.source)

    def test_evidence_rejects_changed_digest_and_candidate(self):
        evidence_dir = self.root / "evidence"
        with patch.dict(os.environ, {"GITHUB_RUN_ID": "42", "GITHUB_RUN_ATTEMPT": "1"}):
            release.evidence(self.candidate, evidence_dir)
        release.check_evidence(self.candidate, evidence_dir, self.manifest)
        record = release.read_json(evidence_dir / "evidence.json")
        record["files"][release.PACKS[0]] = "0" * 64
        (evidence_dir / "evidence.json").write_text(json.dumps(record), encoding="utf-8")
        with self.assertRaises(ValueError):
            release.check_evidence(self.candidate, evidence_dir, self.manifest)

    def test_partial_release_accepts_only_matching_assets(self):
        name = release.PACKS[0]
        data = (self.candidate / name).read_bytes()
        marker = "<!-- identity -->"
        remote = {
            "tag_name": self.tag, "prerelease": True,
            "target_commitish": self.source, "body": marker,
            "assets": [{"name": name, "state": "uploaded", "url": "asset"}],
        }
        with patch.object(release, "api", return_value=data):
            self.assertEqual(set(release.check_release(remote, self.manifest, marker)), {name})
        with patch.object(release, "api", return_value=b"wrong"):
            with self.assertRaises(ValueError):
                release.check_release(remote, self.manifest, marker)
        remote["assets"].append({"name": "other.zip", "state": "uploaded", "url": "other"})
        with self.assertRaises(ValueError):
            release.check_release(remote, self.manifest, marker)

    def test_retry_uploads_only_missing_assets(self):
        evidence_dir = self.root / "evidence"
        with patch.dict(os.environ, {"GITHUB_RUN_ID": "42", "GITHUB_RUN_ATTEMPT": "1"}):
            release.evidence(self.candidate, evidence_dir)
        marker = (
            f"<!-- keyframe-candidate:{self.manifest['candidate_id']} "
            f"manifest-sha256:{release.digest((self.candidate / 'candidate.json').read_bytes())} -->"
        )
        first = release.PACKS[0]
        remote = {
            "tag_name": self.tag, "prerelease": True,
            "target_commitish": self.source, "body": marker, "draft": True,
            "upload_url": "https://uploads.github.com/upload{?name}",
            "id": 100, "assets": [{"name": first, "state": "uploaded", "url": first}],
        }
        uploaded = []

        def fake_api(method, url, payload=None, accept=None):
            if method == "GET" and "/releases?per_page=" in url:
                return [remote]
            if method == "GET" and url in release.PACKS:
                return (self.candidate / url).read_bytes()
            if method == "POST" and url.startswith("https://uploads.github.com/upload?name="):
                name = url.split("name=", 1)[1]
                uploaded.append(name)
                self.assertEqual(payload, (self.candidate / name).read_bytes())
                remote["assets"].append({"name": name, "state": "uploaded", "url": name})
                return b""
            if method == "PATCH":
                remote["draft"] = False
                return remote
            self.fail(f"Unexpected API call: {method} {url}")

        with (
            patch.dict(os.environ, {"GITHUB_REPOSITORY": "Ninja6-MC/Keyframe"}),
            patch.object(release, "api", side_effect=fake_api),
            patch.object(release, "remote_tag", return_value=self.source),
            patch.object(release, "check_run"),
            patch.object(release, "notes", return_value="notes"),
        ):
            release.publish(self.candidate, evidence_dir, self.tag, self.source, "42")
        self.assertEqual(uploaded, list(release.PACKS[1:]))
        self.assertFalse(remote["draft"])

    def test_moved_tag_stops_before_release_write(self):
        evidence_dir = self.root / "evidence"
        with patch.dict(os.environ, {"GITHUB_RUN_ID": "42", "GITHUB_RUN_ATTEMPT": "1"}):
            release.evidence(self.candidate, evidence_dir)
        with (
            patch.dict(os.environ, {"GITHUB_REPOSITORY": "Ninja6-MC/Keyframe"}),
            patch.object(release, "remote_tag", return_value="b" * 40),
            patch.object(release, "check_run"),
            patch.object(release, "api") as api,
        ):
            with self.assertRaises(ValueError):
                release.publish(self.candidate, evidence_dir, self.tag, self.source, "42")
            api.assert_not_called()

    def test_token_is_not_forwarded_to_redirect_host(self):
        seen = {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                seen[self.server.name] = self.headers.get("Authorization")
                if self.server.name == "api":
                    self.send_response(302)
                    self.send_header("Location", f"http://127.0.0.1:{cdn.server_port}/asset")
                    self.end_headers()
                    return
                self.send_response(200)
                self.end_headers()
                self.wfile.write(b"pack")

            def log_message(self, *args):
                pass

        servers = []
        for name in ("api", "cdn"):
            server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
            server.name = name
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
            servers.append(server)
        api_server, cdn = servers
        with patch.dict(os.environ, {"GH_TOKEN": "secret"}):
            body = release.api("GET", f"http://127.0.0.1:{api_server.server_port}/asset", accept="application/octet-stream")
        self.assertEqual(body, b"pack")
        self.assertEqual(seen, {"api": "Bearer secret", "cdn": None})

    def test_token_is_not_forwarded_on_scheme_downgrade(self):
        handler = release.SameHostAuthRedirect()

        def follow(newurl):
            req = urllib.request.Request("https://api.github.com/asset", headers={"Authorization": "Bearer secret"})
            return handler.redirect_request(req, None, 302, "Found", {}, newurl)

        self.assertIsNone(follow("http://api.github.com/asset").get_header("Authorization"))
        self.assertEqual(follow("https://api.github.com/other").get_header("Authorization"), "Bearer secret")


class ArtifactInventoryTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.root)
        previous = Path.cwd()
        os.chdir(self.root)
        self.addCleanup(os.chdir, previous)
        source = Path("textures/block")
        source.mkdir(parents=True)
        Path("tools/lib").mkdir(parents=True)
        profile_source = Path(__file__).resolve().parents[1] / "pack-profile.json"
        Path("tools/pack-profile.json").write_bytes(profile_source.read_bytes())
        Path("tools/lib/animation-packager.mjs").write_text("export const DEFAULT_ANIMATION_PRESETS = {\n  lava: {},\n};")
        Path("pack_template/assets/minecraft/models/block").mkdir(parents=True)
        Path("pack_template/assets/minecraft/models/block/stone.json").write_text("{}")
        svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"/>'
        for stem in ("stone", "short_grass", "short_grass_1", "short_grass_2", "grass_block_side_overlay", "wool.template"):
            (source / (stem + ".svg")).write_text(svg)
        (source / "water.svg").write_text(svg.replace("512 512", "512 1536"))
        (source / "water.svg.mcmeta").write_text('{"animation":{"frames":[0,1,2]}}')

    def pack(self, inventory, size=32):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            for name, dimensions in inventory.items():
                if dimensions:
                    data = ReleaseCandidateTests.png(*dimensions)
                elif name == "pack.mcmeta":
                    data = json.dumps(release.expected_metadata(size, "0.1.0-alpha.1"))
                elif name.endswith(".png.mcmeta"):
                    data = '{"animation":{"frames":[0,1,2]}}'
                else:
                    data = '{}'
                archive.writestr(name, data)
        return output.getvalue()

    def test_complete_generated_inventory_and_pbr_missing_map(self):
        plain = release.expected_assets(32)
        inventory = release.expected_assets(32, pbr=True)
        base = "assets/minecraft/textures/block/"
        self.assertIn(base + "red_wool.png", plain)
        self.assertNotIn(base + "wool.template.png", plain)
        self.assertIn(base + "grass_2.png", plain)
        self.assertEqual(inventory[base + "water.png"], (32, 96))
        self.assertIn(base + "grass_n.png", inventory)
        self.assertIn(base + "red_wool_s.png", inventory)
        self.assertNotIn(base + "grass_block_side_overlay_n.png", inventory)
        release.check_pack(self.pack(plain), "Keyframe-32x.zip", "0.1.0-alpha.1")
        release.check_pack(self.pack(inventory), "Keyframe-32x.zip", "0.1.0-alpha.1", pbr=True)
        for missing in (base + "grass_n.png", base + "red_wool_s.png", base + "grass_1.png"):
            with self.subTest(missing=missing):
                incomplete = {name: value for name, value in inventory.items() if name != missing}
                with self.assertRaisesRegex(ValueError, "inventory mismatch"):
                    release.check_pack(self.pack(incomplete), "Keyframe-32x.zip", "0.1.0-alpha.1", pbr=True)

    def test_compiled_animation_folder_inventory(self):
        frames = Path("textures/block/lava")
        frames.mkdir()
        for index in range(3):
            (frames / f"{index}.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"/>')
        inventory = release.expected_assets(32)
        self.assertEqual(inventory["assets/minecraft/textures/block/lava.png"], (32, 96))
        self.assertIn("assets/minecraft/textures/block/lava.png.mcmeta", inventory)
        release.check_pack(self.pack(inventory), "Keyframe-32x.zip", "0.1.0-alpha.1")

    def test_animation_layout_and_frame_indices(self):
        release.check_animation({"animation": {"frames": [0, {"index": 2, "time": 4}]}}, (32, 96), 32, "water")
        for metadata in ({"animation": {"frames": [3]}}, {"animation": {"height": 31}},
                         {"animation": {"frames": [{"index": 0, "time": 0}]}},
                         {"animation": {"frametime": 0}}):
            with self.subTest(metadata=metadata), self.assertRaises(ValueError):
                release.check_animation(metadata, (32, 96), 32, "water")


@unittest.skipUnless(os.environ.get("KEYFRAME_CANDIDATE_DIR"), "No downloaded candidate supplied")
class DownloadedArtifactTests(unittest.TestCase):
    def test_candidate_bytes_and_rehashed_corruptions(self):
        candidate = Path(os.environ["KEYFRAME_CANDIDATE_DIR"]).resolve()
        manifest = release.read_json(candidate / "candidate.json")
        release.validate(candidate, manifest["tag"], manifest["source_sha"])
        originals = {name: (candidate / name).read_bytes() for name in release.PACKS}
        for name, data in originals.items():
            size = int(name.removeprefix("Keyframe-").removesuffix("x.zip"))
            metadata_mutations = ("format_negative", "format_wrong", "format_bool", "format_float", "format_missing",
                                  "supported_missing", "supported_list", "minimum_wrong", "maximum_wrong",
                                  "minimum_missing", "maximum_missing", "minimum_bool", "maximum_float",
                                  "description_missing", "description_wrong", "pack_null", "metadata_list")
            for mutation in ("malformed", "truncated", "dimensions", "alias", "extra", *metadata_mutations):
                with self.subTest(pack=name, mutation=mutation), tempfile.TemporaryDirectory() as temporary:
                    changed = Path(temporary)
                    shutil.copytree(candidate, changed, dirs_exist_ok=True)
                    output = io.BytesIO()
                    with zipfile.ZipFile(io.BytesIO(data)) as original, zipfile.ZipFile(output, "w") as archive:
                        for entry in original.infolist():
                            payload = original.read(entry)
                            if entry.filename == "pack.mcmeta" and mutation in metadata_mutations:
                                metadata = json.loads(payload)
                                pack = metadata["pack"]
                                if mutation == "format_negative":
                                    pack["pack_format"] = -1
                                elif mutation == "format_wrong":
                                    pack["pack_format"] = 47
                                elif mutation == "format_bool":
                                    pack["pack_format"] = True
                                elif mutation == "format_float":
                                    pack["pack_format"] = 46.0
                                elif mutation == "format_missing":
                                    del pack["pack_format"]
                                elif mutation == "supported_missing":
                                    del pack["supported_formats"]
                                elif mutation == "supported_list":
                                    pack["supported_formats"] = [15, 46]
                                elif mutation.startswith("minimum_"):
                                    field = "min_inclusive"
                                    if mutation == "minimum_missing":
                                        del pack["supported_formats"][field]
                                    else:
                                        pack["supported_formats"][field] = True if mutation == "minimum_bool" else 14
                                elif mutation.startswith("maximum_"):
                                    field = "max_inclusive"
                                    if mutation == "maximum_missing":
                                        del pack["supported_formats"][field]
                                    else:
                                        pack["supported_formats"][field] = 46.0 if mutation == "maximum_float" else 47
                                elif mutation == "description_missing":
                                    del pack["description"]
                                elif mutation == "description_wrong":
                                    pack["description"] = f"Misadvertised {size}x pack"
                                elif mutation == "pack_null":
                                    metadata["pack"] = None
                                elif mutation == "metadata_list":
                                    metadata = []
                                payload = json.dumps(metadata)
                            if entry.filename == "assets/minecraft/textures/block/grass.png" and mutation == "alias":
                                continue
                            if entry.filename == "assets/minecraft/textures/block/stone.png":
                                if mutation == "malformed":
                                    payload = release.PNG + b"not-an-image"
                                elif mutation == "truncated":
                                    payload = payload[:-12]
                                elif mutation == "dimensions":
                                    payload = ReleaseCandidateTests.png(size // 2, size // 2)
                            archive.writestr(entry, payload)
                        if mutation == "extra":
                            archive.writestr("assets/minecraft/models/unexpected.json", "{}")
                    (changed / name).write_bytes(output.getvalue())
                    changed_manifest = {**manifest, "files": {**manifest["files"], name: release.digest(output.getvalue())}}
                    (changed / "candidate.json").write_text(json.dumps(changed_manifest), encoding="utf-8")
                    with self.assertRaises(ValueError):
                        release.validate(changed, manifest["tag"], manifest["source_sha"])
        self.assertEqual(originals, {name: (candidate / name).read_bytes() for name in release.PACKS})


if __name__ == "__main__":
    unittest.main()

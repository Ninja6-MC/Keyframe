import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch
import zipfile

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
            return_value={"assets/minecraft/textures/block/stone.png"},
        )
        inventory.start()
        self.addCleanup(inventory.stop)

    def read_json(self, path):
        if str(path) == "package.json":
            return {"version": self.version}
        return json.loads(Path(path).read_text(encoding="utf-8"))

    def pack(self, size, version=None, include_icon=True):
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as archive:
            archive.writestr("pack.mcmeta", json.dumps({
                "keyframe_version": version or self.version,
                "pack": {"pack_format": 46, "description": f"Keyframe {size}x"},
            }))
            if include_icon:
                archive.writestr("pack.png", release.PNG + b"icon")
            archive.writestr("assets/minecraft/textures/block/stone.png", release.PNG + b"stone")
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


if __name__ == "__main__":
    unittest.main()

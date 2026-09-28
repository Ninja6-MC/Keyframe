# Keyframe Release Lifecycle & Publishing Guide

This document defines the versioning rules, release channels and publishing procedure for
**Keyframe**.

Keyframe is **pre-1.0 and not distributed anywhere but this repository.** Both facts are
deliberate and are stated here rather than left to be inferred — see §2 and §5.

---

## 1. Versioning Rules (SemVer 2.0.0, pre-1.0 track)

Every release is `0.MINOR.PATCH[-PRERELEASE]`. The leading zero is the point: under SemVer
a `0.y.z` version declares that the pack's contents and structure are **not yet stable**
and may change in any minor bump.

* **MINOR (`0.X.0`)** — new blocks or block families, a reworked master, a `pack_format`
  bump, or any change that alters what a player sees.
* **PATCH (`0.1.X`)** — corrections to existing artwork, seams, palettes or build output
  that do not add or remove coverage.
* **Pre-releases**:
  * `v0.1.0-alpha.1` — internal, incomplete, expected to break
  * `v0.1.0-beta.1` — feature-complete for that version, wanting testing

**There is no `1.0.0` on the roadmap yet.** 1.0 means the block coverage is broad enough
and stable enough that removing or reworking a texture becomes a breaking change. Keyframe
is not close, and versioning it as though it were would promise a stability the pack does
not have.

## 2. Release Channels

Channels are tiers of the same GitHub Release, **not** separate distribution platforms.

| Channel | Tag | Published as |
| :--- | :--- | :--- |
| **Alpha** | `v0.1.0-alpha.1` | GitHub **pre-release** |
| **Beta** | `v0.1.0-beta.1` | GitHub **pre-release** |
| **Stable** | `v0.1.0` | GitHub **latest release** |

The tier is derived from the tag, not chosen by hand: any tag containing a SemVer
pre-release suffix publishes as a pre-release. That is what stops an alpha appearing as the
download a casual visitor gets.

## 3. How to Execute a Release

### Step 1: Pre-release checklist

* `main` is green.
* `package.json` `version` matches the tag you are about to cut, without the leading `v`.
* For a **stable** release, `CHANGELOG.md` has a `## [0.MINOR.PATCH]` section — the
  `[Unreleased]` entries moved under a real heading. The release workflow enforces this and
  will fail the release otherwise. Pre-releases may ship without one.

### Step 2: Build and verify the candidate

From the current `main` commit, dispatch **Release** with `operation=candidate` and
`tag=v0.MINOR.PATCH[-alpha.N|-beta.N]`. The workflow builds the five ZIPs once,
records the source SHA, tag, version, channel, run ID and attempt, artifact name,
destinations, exact filenames and SHA-256 digests in `candidate.json`, and retains
the candidate artifact for 30 days.

A separate job downloads the retained artifact. It rejects missing, extra or changed
ZIPs, checks ZIP integrity, the embedded version in `pack.mcmeta`, the resolution,
`pack.png` (128x128), and the complete source-derived inventory under `assets/`
including compatibility aliases. Every PNG is decoded and checked against its
source dimensions at the intended resolution; animation metadata must match the
frame layout. The release profile is the default trailer palette without PBR maps,
so unrequested normal/specular maps and other extra assets are rejected. The artifact
test suite exercises the downloaded ZIP bytes at every resolution and verifies that
rehashed corrupt images, incorrect dimensions, missing aliases and extra entries
fail. It then runs `npm test` for source and compiler coverage. A passing
run retains `evidence.json` for 30 days with the candidate ID, manifest digest,
per-ZIP digests and verification run. The source tests exercise the compiler;
the direct ZIP checks exercise the finished packs. They do not visually inspect
textures in Minecraft, which remains a release review step.

Use a successful candidate run ID and attempt. Do not edit or repack its ZIPs.

### Step 3: Cut the tag

```bash
git checkout main && git pull
git tag v0.1.0-alpha.1 <candidate-source-sha>
git push origin v0.1.0-alpha.1
```

### Step 4: Approve and promote

Dispatch **Release** on the exact tag ref with `operation=promote`, the same
`tag`, `candidate_run_id` and `candidate_run_attempt`. A tag push alone never
publishes. The publisher waits for the maintainer's approval in the protected
`release` environment; only `v*` tag deployments are allowed and administrator
bypass is disabled. Approval is for that candidate and GitHub Releases destination.

After approval, the publisher downloads the retained candidate and test evidence.
It checks the successful originating run, manifest, ZIPs, evidence, package version,
channel and the tag's current source commit. It then creates a draft GitHub Release,
uploads exactly the tested ZIPs, downloads each published asset to compare its digest,
and makes the release public only after all five assets match. The pre-release flag
comes from the tag. Changelog notes remain the release body, with generated notes
appended. The stable changelog section is mandatory.

The workflow has no build or packaging step after verification. Only its protected
publisher job has `contents: write`.

### Retry and reconciliation

Rerun promotion with the same candidate run ID and attempt while both retained
artifacts remain available. The publisher compares release identity, source,
channel and every existing asset's downloaded digest, then uploads only missing
matching ZIPs. It never replaces an asset. Missing or expired artifacts, a moved
tag, changed bytes, an unknown asset or different release metadata stop the run.
The maintainer must inspect and reconcile the public release before retrying;
the workflow does not rebuild or silently repair conflicting bytes. A draft with
all matching assets can be finalized by a retry. GitHub Releases is the only
destination, so there is no cross-destination ordering.

## 4. Repository Secrets

**None.** The release path uses only the workflow's own `GITHUB_TOKEN`, granted
`contents: write` and `actions: read` on the protected publishing job alone.
Candidate and verification jobs have `contents: read`; nothing is published to a registry.

## 5. Distribution — deliberately GitHub-only, for now

Keyframe is **not** on Modrinth, CurseForge, PlanetMinecraft or the Bedrock Marketplace,
and is not ready to be. The GitHub Release on this repository is the only official source.

This is not merely a to-do. `LICENSE` forbids rehosting and mirroring, and requires that
downloads link directly to official Ninja6-MC distribution pages — so **adding a channel is
a licensing decision, not a publishing convenience.** Whatever platform is added becomes an
official page for the purposes of that licence, and the licence text has to be reconciled
with that platform's own redistribution terms before anything is uploaded.

Adding a channel therefore means, in order: decide the platform, check its terms against
`LICENSE`, add the upload step and its secret to `release.yml`, and update §2 and this
section in the same pull request.

## 6. Validating the Release Path

`release.yml` runs only through `workflow_dispatch`. The pull-request CI builds all five
packs and runs the release validator's negative tests, but cannot prove environment approval
or GitHub Releases API behavior. A candidate dispatch proves retention and downloaded-pack
verification. Only a tag-ref promotion after maintainer approval exercises publication.

**A bump to an action used only in `release.yml` is not covered by pull-request CI.**
Exercise a candidate dispatch and record the result. Publisher-only changes require an
approved tag-ref promotion before their publication path can be called exercised.

### Exercise record

| Date | Commit | Tag | Outcome |
| :--- | :--- | :--- | :--- |
| 2026-09-02 | `81472f3` | `v0.1.0-alpha.1`, deleted afterwards | green |

That run was the first time `softprops/action-gh-release` v3.0.2 had executed on this
repository; it arrived by dependency bump and had never run here. Every step ran, the
`refs/tags/` guard let the publishing step through, the release was created as a pre-release
and not a draft, all five zips attached at plausible sizes, the pre-release fallback note
appeared above GitHub's generated notes, and the downloaded 512× zip unpacked to a real
pack — `pack.mcmeta`, `pack.png` and 33 PNGs under `assets/minecraft/textures/block/`. The
release and the tag were deleted immediately afterwards, leaving the repository with no
releases and no tags, so the alpha can be cut for real under the same name.

The v3 release notes were read at the same time, which is the other half of what the bump
skipped: v3.0.0 moved the action's runtime from Node 20 to Node 24, v3.0.1 was dependency
maintenance, and v3.0.2 hardened asset uploads and release-creation diagnostics. None of
them changed the behaviour of the `files`, `body`, `draft`, `prerelease` or
`generate_release_notes` inputs this workflow uses.

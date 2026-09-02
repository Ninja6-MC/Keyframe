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

### Step 2: Cut the tag

```bash
git checkout main && git pull
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

### Step 3: Automated CI actions

`release.yml` then compiles the five resolutions (512×, 256×, 128×, 64×, 32×), attaches
them to a GitHub Release, and sets the pre-release flag from the tag. Release notes come
from the matching `CHANGELOG.md` section where one exists, with GitHub's generated notes
appended.

## 4. Repository Secrets

**None.** The release path uses only the workflow's own `GITHUB_TOKEN`, granted
`contents: write` on the publishing job alone. Nothing here needs a registry token, because
nothing is published to a registry.

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

`release.yml` runs only on a pushed `v*` tag and on `workflow_dispatch`. No pull request
ever triggers it, so a green pull-request check says nothing about whether the release job
works. A `workflow_dispatch` run is not a substitute either: it leaves `github.ref` on a
branch, so the publishing step's `if: startsWith(github.ref, 'refs/tags/')` guard skips it,
and only the build and notes steps are proven.

**A bump to any action used only in `release.yml` therefore cannot be validated by CI.**
Either exercise the path — push a pre-release tag, let the run publish, verify the attached
zips, then delete the release and the tag — or say plainly in the pull request that the bump
was merged unexercised. Either is acceptable; treating a green tick as though it had covered
the release job is not.

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
release and the tag were deleted immediately afterwards, so the first `v0.1.0-alpha.1` in
this repository's history will still be the real one.

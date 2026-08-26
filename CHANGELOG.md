# Changelog

All notable changes to **Keyframe** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Keyframe is pre-1.0. Under SemVer that means the pack's contents and structure may change
in any `0.MINOR` bump — see [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md).

---

## [Unreleased]

### Added
- `bedrock` — chaotic tectonic stone plates with interior highlights and 100% periodic
  toroidal boundary continuity.
- `deepslate` and `deepslate_top`, and `infested_deepslate`.
- `dirt`, `grass_block`, `dirt_path`.
- The oak set: `oak_leaves`, `oak_log`, `oak_planks`, `oak_fence`, `oak_slab`,
  `oak_stairs`, `oak_fence_gate`, `oak_button`, `oak_hanging_sign`,
  `oak_pressure_plate`, `oak_sign`.
- `short_grass` and `tall_grass` — 512×512 vector masters mapped to vanilla 16×16
  geometry, with three weighted blockstate variations and a seamless two-block junction.
- Ground substrates batch: `gravel`, `coarse_dirt`, `clay`, and `suspicious_gravel`
  (4 progressive archaeological dusting stages) with single-variant un-rotated blockstates
  and seamless toroidal tiling.
- Multi-resolution compiler: 512×, 256×, 128×, 64× and 32× packs built from one set of
  vector masters.

### Changed
- `water` returned to the vanilla default pending a rework.

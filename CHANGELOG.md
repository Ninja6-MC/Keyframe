# Changelog

All notable changes to **Keyframe** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Keyframe is pre-1.0. Under SemVer that means the pack's contents and structure may change
in any `0.MINOR` bump — see [`RELEASE_PROCESS.md`](RELEASE_PROCESS.md).

---

## [Unreleased]

### Added
- LabPBR 1.3 material matrix in `tools/lib/pbr-rules.json`: stone and deepslate ores,
  metal blocks (hardcoded metal IDs 230/231/234, albedo-driven `255` for netherite),
  minerals and masonry, glass, terracotta, glazed terracotta, concrete and concrete
  powder. Gem F0 and crying obsidian tear emission are scoped to `colorFeatures` so the
  host rock stays dielectric and non-emissive (#53).
- Compiler guardrail against loose root SVG masters: `tools/build.mjs` enforces that all
  vector masters sit in valid category subdirectories (`textures/block/`, `textures/item/`,
  etc.) before rasterization, failing the build if root-level SVGs are detected. Excised
  obsolete root-level grass block pack icon fallback (#226).
- Shared-base contract enforcement for ore masters: `tools/base-sync.json` registers each
  base master and its derivatives, `tools/lib/base-sync.mjs` verifies that the striation
  groove definitions (including every corner radius `rx`) and the `stone_base` placement
  group are identical, and `npm run build` now fails before rasterizing if they drift.
  Unregistered files that copy the stone base are reported too (#28).
- Stone and ores set: `stone`, `diamond_ore`, and `coal_ore` — 512×512 vector masters with
  3D pop-down recessed striation grooves, high-contrast 3D pop-up mineral nodules and crystals,
  un-rotated stone blockstate override, and synchronized stone backgrounds (#28).
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
- Re-inspected and verified Balanced Warm Umber soil palette in TextureStudio 3D terrain presets (stepped cliff faces, trail cuts, and flat ground platforms), confirmed zero double-tinting on grass side overhang, and closed deferred criteria from #37 (#201).
- Converted the Toroidal Tiling and Seam Audit in CI into a blocking gate after eliminating all legacy seam debt (#206).
- Soil palette revised to **Balanced Warm Umber** across `dirt`, `grass_block_side`,
  `dirt_path_top` and `dirt_path_side`. Base soil moves `#d98827` → `#c77d38`: the
  lightness ladder of every soil role is held exactly, so clod and bevel relief contrast
  is unchanged, while chroma drops ~15 points and the hue is pulled from 33° to 29° to
  meet `coarse_dirt` (28.5°). Fixes the over-saturated orange cast on large exposed cliff
  faces and the hue disparity with adjacent earth blocks (#37).
- `grass_block_top` updated with Deepslate-style 3D rectangular strata plates and ambient crevice drop shadows establishing tactile ground turf relief (#34).
- `dirt_path_top` updated with Deepslate-style 3D rectangular strata plates and warm crevice drop shadows establishing authentic sunlit footpath relief (#34).
- `water` returned to the vanilla default pending a rework.

### Fixed
- Correct toroidal seam wrapping coordinate offsets in `coarse_dirt.svg` to achieve perfect Δ=0 periodic boundary continuity (#200).
- Correct toroidal seam wrapping coordinate offsets in `sand.svg` and `red_sand.svg` to achieve perfect Δ=0 periodic boundary continuity (#64, #206).
- Correct toroidal seam wrapping coordinate offsets in `gravel.svg` and `suspicious_gravel_0..3.svg` to achieve perfect Δ=0 periodic boundary continuity (#63, #206).
- Corrected toroidal seam wrapping offsets on `block/clay.svg` (#66) (#206).
- Corrected toroidal seam wrapping offsets on `block/oak_planks.svg`, `block/oak_log.svg`, and `block/oak_log_top.svg` (#88) (#206).
- Corrected toroidal seam wrapping offsets on `block/bedrock.svg`, `block/deepslate.svg`, and `block/deepslate_top.svg` (#77) (#206).

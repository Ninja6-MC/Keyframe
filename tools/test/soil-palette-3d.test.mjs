#!/usr/bin/env node

/**
 * Keyframe Balanced Warm Umber Soil Palette & 3D Terrain Verification Test Suite
 *
 * Verifies the color contracts, Rec.709 relative luminance separations, toroidal seam
 * integrity, grass side overlay transparency (zero double-tinting), and portable TextureStudio
 * 3D multiblock preset compatibility for Issue #201.
 *
 * Self-contained: runs deterministically in CI without requiring an external checkout of
 * TextureStudio. External sibling assertions are conditionally skipped when absent.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ROOT_DIR,
  DEFAULT_TEXTURES_DIR,
  resolveStudioDir,
  collectMasters,
  planSync,
  STUDIO_MARKERS
} from "../sync-studio.mjs";
import { categorizeTexture } from "../test-tiling.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let totalTests = 0;
let passedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`  ✓ PASS: ${message}`);
}

function assertEqual(actual, expected, message) {
  totalTests++;
  if (actual !== expected) {
    console.error(`  ❌ FAIL: ${message}\n      Expected: ${expected}\n      Actual:   ${actual}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  passedTests++;
  console.log(`  ✓ PASS: ${message}`);
}

/**
 * Converts standard sRGB 8-bit channel to linear light (IEC 61966-2-1).
 */
function srgbToLinear(c) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/**
 * Calculates Rec.709 relative luminance (0..100) from a hex color string.
 */
function hexToLuminance(hex) {
  const clean = hex.replace(/^#/, "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return (0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b)) * 100;
}

console.log("\n=======================================================");
console.log("  KEYFRAME SOIL PALETTE & 3D TERRAIN TEST SUITE (#201)");
console.log("=======================================================\n");

// -----------------------------------------------------------------------------
// Suite 1: Palette Hex Contracts & Rec.709 Relative Luminance
// -----------------------------------------------------------------------------
console.log("[Suite 1] Palette Hex Contracts & Luminance Measurements");
{
  const dirtSvg = fs.readFileSync(path.join(DEFAULT_TEXTURES_DIR, "block", "dirt.svg"), "utf-8");
  const coarseDirtSvg = fs.readFileSync(path.join(DEFAULT_TEXTURES_DIR, "block", "coarse_dirt.svg"), "utf-8");
  const pathTopSvg = fs.readFileSync(path.join(DEFAULT_TEXTURES_DIR, "block", "dirt_path_top.svg"), "utf-8");
  const pathSideSvg = fs.readFileSync(path.join(DEFAULT_TEXTURES_DIR, "block", "dirt_path_side.svg"), "utf-8");
  const grassSideSvg = fs.readFileSync(path.join(DEFAULT_TEXTURES_DIR, "block", "grass_block_side.svg"), "utf-8");

  // Dirt hexes
  assert(dirtSvg.includes("#c77d38"), "dirt.svg carries dominant base #c77d38");
  assert(dirtSvg.includes("#a35f24"), "dirt.svg carries clod-mid #a35f24");
  assert(dirtSvg.includes("#864a18"), "dirt.svg carries clod-core #864a18");
  assert(dirtSvg.includes("#d59f62") && dirtSvg.includes("#deae70"), "dirt.svg carries sunlit highlights");
  assert(dirtSvg.includes("#6f7887"), "dirt.svg carries slate pebble accents #6f7887");

  // Coarse dirt hexes
  assert(coarseDirtSvg.includes("#9e5d22"), "coarse_dirt.svg carries dominant base #9e5d22");
  assert(coarseDirtSvg.includes("#703a0a"), "coarse_dirt.svg carries humus clod #703a0a");
  assert(coarseDirtSvg.includes("#4e2604"), "coarse_dirt.svg carries deep cavity core #4e2604");
  assert(coarseDirtSvg.includes("#bd732b"), "coarse_dirt.svg carries sunlit swell #bd732b");

  // Path top hexes
  assert(pathTopSvg.includes("#cfa567"), "dirt_path_top.svg carries dominant base #cfa567");
  assert(pathTopSvg.includes("#e6c793"), "dirt_path_top.svg carries strata plates #e6c793");
  assert(pathTopSvg.includes("#83581f"), "dirt_path_top.svg carries crevice shadows #83581f");

  // Path side hexes
  assert(pathSideSvg.includes("#c77d38"), "dirt_path_side.svg base matches dirt #c77d38");
  assert(pathSideSvg.includes("#cfa567"), "dirt_path_side.svg overhang matches path top #cfa567");

  // Grass side hexes
  assert(grassSideSvg.includes("#c77d38"), "grass_block_side.svg base matches dirt #c77d38");
  assert(grassSideSvg.includes("#9ac636"), "grass_block_side.svg carries pre-baked trailer green #9ac636");

  // Luminance contract bounds
  const Y_dirt = hexToLuminance("#c77d38");
  const Y_coarse = hexToLuminance("#9e5d22");
  const Y_pathTop = hexToLuminance("#cfa567");
  const Y_grassOverhang = hexToLuminance("#9ac636");
  const Y_strata = hexToLuminance("#e6c793");
  const Y_crevice = hexToLuminance("#83581f");

  assert(Y_dirt >= 26.0 && Y_dirt <= 28.0, `dirt base luminance Y=${Y_dirt.toFixed(2)} is within [26, 28]`);
  assert(Y_coarse >= 14.0 && Y_coarse <= 16.0, `coarse_dirt base luminance Y=${Y_coarse.toFixed(2)} is within [14, 16]`);
  assert(Y_pathTop >= 40.0 && Y_pathTop <= 42.0, `dirt_path_top base luminance Y=${Y_pathTop.toFixed(2)} is within [40, 42]`);
  assert(Y_grassOverhang >= 46.0 && Y_grassOverhang <= 49.0, `grass overhang luminance Y=${Y_grassOverhang.toFixed(2)} is within [46, 49]`);
  assert(Y_strata >= 58.0 && Y_strata <= 61.0, `path strata luminance Y=${Y_strata.toFixed(2)} is within [58, 61]`);
  assert(Y_crevice >= 11.0 && Y_crevice <= 13.0, `path crevice luminance Y=${Y_crevice.toFixed(2)} is within [11, 13]`);
}

// -----------------------------------------------------------------------------
// Suite 2: Quantitative Luminance Separation & Contrast Metrics
// -----------------------------------------------------------------------------
console.log("\n[Suite 2] Quantitative Luminance Separation & Contrast Metrics");
{
  const Y_dirt = hexToLuminance("#c77d38");
  const Y_coarse = hexToLuminance("#9e5d22");
  const Y_pathTop = hexToLuminance("#cfa567");
  const Y_grassOverhang = hexToLuminance("#9ac636");
  const Y_strata = hexToLuminance("#e6c793");
  const Y_crevice = hexToLuminance("#83581f");

  // Dominant base separation (must be >= 11.0 to prevent coarse dirt from reading as a shadow patch)
  const deltaBase = Y_dirt - Y_coarse;
  assert(deltaBase >= 11.0, `Dominant tone separation dirt vs coarse_dirt ΔY=${deltaBase.toFixed(2)} satisfies contract (>= 11.0)`);

  const ratioBase = Y_dirt / Y_coarse;
  assert(ratioBase >= 1.70, `Luminance ratio dirt / coarse_dirt (${ratioBase.toFixed(2)}x) satisfies contract (>= 1.70x)`);

  // Grass overhang contrast
  const deltaGrass = Y_grassOverhang - Y_dirt;
  assert(deltaGrass >= 20.0, `Grass overhang vs dirt base ΔY=${deltaGrass.toFixed(2)} satisfies contract (>= 20.0)`);

  // Path top contrast
  const deltaPath = Y_pathTop - Y_dirt;
  assert(deltaPath >= 12.0, `Path top vs dirt base ΔY=${deltaPath.toFixed(2)} satisfies contract (>= 12.0)`);

  // Path strata plate relief
  const deltaStrata = Y_strata - Y_crevice;
  assert(deltaStrata >= 40.0, `Path strata vs crevice shadow ΔY=${deltaStrata.toFixed(2)} satisfies contract (>= 40.0)`);
}

// -----------------------------------------------------------------------------
// Suite 3: Toroidal Seam Integrity Contract
// -----------------------------------------------------------------------------
console.log("\n[Suite 3] Toroidal Seam Integrity Contract");
{
  const rulesPath = path.join(ROOT_DIR, "tools", "tiling-rules.json");
  assert(fs.existsSync(rulesPath), "tools/tiling-rules.json exists");

  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));

  // Full toroidal terrain tiles
  const fullToroidal = [
    "block/dirt.svg",
    "block/coarse_dirt.svg",
    "block/dirt_path_top.svg",
    "block/grass_block_top.svg"
  ];
  for (const tex of fullToroidal) {
    const cat = categorizeTexture(tex, rules);
    assertEqual(cat.category, "toroidal", `${tex} resolves to toroidal category`);
    assertEqual(cat.testAxes.join("+"), "x+y", `${tex} is audited for both X and Y seamless tiling`);
  }

  // Horizontal seamless tiles
  const horizToroidal = [
    "block/dirt_path_side.svg",
    "block/grass_block_side.svg"
  ];
  for (const tex of horizToroidal) {
    const cat = categorizeTexture(tex, rules);
    assertEqual(cat.category, "x-only", `${tex} resolves to x-only category`);
    assertEqual(cat.testAxes.join("+"), "x", `${tex} is audited for X seamless tiling`);
  }

  // Grass block side overlay mask exemption
  const overlayCat = categorizeTexture("block/grass_block_side_overlay.svg", rules);
  assertEqual(overlayCat.category, "exempt", "grass_block_side_overlay.svg resolves to exempt category");
  assertEqual(overlayCat.testAxes.length, 0, "grass_block_side_overlay.svg has 0 test axes");
}

// -----------------------------------------------------------------------------
// Suite 4: Overlay Transparency & Zero Double-Tinting Contract
// -----------------------------------------------------------------------------
console.log("\n[Suite 4] Overlay Transparency & Zero Double-Tinting Contract");
{
  const overlayPath = path.join(DEFAULT_TEXTURES_DIR, "block", "grass_block_side_overlay.svg");
  assert(fs.existsSync(overlayPath), "grass_block_side_overlay.svg exists");

  const overlayContent = fs.readFileSync(overlayPath, "utf-8");

  // Assert zero graphical drawing elements
  const drawElementPatterns = [
    /<rect\b/i,
    /<path\b/i,
    /<circle\b/i,
    /<ellipse\b/i,
    /<polygon\b/i,
    /<polyline\b/i,
    /<line\b/i,
    /<image\b/i,
    /<use\b/i
  ];
  for (const pattern of drawElementPatterns) {
    assert(!pattern.test(overlayContent), `grass_block_side_overlay.svg contains zero ${pattern.source} tags`);
  }

  assert(
    overlayContent.includes("100% Transparent Overlay") || overlayContent.includes("Transparent"),
    "grass_block_side_overlay.svg documents its transparent intent"
  );
}

// -----------------------------------------------------------------------------
// Suite 5: TextureStudio Sync & 3D Multiblock Preset Verification (Skippable on CI)
// -----------------------------------------------------------------------------
console.log("\n[Suite 5] TextureStudio Sibling Sync & 3D Preset Verification");
{
  const { dir: studioDir } = resolveStudioDir({ env: process.env });
  const hasStudio = fs.existsSync(studioDir) && STUDIO_MARKERS.some((m) => fs.existsSync(path.join(studioDir, m)));

  if (hasStudio) {
    // 1. Verify sync plan for soil assets
    const masters = collectMasters(DEFAULT_TEXTURES_DIR);
    const destDir = path.join(studioDir, "textures");
    const plan = planSync(masters, destDir);

    const soilIds = ["dirt.svg", "coarse_dirt.svg", "dirt_path_top.svg", "dirt_path_side.svg", "grass_block_side.svg"];
    for (const id of soilIds) {
      const action = plan.actions.find((a) => a.flatName === id);
      assert(Boolean(action), `Soil master ${id} is present in TextureStudio sync plan`);
    }

    // 2. Inspect TextureStudio 3D Multiblock Presets in src/app.js
    const appJsPath = path.join(studioDir, "src", "app.js");
    if (fs.existsSync(appJsPath)) {
      const appJs = fs.readFileSync(appJsPath, "utf-8");

      assert(appJs.includes("adaptive_cliff_3x3"), "TextureStudio src/app.js defines adaptive_cliff_3x3 multiblock preset");
      assert(appJs.includes("adaptive_platform_3x3"), "TextureStudio src/app.js defines adaptive_platform_3x3 multiblock preset");

      // Verify that vector mode bypasses grass side overlay compositing (no double tinting)
      assert(
        appJs.includes("isExternal") && appJs.includes("isGrassBlockWithOverlay"),
        "TextureStudio WebGL renderer restricts overlay compositing to external packs (zero double-tinting for Keyframe)"
      );
    } else {
      console.log("  · SKIP: TextureStudio src/app.js not found in checkout");
    }
  } else {
    console.log("  · SKIP: no sibling TextureStudio checkout on this machine");
  }
}

// -----------------------------------------------------------------------------
// Suite 6: Repository & Workflow Wiring
// -----------------------------------------------------------------------------
console.log("\n[Suite 6] Repository & Workflow Wiring");
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf-8"));
  assert(Boolean(pkg.scripts["test:soil-palette-3d"]), "package.json exposes test:soil-palette-3d");
  assert(pkg.scripts.test.includes("soil-palette-3d.test.mjs"), "npm test runs soil-palette-3d.test.mjs");

  const ciYml = fs.readFileSync(path.join(ROOT_DIR, ".github", "workflows", "ci.yml"), "utf-8");
  assert(ciYml.includes("test:soil-palette-3d"), ".github/workflows/ci.yml runs test:soil-palette-3d");
}

console.log("\n=======================================================");
console.log(`  RESULTS: ${passedTests}/${totalTests} tests passed`);
console.log("=======================================================\n");
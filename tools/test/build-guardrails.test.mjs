#!/usr/bin/env node

/**
 * Test Suite for Keyframe Compiler Namespace Guardrails
 *
 * Verifies that root-level loose SVG masters sitting directly in textures/*.svg
 * are detected and rejected with actionable errors before compilation, preventing
 * broken assets/minecraft/textures/<name>.png mirroring.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoLooseTextures,
  LooseSvgMasterError,
  VALID_TEXTURE_CATEGORIES
} from "../build.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const TEXTURES_DIR = path.join(ROOT_DIR, "textures");
const TEST_TMP = path.join(ROOT_DIR, "cache", "test_build_guardrails");

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

/** Builds an isolated fixture tree for mutation testing. */
function makeFixtureTree(files) {
  if (fs.existsSync(TEST_TMP)) fs.rmSync(TEST_TMP, { recursive: true, force: true });
  fs.mkdirSync(TEST_TMP, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(TEST_TMP, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content, "utf-8");
  }
  return TEST_TMP;
}

console.log("\n=======================================================");
console.log("  KEYFRAME COMPILER GUARDRAILS TEST SUITE");
console.log("=======================================================\n");

// -----------------------------------------------------------------------------
// Suite 1: Root-Level Loose SVG Detection & Error Formatting
// -----------------------------------------------------------------------------
console.log("[Suite 1] Root-Level Loose SVG Detection & Error Formatting");
{
  const fixture = makeFixtureTree({
    "loose_block.svg": "<svg></svg>",
    "block/stone.svg": "<svg></svg>"
  });

  let threw = false;
  let caughtError = null;
  try {
    assertNoLooseTextures(fixture);
  } catch (err) {
    threw = true;
    caughtError = err;
  }

  assert(threw, "assertNoLooseTextures throws when a loose SVG master sits in root textures/");
  assert(caughtError instanceof LooseSvgMasterError, "Thrown error is an instance of LooseSvgMasterError");
  assert(Array.isArray(caughtError.looseFiles) && caughtError.looseFiles.includes("loose_block.svg"), "looseFiles lists the offending root SVG");

  // Multi-file aggregation
  const multiFixture = makeFixtureTree({
    "loose_one.svg": "<svg></svg>",
    "loose_two.svg": "<svg></svg>",
    "block/stone.svg": "<svg></svg>"
  });

  let multiThrew = false;
  let multiError = null;
  try {
    assertNoLooseTextures(multiFixture);
  } catch (err) {
    multiThrew = true;
    multiError = err;
  }

  assert(multiThrew, "assertNoLooseTextures throws on multiple loose SVGs");
  assertEqual(multiError.looseFiles.length, 2, "All loose SVGs are aggregated into looseFiles");
  assert(multiError.message.includes("textures/loose_one.svg") && multiError.message.includes("textures/loose_two.svg"), "Error message lists all offending loose files");

  // Actionable instruction checks
  assert(multiError.message.includes("textures/block/"), "Error message provides guidance for textures/block/");
  assert(multiError.message.includes("textures/item/"), "Error message provides guidance for textures/item/");
  assert(multiError.message.includes("textures/gui/"), "Error message provides guidance for textures/gui/");
  assert(multiError.message.includes("textures/particle/"), "Error message provides guidance for textures/particle/");
  assert(multiError.message.includes("assets/minecraft/textures/<name>.png"), "Error message explains vanilla Minecraft path mirroring behavior");
}

// -----------------------------------------------------------------------------
// Suite 2: Valid Categorized Texture Assets
// -----------------------------------------------------------------------------
console.log("\n[Suite 2] Valid Categorized Texture Assets");
{
  const validFixture = makeFixtureTree({
    "block/stone.svg": "<svg></svg>",
    "item/diamond_sword.svg": "<svg></svg>",
    "gui/container.svg": "<svg></svg>",
    "particle/flame.svg": "<svg></svg>",
    "gui/sprites/hud/crosshair.svg": "<svg></svg>"
  });

  const res = assertNoLooseTextures(validFixture);
  assertEqual(res.length, 0, "assertNoLooseTextures returns empty array for properly categorized assets");

  // Verify categories set contains expected standard directories
  assert(VALID_TEXTURE_CATEGORIES.has("block"), "VALID_TEXTURE_CATEGORIES contains block");
  assert(VALID_TEXTURE_CATEGORIES.has("item"), "VALID_TEXTURE_CATEGORIES contains item");
  assert(VALID_TEXTURE_CATEGORIES.has("gui"), "VALID_TEXTURE_CATEGORIES contains gui");
  assert(VALID_TEXTURE_CATEGORIES.has("particle"), "VALID_TEXTURE_CATEGORIES contains particle");
  assert(VALID_TEXTURE_CATEGORIES.has("entity"), "VALID_TEXTURE_CATEGORIES contains entity");
  assert(VALID_TEXTURE_CATEGORIES.has("environment"), "VALID_TEXTURE_CATEGORIES contains environment");
  assert(VALID_TEXTURE_CATEGORIES.has("font"), "VALID_TEXTURE_CATEGORIES contains font");
  assert(VALID_TEXTURE_CATEGORIES.has("map"), "VALID_TEXTURE_CATEGORIES contains map");
  assert(VALID_TEXTURE_CATEGORIES.has("misc"), "VALID_TEXTURE_CATEGORIES contains misc");
  assert(VALID_TEXTURE_CATEGORIES.has("mob_effect"), "VALID_TEXTURE_CATEGORIES contains mob_effect");
  assert(VALID_TEXTURE_CATEGORIES.has("models"), "VALID_TEXTURE_CATEGORIES contains models");
  assert(VALID_TEXTURE_CATEGORIES.has("painting"), "VALID_TEXTURE_CATEGORIES contains painting");
}

// -----------------------------------------------------------------------------
// Suite 3: Permitted Non-SVG Root Files
// -----------------------------------------------------------------------------
console.log("\n[Suite 3] Permitted Non-SVG Root Files");
{
  const nonSvgFixture = makeFixtureTree({
    ".gitkeep": "",
    "README.md": "# Textures Documentation",
    "metadata.json": "{}",
    ".DS_Store": "",
    "block/stone.svg": "<svg></svg>"
  });

  let threw = false;
  try {
    const res = assertNoLooseTextures(nonSvgFixture);
    assertEqual(res.length, 0, "Non-SVG files at root do not trigger loose SVG detection");
  } catch (err) {
    threw = true;
  }
  assert(!threw, "assertNoLooseTextures passes cleanly when root contains only non-SVG files");
}

// -----------------------------------------------------------------------------
// Suite 4: Non-Existent & Edge Directories
// -----------------------------------------------------------------------------
console.log("\n[Suite 4] Non-Existent & Edge Directories");
{
  const nonExistentPath = path.join(TEST_TMP, "non_existent_dir_12345");
  const missingRes = assertNoLooseTextures(nonExistentPath);
  assertEqual(missingRes.length, 0, "Non-existent directory handled gracefully without throwing ENOENT");

  const emptyFixture = makeFixtureTree({});
  const emptyRes = assertNoLooseTextures(emptyFixture);
  assertEqual(emptyRes.length, 0, "Empty directory handled gracefully without error");
}

// -----------------------------------------------------------------------------
// Suite 5: Shipped Repository Masters Audit
// -----------------------------------------------------------------------------
console.log("\n[Suite 5] Shipped Repository Masters Audit");
{
  const liveRes = assertNoLooseTextures(TEXTURES_DIR);
  assertEqual(liveRes.length, 0, "The shipped repository textures/ tree passes guardrails with 0 loose SVGs");
}

// -----------------------------------------------------------------------------
// Suite 6: Obsolete Fallback Removal Audit
// -----------------------------------------------------------------------------
console.log("\n[Suite 6] Obsolete Fallback Removal Audit");
{
  const buildSource = fs.readFileSync(path.join(ROOT_DIR, "tools", "build.mjs"), "utf-8");
  assert(
    !buildSource.includes("grassBlockTopSvgFallback"),
    "tools/build.mjs does not contain grassBlockTopSvgFallback"
  );
  assert(
    !buildSource.includes('path.join(TEXTURES_DIR, "grass_block_top.svg")'),
    "tools/build.mjs does not reference textures/grass_block_top.svg"
  );
}

// -----------------------------------------------------------------------------
// Suite 7: Compiler Gate Wiring Audit
// -----------------------------------------------------------------------------
console.log("\n[Suite 7] Compiler Gate Wiring Audit");
{
  const buildSource = fs.readFileSync(path.join(ROOT_DIR, "tools", "build.mjs"), "utf-8");
  assert(
    /\bassertNoLooseTextures\s*\(\s*TEXTURES_DIR\s*\)/.test(buildSource),
    "tools/build.mjs calls assertNoLooseTextures(TEXTURES_DIR) in buildResourcePack"
  );

  const gateIndex = buildSource.indexOf("assertNoLooseTextures(TEXTURES_DIR)");
  const rasterIndex = buildSource.indexOf("Rasterizing ");
  assert(
    gateIndex !== -1 && rasterIndex !== -1 && gateIndex < rasterIndex,
    "assertNoLooseTextures executes before rasterization begins"
  );
}

// -----------------------------------------------------------------------------
// Suite 8: Harness & CI Pipeline Wiring
// -----------------------------------------------------------------------------
console.log("\n[Suite 8] Harness & CI Pipeline Wiring");
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf-8"));
  assertEqual(
    pkg.scripts["test:guardrails"],
    "node tools/test/build-guardrails.test.mjs",
    "package.json exposes test:guardrails"
  );
  assert(
    pkg.scripts.test.includes("tools/test/build-guardrails.test.mjs"),
    "npm test runs this guardrails suite"
  );

  const ci = fs.readFileSync(path.join(ROOT_DIR, ".github", "workflows", "ci.yml"), "utf-8");
  assert(
    ci.includes("npm run test:guardrails"),
    ".github/workflows/ci.yml runs test:guardrails as its own step"
  );
}

if (fs.existsSync(TEST_TMP)) fs.rmSync(TEST_TMP, { recursive: true, force: true });

console.log("\n=======================================================");
console.log(`  RESULTS: ${passedTests}/${totalTests} tests passed`);
console.log("=======================================================\n");

if (passedTests !== totalTests) process.exit(1);

#!/usr/bin/env node

/**
 * Test Suite for Keyframe SVG Palette-Injection Engine
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  MINECRAFT_DYES,
  loadPalette,
  compileVariation,
  compileAllVariations,
  injectPaletteToFile,
  deriveShades,
  isValidHex,
  namespaceSvgIds
} from "../lib/palette-injector.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const TEST_TMP = path.join(ROOT_DIR, "cache", "test_palette_output");

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

console.log("\n=======================================================");
console.log("  KEYFRAME PALETTE-INJECTOR TEST SUITE");
console.log("=======================================================\n");

// -----------------------------------------------------------------------------
// Suite 1: Palette Schema & 16 Minecraft Dyes Coverage
// -----------------------------------------------------------------------------
console.log("[Suite 1] Palette Coverage & Hex Validation");
{
  const trailerPalette = loadPalette("trailer");
  const vanillaPalette = loadPalette("vanilla");

  assertEqual(Object.keys(trailerPalette).length, 16, "Trailer palette has exactly 16 dyes");
  assertEqual(Object.keys(vanillaPalette).length, 16, "Vanilla palette has exactly 16 dyes");

  for (const dyeId of MINECRAFT_DYES) {
    const t = trailerPalette[dyeId];
    const v = vanillaPalette[dyeId];

    assert(t !== undefined, `Trailer palette contains "${dyeId}"`);
    assert(isValidHex(t.PRIMARY_COLOR), `Trailer "${dyeId}" has valid PRIMARY_COLOR (${t.PRIMARY_COLOR})`);
    assert(isValidHex(t.SHADOW_COLOR), `Trailer "${dyeId}" has valid SHADOW_COLOR (${t.SHADOW_COLOR})`);
    assert(isValidHex(t.HIGHLIGHT_COLOR), `Trailer "${dyeId}" has valid HIGHLIGHT_COLOR (${t.HIGHLIGHT_COLOR})`);

    assert(v !== undefined, `Vanilla palette contains "${dyeId}"`);
    assert(isValidHex(v.PRIMARY_COLOR), `Vanilla "${dyeId}" has valid PRIMARY_COLOR (${v.PRIMARY_COLOR})`);
  }

  // Spot-check standard dye hex differences
  assertEqual(trailerPalette.orange.PRIMARY_COLOR, "#E06100", "Trailer orange matches #E06100");
  assertEqual(vanillaPalette.orange.PRIMARY_COLOR, "#EA7E35", "Vanilla orange matches #EA7E35");
  assertEqual(trailerPalette.lime.PRIMARY_COLOR, "#70B91A", "Trailer lime matches #70B91A");
  assertEqual(vanillaPalette.lime.PRIMARY_COLOR, "#7FCC19", "Vanilla lime matches #7FCC19");
}

// -----------------------------------------------------------------------------
// Suite 2: High-Speed Performance Benchmark (< 10ms for 16 variations)
// -----------------------------------------------------------------------------
console.log("\n[Suite 2] High-Speed Performance Benchmark");
{
  const complexTemplate = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bevel_grad">
      <stop offset="0%" stop-color="{{HIGHLIGHT_COLOR}}" />
      <stop offset="100%" stop-color="{{SHADOW_COLOR}}" />
    </linearGradient>
  </defs>
  <!-- {{COLOR_NAME}} Wool Material -->
  <rect width="512" height="512" fill="{{PRIMARY_COLOR}}" />
  <rect x="0" y="0" width="512" height="32" fill="{{HIGHLIGHT_COLOR}}" />
  <rect x="0" y="480" width="512" height="32" fill="{{SHADOW_COLOR}}" />
  <circle cx="256" cy="256" r="64" fill="{{ACCENT_COLOR}}" />
  <rect x="64" y="64" width="384" height="384" fill="url(#bevel_grad)" />
</svg>
`;

  const palette = loadPalette("trailer");

  // Warmup run
  compileAllVariations(complexTemplate, palette);

  const iterations = 50;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    compileAllVariations(complexTemplate, palette);
  }
  const elapsed = performance.now() - start;
  const avgPer16VarsMs = elapsed / iterations;

  console.log(`  ⚡ Performance: ${avgPer16VarsMs.toFixed(3)}ms per 16-color batch (over ${iterations} runs)`);
  assert(avgPer16VarsMs < 10.0, `Compiles 16 variations in under 10ms (Actual: ${avgPer16VarsMs.toFixed(3)}ms)`);
}

// -----------------------------------------------------------------------------
// Suite 3: Semantic Token Replacement & Case/Alias Flexibility
// -----------------------------------------------------------------------------
console.log("\n[Suite 3] Semantic Token Replacement & Case/Alias Flexibility");
{
  const template = `
<svg>
  <rect fill="{{PRIMARY_COLOR}}" />
  <path fill="{{shadow_color}}" />
  <line stroke="{{HIGHLIGHT}}" />
  <circle fill="{{dark_shadow}}" />
  <ellipse fill="{{ACCENT}}" />
  <text>{{color_id}}</text>
  <desc>{{COLOR_NAME}}</desc>
</svg>
`;

  const palette = loadPalette("trailer");
  const compiledRed = compileVariation(template, "red", palette, { namespaceIds: false });

  assert(compiledRed.includes(`fill="#A8201A"`), "Replaced {{PRIMARY_COLOR}} with #A8201A");
  assert(compiledRed.includes(`fill="#6B100C"`), "Replaced {{shadow_color}} with #6B100C");
  assert(compiledRed.includes(`stroke="#D23D36"`), "Replaced {{HIGHLIGHT}} with #D23D36");
  assert(compiledRed.includes(`fill="#470805"`), "Replaced {{dark_shadow}} with #470805");
  assert(compiledRed.includes(`fill="#E85B54"`), "Replaced {{ACCENT}} with #E85B54");
  assert(compiledRed.includes(`<text>red</text>`), "Replaced {{color_id}} with 'red'");
  assert(compiledRed.includes(`<desc>Red</desc>`), "Replaced {{COLOR_NAME}} with 'Red'");
}

// -----------------------------------------------------------------------------
// Suite 4: Custom Overrides & Palette Overriding
// -----------------------------------------------------------------------------
console.log("\n[Suite 4] Custom Overrides & Palette Overriding");
{
  const customOverrides = {
    red: {
      PRIMARY_COLOR: "#FF1122",
      SHADOW_COLOR: "#AA0011",
      HIGHLIGHT_COLOR: "#FF6677"
    }
  };

  const palette = loadPalette("trailer", customOverrides);
  assertEqual(palette.red.PRIMARY_COLOR, "#FF1122", "Overridden red primary color is applied");
  assertEqual(palette.red.SHADOW_COLOR, "#AA0011", "Overridden red shadow color is applied");
  assertEqual(palette.blue.PRIMARY_COLOR, "#2C3599", "Untouched colors remain default trailer palette");
}

// -----------------------------------------------------------------------------
// Suite 5: Perceptual Shade Derivation (Fallback when only primary is given)
// -----------------------------------------------------------------------------
console.log("\n[Suite 5] Perceptual Shade Derivation");
{
  const derived = deriveShades("#3498DB"); // Blue
  assert(isValidHex(derived.PRIMARY_COLOR), "Derived PRIMARY_COLOR is valid");
  assert(isValidHex(derived.HIGHLIGHT_COLOR), "Derived HIGHLIGHT_COLOR is valid");
  assert(isValidHex(derived.SHADOW_COLOR), "Derived SHADOW_COLOR is valid");
  assert(isValidHex(derived.DARK_SHADOW_COLOR), "Derived DARK_SHADOW_COLOR is valid");

  // Highlight should be distinct from primary and shadow
  assert(derived.HIGHLIGHT_COLOR !== derived.PRIMARY_COLOR, "Derived highlight is distinct from primary");
  assert(derived.SHADOW_COLOR !== derived.PRIMARY_COLOR, "Derived shadow is distinct from primary");
}

// -----------------------------------------------------------------------------
// Suite 6: SVG ID Namespacing
// -----------------------------------------------------------------------------
console.log("\n[Suite 6] SVG ID Namespacing");
{
  const svg = `
<svg>
  <defs>
    <linearGradient id="bevel_grad">
      <stop stop-color="#fff" />
    </linearGradient>
    <clipPath id="mask_edge" />
  </defs>
  <rect fill="url(#bevel_grad)" clip-path="url(#mask_edge)" href="#bevel_grad" />
</svg>
`;

  const namespaced = namespaceSvgIds(svg, "cyan");
  assert(namespaced.includes('id="cyan_bevel_grad"'), "Prefixed gradient definition id");
  assert(namespaced.includes('id="cyan_mask_edge"'), "Prefixed clipPath definition id");
  assert(namespaced.includes('fill="url(#cyan_bevel_grad)"'), "Updated fill url reference");
  assert(namespaced.includes('clip-path="url(#cyan_mask_edge)"'), "Updated clip-path url reference");
  assert(namespaced.includes('href="#cyan_bevel_grad"'), "Updated href reference");
}

// -----------------------------------------------------------------------------
// Suite 7: Strict Mode Error Handling
// -----------------------------------------------------------------------------
console.log("\n[Suite 7] Strict Mode Error Handling");
{
  const templateWithBadToken = `<svg><rect fill="{{NON_EXISTENT_TOKEN}}" /></svg>`;
  const palette = loadPalette("trailer");

  let threwError = false;
  try {
    compileVariation(templateWithBadToken, "red", palette, { strict: true });
  } catch (err) {
    threwError = true;
    assert(err.message.includes("Unmapped semantic token"), "Error contains descriptive message");
  }
  assert(threwError, "Strict mode threw error on unmapped token");

  // Permissive mode should not throw
  const permissiveResult = compileVariation(templateWithBadToken, "red", palette, { strict: false });
  assert(permissiveResult.includes("{{NON_EXISTENT_TOKEN}}"), "Permissive mode preserved unmapped token");
}

// -----------------------------------------------------------------------------
// Suite 8: File Generation & Disk I/O
// -----------------------------------------------------------------------------
console.log("\n[Suite 8] File Generation & Disk I/O");
{
  if (fs.existsSync(TEST_TMP)) {
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_TMP, { recursive: true });

  const sampleTemplatePath = path.join(TEST_TMP, "wool.template.svg");
  fs.writeFileSync(sampleTemplatePath, `<svg viewBox="0 0 512 512"><rect width="512" height="512" fill="{{PRIMARY_COLOR}}"/><rect y="480" width="512" height="32" fill="{{SHADOW_COLOR}}"/></svg>`, "utf-8");

  const res = await injectPaletteToFile(sampleTemplatePath, TEST_TMP, {
    palette: "trailer",
    namePattern: "{color}_wool.svg"
  });

  assertEqual(res.count, 16, "Wrote exactly 16 variation SVG files");
  assert(fs.existsSync(path.join(TEST_TMP, "white_wool.svg")), "Created white_wool.svg");
  assert(fs.existsSync(path.join(TEST_TMP, "red_wool.svg")), "Created red_wool.svg");
  assert(fs.existsSync(path.join(TEST_TMP, "black_wool.svg")), "Created black_wool.svg");

  const redContent = fs.readFileSync(path.join(TEST_TMP, "red_wool.svg"), "utf-8");
  assert(redContent.includes('fill="#A8201A"'), "Red wool has trailer red primary fill");
  assert(redContent.includes('fill="#6B100C"'), "Red wool has trailer red shadow fill");

  // Clean up
  fs.rmSync(TEST_TMP, { recursive: true, force: true });
}

// -----------------------------------------------------------------------------
// Suite 9: CLI Interface Execution
// -----------------------------------------------------------------------------
console.log("\n[Suite 9] CLI Interface Execution");
{
  const cliOutput = execSync(`node tools/lib/palette-injector.mjs --help`, { cwd: ROOT_DIR, encoding: "utf-8" });
  assert(cliOutput.includes("Keyframe SVG Palette-Injection Engine"), "CLI --help displays help banner");
  assert(cliOutput.includes("--palette"), "CLI documents --palette option");
}

console.log("\n=======================================================");
console.log(`  ✓ ALL ${passedTests}/${totalTests} TESTS PASSED SUCCESSFULLY!`);
console.log("=======================================================\n");

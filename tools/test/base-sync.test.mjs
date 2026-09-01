#!/usr/bin/env node

/**
 * Test Suite for the Keyframe Shared-Base Sync Verifier
 *
 * Covers the contract that ore masters keep their stone background - striation groove
 * geometry and every corner radius (rx) - identical to textures/block/stone.svg.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadBaseSyncRules,
  groupOpenTagPattern,
  stripComments,
  normalizeFragment,
  extractDefs,
  extractGroup,
  extractSection,
  checkBaseSync,
  assertBaseSync,
  DEFAULT_RULES_FILE
} from "../lib/base-sync.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const TEXTURES_DIR = path.join(ROOT_DIR, "textures");
const TEST_TMP = path.join(ROOT_DIR, "cache", "test_base_sync");

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

/** Builds a throwaway textures tree so mutation tests never touch the real masters. */
function makeFixtureTree(files) {
  if (fs.existsSync(TEST_TMP)) fs.rmSync(TEST_TMP, { recursive: true, force: true });
  fs.mkdirSync(path.join(TEST_TMP, "block"), { recursive: true });
  for (const [rel, text] of Object.entries(files)) {
    const dest = path.join(TEST_TMP, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text, "utf-8");
  }
  return TEST_TMP;
}

const FIXTURE_RULES = {
  version: "test",
  bases: {
    "block/stone.svg": {
      markerGroupId: "stone_base",
      sharedSections: ["defs", "group:stone_base"],
      derivatives: ["block/diamond_ore.svg"]
    }
  }
};

console.log("\n=======================================================");
console.log("  KEYFRAME SHARED-BASE SYNC TEST SUITE");
console.log("=======================================================\n");

// -----------------------------------------------------------------------------
// Suite 1: Registry
// -----------------------------------------------------------------------------
console.log("[Suite 1] Registry Loading");
{
  assert(fs.existsSync(DEFAULT_RULES_FILE), "tools/base-sync.json exists");
  const rules = loadBaseSyncRules();
  assert(typeof rules.bases === "object" && rules.bases !== null, "Registry exposes a bases map");
  const stone = rules.bases["block/stone.svg"];
  assert(Boolean(stone), "block/stone.svg is registered as a shared base");
  assertEqual(stone.markerGroupId, "stone_base", "Stone base declares its marker group id");
  assert(stone.derivatives.includes("block/diamond_ore.svg"), "diamond_ore.svg is a registered stone derivative");
  assert(stone.derivatives.includes("block/coal_ore.svg"), "coal_ore.svg is a registered stone derivative");
  assert(
    stone.sharedSections.includes("defs") && stone.sharedSections.includes("group:stone_base"),
    "Shared sections cover the groove defs (corner radii) and the groove placement group"
  );

  const missing = loadBaseSyncRules(path.join(TEST_TMP, "nope.json"));
  assertEqual(Object.keys(missing.bases).length, 0, "An absent registry degrades to an empty one");
}

// -----------------------------------------------------------------------------
// Suite 2: Fragment extraction and normalization
// -----------------------------------------------------------------------------
console.log("\n[Suite 2] Fragment Extraction & Normalization");
{
  assertEqual(stripComments("<a/><!-- x --><b/>"), "<a/><b/>", "XML comments are stripped");
  assertEqual(
    normalizeFragment("<rect  x=\"1\" />\n  <rect x=\"2\" />"),
    "<rect x=\"1\"/><rect x=\"2\"/>",
    "Whitespace and self-closing spacing are normalized"
  );

  const svg = "<svg><defs><g id=\"a\"><rect/></g></defs><g id=\"outer\"><g id=\"inner\"><rect/></g><use/></g></svg>";
  assertEqual(extractDefs(svg), "<g id=\"a\"><rect/></g>", "extractDefs returns the defs body");
  assertEqual(
    extractGroup(svg, "outer"),
    "<g id=\"inner\"><rect/></g><use/>",
    "extractGroup captures a nested group whole"
  );
  assertEqual(extractGroup(svg, "absent"), null, "extractGroup returns null for a missing group");

  // `<g` must be a real group element, not the start of another element's name.
  const withGlyph = "<svg><g id=\"outer\"><glyph unicode=\"a\"/><rect/></g><rect id=\"after\"/></svg>";
  assertEqual(
    extractGroup(withGlyph, "outer"),
    "<glyph unicode=\"a\"/><rect/>",
    "extractGroup does not treat <glyph> as a nested <g>"
  );
  assertEqual(extractDefs("<svg><g/></svg>"), null, "extractDefs returns null when defs is absent");
  assertEqual(extractGroup("<svg><g id=\"solo\"/></svg>", "solo"), "", "A self-closing group has empty content");

  let threw = false;
  try {
    extractSection("<svg/>", "bogus");
  } catch {
    threw = true;
  }
  assert(threw, "An unknown section descriptor is rejected");

  // The marker id comes from the registry, but building a RegExp from it unescaped
  // would turn a dot or bracket into a wildcard rather than a literal.
  assert(!groupOpenTagPattern("a.c").test("<g id=\"abc\">"), "A marker id is matched literally, not as a pattern");
  assert(groupOpenTagPattern("a.c").test("<g id=\"a.c\">"), "A marker id containing regex metacharacters still matches itself");
  assert(!groupOpenTagPattern("stone_base").test("<glyph id=\"stone_base\">"), "The marker matches <g>, not <glyph>");
}

// -----------------------------------------------------------------------------
// Suite 3: The real masters honour the contract
// -----------------------------------------------------------------------------
console.log("\n[Suite 3] Shipped Masters Are In Sync");
{
  const result = checkBaseSync(TEXTURES_DIR);
  if (!result.ok) {
    console.error("  Reported drift:\n    - " + result.errors.join("\n    - "));
  }
  assert(result.ok, "Every registered derivative matches its base master");
  assert(result.comparisons >= 4, `At least four sections were actually compared (got ${result.comparisons})`);

  const stoneText = fs.readFileSync(path.join(TEXTURES_DIR, "block", "stone.svg"), "utf-8");
  const oreText = fs.readFileSync(path.join(TEXTURES_DIR, "block", "diamond_ore.svg"), "utf-8");
  assertEqual(
    extractSection(oreText, "defs").value,
    extractSection(stoneText, "defs").value,
    "diamond_ore.svg groove defs (and their rx radii) equal stone.svg's"
  );
  assertEqual(
    extractSection(oreText, "group:stone_base").value,
    extractSection(stoneText, "group:stone_base").value,
    "diamond_ore.svg striation placement equals stone.svg's"
  );

  // The slate fill is shared too, so it has to sit inside a compared section rather than
  // beside it. As a loose sibling of the group it was covered by neither.
  for (const [label, text] of [["stone.svg", stoneText], ["diamond_ore.svg", oreText]]) {
    const groupBody = extractSection(text, "group:stone_base").value;
    assert(
      groupBody.includes("<rect width=\"512\" height=\"512\" fill=\"#7e8187\"/>"),
      `${label} keeps the 512x512 slate fill inside <g id="stone_base">, where it is compared`
    );
  }
  const stoneOutside = stripComments(stoneText).slice(0, stripComments(stoneText).indexOf("<g id=\"stone_base\""));
  assert(
    !/<rect\s+width="512"\s+height="512"/.test(stoneOutside.slice(stoneOutside.indexOf("</defs>"))),
    "stone.svg has no full-canvas rect loose between </defs> and the compared group"
  );

  assert(
    /stone\.svg/.test(oreText) && /base-sync/i.test(oreText),
    "diamond_ore.svg header names stone.svg and the enforcing check"
  );
  assert(
    /diamond_ore\.svg/.test(stoneText) && /base-sync/i.test(stoneText),
    "stone.svg header names its derivatives and the enforcing check"
  );
}

// -----------------------------------------------------------------------------
// Suite 4: Drift is actually caught
// -----------------------------------------------------------------------------
console.log("\n[Suite 4] Drift Detection");
{
  const base = [
    "<svg>",
    "  <defs>",
    "    <!-- groove -->",
    "    <g id=\"groove_32\"><rect width=\"32\" height=\"32\" rx=\"8\" fill=\"#5f6268\" /></g>",
    "  </defs>",
    "  <g id=\"stone_base\">",
    "    <rect width=\"512\" height=\"512\" fill=\"#7e8187\" />",
    "    <use href=\"#groove_32\" x=\"64\" y=\"32\" />",
    "  </g>",
    "</svg>"
  ].join("\n");

  // Same geometry, different comments and indentation: not drift.
  const cosmetic = base
    .replace("<!-- groove -->", "<!-- a totally different note -->")
    .replace(/\n\s+/g, "\n        ");

  let tree = makeFixtureTree({ "block/stone.svg": base, "block/diamond_ore.svg": cosmetic });
  let result = checkBaseSync(tree, FIXTURE_RULES);
  assert(result.ok, "Comment and indentation differences are not reported as drift");

  // Corner radius drift - the exact failure the contract exists to prevent.
  const rxDrift = base.replace("rx=\"8\"", "rx=\"12\"");
  tree = makeFixtureTree({ "block/stone.svg": base, "block/diamond_ore.svg": rxDrift });
  result = checkBaseSync(tree, FIXTURE_RULES);
  assert(!result.ok, "A changed corner radius (rx) in the derivative is reported as drift");
  assert(result.errors.some((e) => e.includes("<defs>")), "The rx drift error names the defs section");

  // Striation placement drift.
  const placementDrift = base.replace("x=\"64\" y=\"32\"", "x=\"96\" y=\"32\"");
  tree = makeFixtureTree({ "block/stone.svg": base, "block/diamond_ore.svg": placementDrift });
  result = checkBaseSync(tree, FIXTURE_RULES);
  assert(!result.ok, "A moved striation groove is reported as drift");
  assert(
    result.errors.some((e) => e.includes("stone_base")),
    "The placement drift error names the stone_base group"
  );

  // Background slate drift. This one regressed once: while the fill rect was a loose
  // sibling of the group it was inside no compared section, so recolouring stone.svg
  // alone passed the gate and left the ores a different colour from the stone around
  // them - the exact failure the contract exists to prevent.
  const fillDrift = base.replace("fill=\"#7e8187\"", "fill=\"#903030\"");
  tree = makeFixtureTree({ "block/stone.svg": fillDrift, "block/diamond_ore.svg": base });
  result = checkBaseSync(tree, FIXTURE_RULES);
  assert(!result.ok, "Recolouring the shared slate fill in stone.svg alone is reported as drift");
  assert(
    result.errors.some((e) => e.includes("stone_base")),
    "The slate fill drift error names the stone_base group that now contains it"
  );

  // Editing the base without editing the derivative is symmetrical drift.
  const editedBase = base.replace("fill=\"#5f6268\"", "fill=\"#606060\"");
  tree = makeFixtureTree({ "block/stone.svg": editedBase, "block/diamond_ore.svg": base });
  result = checkBaseSync(tree, FIXTURE_RULES);
  assert(!result.ok, "Editing stone.svg alone is caught, which is the drift the contract predicts");

  // A derivative that lost the shared group entirely.
  tree = makeFixtureTree({ "block/stone.svg": base, "block/diamond_ore.svg": "<svg><defs/></svg>" });
  result = checkBaseSync(tree, FIXTURE_RULES);
  assert(!result.ok, "A derivative missing the shared section fails");

  // Missing files are reported rather than silently skipped.
  tree = makeFixtureTree({ "block/stone.svg": base });
  result = checkBaseSync(tree, FIXTURE_RULES);
  assert(
    result.errors.some((e) => e.includes("does not exist")),
    "A registered derivative that is absent from disk is reported"
  );
}

// -----------------------------------------------------------------------------
// Suite 5: Unregistered derivatives cannot slip through
// -----------------------------------------------------------------------------
console.log("\n[Suite 5] Unregistered Derivative Detection");
{
  const base = "<svg><defs><g id=\"groove_32\"><rect rx=\"8\"/></g></defs><g id=\"stone_base\"><use href=\"#groove_32\"/></g></svg>";
  const tree = makeFixtureTree({
    "block/stone.svg": base,
    "block/diamond_ore.svg": base,
    "block/iron_ore.svg": base
  });
  const result = checkBaseSync(tree, FIXTURE_RULES);
  assert(!result.ok, "An unregistered file carrying the stone base fails the check");
  assert(
    result.errors.some((e) => e.includes("iron_ore.svg") && e.includes("base-sync.json")),
    "The error names the offending file and where to register it"
  );
}

// -----------------------------------------------------------------------------
// Suite 6: Build-time gate throws
// -----------------------------------------------------------------------------
console.log("\n[Suite 6] Build-Time Gate");
{
  const base = "<svg><defs><g id=\"g\"><rect rx=\"8\"/></g></defs><g id=\"stone_base\"><use href=\"#g\"/></g></svg>";
  const tree = makeFixtureTree({
    "block/stone.svg": base,
    "block/diamond_ore.svg": base.replace("rx=\"8\"", "rx=\"9\"")
  });

  let threw = false;
  let message = "";
  try {
    assertBaseSync(tree, FIXTURE_RULES);
  } catch (err) {
    threw = true;
    message = err.message;
  }
  assert(threw, "assertBaseSync throws on drift so the compiler cannot emit a drifted pack");
  assert(message.includes("Shared-base sync check failed"), "The thrown error is self-describing");

  const clean = makeFixtureTree({ "block/stone.svg": base, "block/diamond_ore.svg": base });
  const ok = assertBaseSync(clean, FIXTURE_RULES);
  assertEqual(ok.ok, true, "assertBaseSync returns the passing result when the pack is in sync");

  // The real tree must pass the same gate the build applies.
  const live = assertBaseSync(TEXTURES_DIR);
  assertEqual(live.ok, true, "The shipped textures/ tree passes the build-time gate");
}

if (fs.existsSync(TEST_TMP)) fs.rmSync(TEST_TMP, { recursive: true, force: true });

console.log("\n=======================================================");
console.log(`  RESULTS: ${passedTests}/${totalTests} tests passed`);
console.log("=======================================================\n");

if (passedTests !== totalTests) process.exit(1);

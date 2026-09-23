#!/usr/bin/env node

/**
 * Test Suite for the Keyframe Tiling-Rules Matcher
 *
 * Covers `matchGlob`/`globToRegExp` and the `categorizeTexture` rule resolution that sits
 * on top of them. The bug this suite exists to prevent (#199): the original matcher
 * special-cased only a leading `*`, a trailing `*` or both, and otherwise fell through to
 * `filename === pattern`. Every rule in tiling-rules.json carrying an interior wildcard —
 * `short_grass*.svg`, `tall_grass_*.svg` — therefore never fired, and five cross-quad
 * plant cutouts were audited as full toroidal terrain blocks.
 *
 * Two properties are load-bearing and each has its own tests:
 *   1. Wildcards work in ANY position, not just at the ends.
 *   2. The literal parts are escaped, so the `.` in `*.svg` matches a literal dot only.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchGlob, globToRegExp, basenameOf, categorizeTexture, resolveTilingCategory } from "../test-tiling.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const RULES_FILE = path.join(ROOT_DIR, "tools", "tiling-rules.json");
const TEXTURES_DIR = path.join(ROOT_DIR, "textures");

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

function assertMatches(pairs, shouldMatch) {
  for (const [filename, pattern] of pairs) {
    assertEqual(
      matchGlob(filename, pattern),
      shouldMatch,
      `${shouldMatch ? "matches" : "rejects"}: "${filename}" vs "${pattern}"`
    );
  }
}

const rules = JSON.parse(fs.readFileSync(RULES_FILE, "utf-8"));

// --------------------------------------------------------------------------
console.log("\n[1] Leading wildcard");
// --------------------------------------------------------------------------
{
  assertMatches([
    ["grass_block_side.svg", "*_side.svg"],
    ["dirt_path_side.svg", "*_side.svg"],
    ["grass_block_side_overlay.svg", "*_overlay.svg"],
    ["_side.svg", "*_side.svg"]           // `*` matches the empty run
  ], true);

  assertMatches([
    ["grass_block_top.svg", "*_side.svg"],
    ["side.svg", "*_side.svg"],
    ["grass_block_side.png", "*_side.svg"]
  ], false);
}

// --------------------------------------------------------------------------
console.log("\n[2] Trailing wildcard");
// --------------------------------------------------------------------------
{
  assertMatches([
    ["suspicious_gravel_0.svg", "suspicious_*"],
    ["suspicious_", "suspicious_*"],
    ["oak_log_top.svg", "oak_*"]
  ], true);

  assertMatches([
    ["gravel.svg", "suspicious_*"],
    ["unsuspicious_gravel_0.svg", "suspicious_*"]
  ], false);
}

// --------------------------------------------------------------------------
console.log("\n[3] Interior wildcard — the #199 regression");
// --------------------------------------------------------------------------
{
  // These are the exact patterns from tiling-rules.json that were dead before the fix.
  assertMatches([
    ["short_grass.svg", "short_grass*.svg"],
    ["short_grass_1.svg", "short_grass*.svg"],
    ["short_grass_2.svg", "short_grass*.svg"],
    ["tall_grass_bottom.svg", "tall_grass_*.svg"],
    ["tall_grass_top.svg", "tall_grass_*.svg"]
  ], true);

  // An interior wildcard is still anchored at both ends: it must not become a substring
  // search, which would be the lazy way to "support" it.
  assertMatches([
    ["very_short_grass.svg", "short_grass*.svg"],
    ["short_grass.png", "short_grass*.svg"],
    ["tall_grass.svg", "tall_grass_*.svg"],   // the `_` before `*` is literal
    ["grass_block_top.svg", "short_grass*.svg"]
  ], false);
}

// --------------------------------------------------------------------------
console.log("\n[4] Multiple wildcards, and leading+trailing together");
// --------------------------------------------------------------------------
{
  assertMatches([
    ["suspicious_gravel_0.svg", "*gravel*"],
    ["gravel.svg", "*gravel*"],
    ["oak_log_top.svg", "oak_*_*.svg"],
    ["a_b_c_d.svg", "*_*_*_*.svg"],
    ["deepslate_top.svg", "*slate*top*"],
    ["stone.svg", "*"],
    ["stone.svg", "**"],
    ["stone.svg", "*stone*.svg*"]
  ], true);

  assertMatches([
    ["stone.svg", "*gravel*"],
    ["oak_log.svg", "oak_*_*.svg"],          // only one `_` after `oak_`
    ["deepslate_top.svg", "*top*slate*"]     // order of the literal runs is enforced
  ], false);
}

// --------------------------------------------------------------------------
console.log("\n[5] Exact patterns (no wildcard at all)");
// --------------------------------------------------------------------------
{
  assertMatches([
    ["grass.svg", "grass.svg"],
    ["stone.svg", "stone.svg"]
  ], true);

  assertMatches([
    ["grass_block_top.svg", "grass.svg"],
    ["short_grass.svg", "grass.svg"],
    ["grass.svgx", "grass.svg"],
    ["", "grass.svg"]
  ], false);
}

// --------------------------------------------------------------------------
console.log("\n[6] Regex metacharacters in the literal parts are escaped");
// --------------------------------------------------------------------------
{
  // `.` is the one that actually bites: every pattern in tiling-rules.json contains one.
  // An unescaped `.` would let `*_side.svg` match a file with any character in that slot.
  assertMatches([
    ["grass_block_sideXsvg", "*_side.svg"],
    ["grass_block_side_svg", "*_side.svg"],
    ["stoneXsvg", "stone.svg"],
    ["short_grass_1Xsvg", "short_grass*.svg"]
  ], false);

  // The remaining metacharacters must be literal too, so a pattern can never be smuggled
  // into the regex engine as syntax.
  assertMatches([
    ["a+b.svg", "a+b.svg"],
    ["a(b).svg", "a(b).svg"],
    ["a|b.svg", "a|b.svg"],
    ["a[b].svg", "a[b].svg"],
    ["a{2}.svg", "a{2}.svg"],
    ["a^b$c.svg", "a^b$c.svg"]
  ], true);

  // `\` is deliberately NOT a literal in the name: it is a path separator, normalized
  // away by basenameOf before matching. Escaped in the pattern it is inert, not syntax.
  assertEqual(matchGlob("dir\\stone.svg", "stone.svg"), true, "A backslash in the name is a separator, not a literal");
  assertEqual(globToRegExp("a\\b.svg").source, "^a\\\\b\\.svg$", "A backslash in a pattern is escaped, never a regex escape");

  assertMatches([
    ["ab.svg", "a+b.svg"],       // `+` is not a quantifier
    ["aab.svg", "a+b.svg"],
    ["ab.svg", "a(b).svg"],      // `()` is not a group
    ["a.svg", "a|b.svg"],        // `|` is not an alternation
    ["ab.svg", "a[b].svg"],      // `[]` is not a character class
    ["aa.svg", "a{2}.svg"]       // `{}` is not a repetition
  ], false);

  // A pattern that is pure metacharacters must not throw when compiled.
  assertEqual(matchGlob("stone.svg", "([{"), false, "A syntactically invalid regex body compiles as literals");
  assertEqual(matchGlob("([{", "([{"), true, "...and still matches itself literally");
}

// --------------------------------------------------------------------------
console.log("\n[7] `?` matches exactly one character");
// --------------------------------------------------------------------------
{
  assertMatches([
    ["short_grass_1.svg", "short_grass_?.svg"],
    ["suspicious_gravel_0.svg", "suspicious_gravel_?.svg"]
  ], true);

  assertMatches([
    ["short_grass.svg", "short_grass_?.svg"],
    ["short_grass_12.svg", "short_grass_?.svg"]
  ], false);
}

// --------------------------------------------------------------------------
console.log("\n[8] globToRegExp is anchored and cached");
// --------------------------------------------------------------------------
{
  assertEqual(globToRegExp("short_grass*.svg").source, "^short_grass.*\\.svg$", "Anchored at both ends with the dot escaped");
  assertEqual(globToRegExp("*_side.svg").source, "^.*_side\\.svg$", "Leading wildcard translates to `.*`");
  assertEqual(globToRegExp("grass.svg").source, "^grass\\.svg$", "A wildcard-free pattern is a fully literal anchored regex");
  assert(globToRegExp("*_side.svg") === globToRegExp("*_side.svg"), "The compiled regex is cached per pattern");
  assert(
    globToRegExp("*_side.svg").global === false && globToRegExp("*_side.svg").sticky === false,
    "No `g`/`y` flag, so `.test()` has no lastIndex state to leak between calls"
  );
  // Guards against lastIndex-style state regressions regardless of implementation.
  assertEqual(matchGlob("dirt_path_side.svg", "*_side.svg"), true, "Repeat match, call 1");
  assertEqual(matchGlob("dirt_path_side.svg", "*_side.svg"), true, "Repeat match, call 2");
  assertEqual(matchGlob("dirt_path_side.svg", "*_side.svg"), true, "Repeat match, call 3");
}

// --------------------------------------------------------------------------
console.log("\n[9] Patterns address the basename, not the discovered path");
// --------------------------------------------------------------------------
{
  assertEqual(basenameOf("block/short_grass.svg"), "short_grass.svg", "POSIX relative path reduces to its basename");
  assertEqual(basenameOf("block\\short_grass.svg"), "short_grass.svg", "Windows relative path reduces to its basename");
  assertEqual(basenameOf("short_grass.svg"), "short_grass.svg", "A bare basename is unchanged");

  // findSvgFiles builds relPaths like `block/short_grass.svg`. If a caller passes one,
  // the `block/` prefix must not defeat a pattern anchored at the start of the name.
  assertMatches([
    ["block/short_grass.svg", "short_grass*.svg"],
    ["block\\short_grass.svg", "short_grass*.svg"],
    ["block/tall_grass_top.svg", "tall_grass_*.svg"],
    ["block/grass_block_side.svg", "*_side.svg"]
  ], true);

  assertEqual(
    categorizeTexture("block/short_grass.svg", rules).category,
    "exempt",
    "categorizeTexture strips the directory before applying rules"
  );
  assertEqual(
    categorizeTexture("short_grass.svg", rules).category,
    "exempt",
    "...and gives the same answer for the bare basename"
  );
}

// --------------------------------------------------------------------------
console.log("\n[10] categorizeTexture resolves the shipped rules correctly");
// --------------------------------------------------------------------------
{
  const cat = f => categorizeTexture(f, rules).category;

  // The five cutouts issue #199 is about. Before the fix all five resolved to `toroidal`.
  for (const f of ["short_grass.svg", "short_grass_1.svg", "short_grass_2.svg",
                   "tall_grass_bottom.svg", "tall_grass_top.svg"]) {
    assertEqual(cat(f), "exempt", `${f} is exempt (cross-quad plant cutout)`);
    assertEqual(categorizeTexture(f, rules).testAxes.length, 0, `${f} is audited on no axis`);
  }

  assertEqual(cat("grass_block_side_overlay.svg"), "exempt", "The biome colormap overlay stays exempt");

  // The counterweight. `grass*.svg` would have swallowed these three genuine terrain
  // blocks the moment interior globbing started working, silently hiding real seam
  // defects — which is why that pattern is `grass.svg`, the literal pre-1.20.3 alias.
  assertEqual(cat("grass_block_top.svg"), "toroidal", "grass_block_top is a real toroidal terrain block, not a plant");
  assertEqual(cat("grass_block_side.svg"), "x-only", "grass_block_side is audited on X");
  assertEqual(cat("dirt_path_side.svg"), "x-only", "Any *_side master is audited on X");

  // Nothing else in the shipped tree may be exempted by accident.
  assertEqual(cat("stone.svg"), "toroidal", "stone falls through to the default category");
  assertEqual(cat("coarse_dirt.svg"), "toroidal", "coarse_dirt stays toroidal (its failure is #200, a real defect)");
  assertEqual(cat("gravel.svg"), "toroidal", "gravel stays toroidal");
  assertEqual(cat("cooked_beef.svg"), "exempt", "Handheld item icons are exempt by itemIds, not by glob");
}

// --------------------------------------------------------------------------
console.log("\n[11] The shipped rules exempt exactly the intended masters");
// --------------------------------------------------------------------------
{
  // Measured against the real tree rather than a fixture, so a rules-file edit that
  // over-exempts a terrain block fails here instead of quietly greening the audit.
  const EXPECTED_EXEMPT = [
    "grass_block_side_overlay.svg",
    "short_grass.svg",
    "short_grass_1.svg",
    "short_grass_2.svg",
    "tall_grass_bottom.svg",
    "tall_grass_top.svg"
  ];

  const blockDir = path.join(TEXTURES_DIR, "block");
  const shipped = fs.readdirSync(blockDir).filter(f => f.endsWith(".svg")).sort();
  assert(shipped.length > 0, `Found ${shipped.length} shipped masters in textures/block`);

  const exempt = shipped.filter(f => {
    const c = categorizeTexture(f, rules);
    return c.category === "exempt" || c.testAxes.length === 0;
  });

  assertEqual(
    exempt.join(", "),
    EXPECTED_EXEMPT.join(", "),
    "Exactly the six intended masters are exempt, and no terrain block is"
  );

  // Every rules-file pattern must be reachable. A pattern matching nothing is either a
  // typo or dead weight, and a dead pattern is exactly how #199 hid for as long as it did.
  // A pattern lands in the same change as the first master it matches; there is no
  // allowlist for rules written ahead of their textures.
  const unreachable = rules.patterns
    .map(p => p.pattern)
    .filter(p => p !== "grass.svg" && !shipped.some(f => matchGlob(f, p)));
  assertEqual(unreachable.join(", "), "", "Every pattern in tiling-rules.json matches at least one shipped master");
}

// --------------------------------------------------------------------------
console.log("\n[12] Extension and case variants resolve like the `.svg` master");
// --------------------------------------------------------------------------
{
  // Every pattern is written against `<stem>.svg`. A `.png`, upper-case or bare id must
  // give the answer its master gives, never fall through to the default category.
  const variants = [
    ["oak_log.svg", ["oak_log", "oak_log.png", "oak_log.SVG", "block/oak_log.png"]],
    ["grass_block_side.svg", ["grass_block_side", "grass_block_side.png", "grass_block_side.PNG"]],
    ["short_grass_1.svg", ["short_grass_1", "short_grass_1.png", "block\\short_grass_1.png"]],
    ["tall_grass_top.svg", ["tall_grass_top", "tall_grass_top.SVG"]],
    ["grass_block_side_overlay.svg", ["grass_block_side_overlay", "grass_block_side_overlay.png"]]
  ];

  for (const [master, ids] of variants) {
    const expected = categorizeTexture(master, rules);
    for (const id of ids) {
      const got = categorizeTexture(id, rules);
      assertEqual(got.category, expected.category, `'${id}' resolves to ${expected.category}, like ${master}`);
      assertEqual(got.testAxes.join(","), expected.testAxes.join(","), `'${id}' is audited on the same axes as ${master}`);
      assertEqual(resolveTilingCategory(id, rules), got.category, `resolveTilingCategory('${id}') agrees with categorizeTexture`);
    }
  }

  // An unknown extension is not stripped: it stays part of the name.
  assertEqual(
    resolveTilingCategory("grass_block_side.txt", rules),
    "toroidal",
    "Only .svg and .png are stripped, so 'grass_block_side.txt' does not match *_side.svg"
  );
}

// --------------------------------------------------------------------------
console.log("\n[13] Pillar-shaped vanilla names keep their full audit");
// --------------------------------------------------------------------------
{
  // #88 requires oak_log's toroidal tiling to be verified: logs placed side by side show
  // the X seam, so the shipped master is audited on both axes, not Y only.
  const oakLog = categorizeTexture("oak_log.svg", rules);
  assertEqual(oakLog.category, "toroidal", "The shipped oak_log.svg is audited as toroidal");
  assertEqual(oakLog.testAxes.join(","), "x,y", "oak_log.svg is audited on both X and Y");
  assertEqual(categorizeTexture("oak_log_top.svg", rules).testAxes.join(","), "x,y", "oak_log_top.svg is audited on both X and Y");

  // Real vanilla 1.21 textures ending in `_stem` that are not pillars: crop stems are
  // cutouts and mushroom_stem is a full cube. None may be narrowed to a Y-only audit by a
  // broad `*_stem.svg` rule.
  for (const f of ["pumpkin_stem.svg", "melon_stem.svg", "attached_pumpkin_stem.svg",
                   "attached_melon_stem.svg", "mushroom_stem.svg"]) {
    assert(resolveTilingCategory(f, rules) !== "y-only", `${f} is not audited as a Y-only pillar`);
  }
}

// --------------------------------------------------------------------------
console.log("\n[14] Epic 13 item textures are exempt by their vanilla texture stems");
// --------------------------------------------------------------------------
{
  // Stems are the vanilla 1.21 `textures/item/` names (and `textures/entity/` for the
  // shield, which has no item texture), not the in-game display names.
  const toolSets = [];
  for (const material of ["wooden", "stone", "iron", "golden", "diamond", "netherite"]) {
    for (const tool of ["sword", "pickaxe", "axe", "shovel", "hoe"]) {
      toolSets.push(`${material}_${tool}`);
    }
  }

  const epic13Items = [
    // #175 survival tools: six materials x sword, pickaxe, axe, shovel, hoe
    ...toolSets,
    // #176 ranged combat and defense, including every animation-state texture
    "bow", "bow_pulling_0", "bow_pulling_1", "bow_pulling_2",
    "crossbow_standby", "crossbow_pulling_0", "crossbow_pulling_1", "crossbow_pulling_2",
    "crossbow_arrow", "crossbow_firework",
    "shield_base", "shield_base_nopattern", "trident", "mace",
    // #177 food and sustenance
    "golden_apple", "cooked_beef", "golden_carrot", "baked_potato", "bread", "apple", "cooked_porkchop"
  ];
  assertEqual(toolSets.length, 30, "The tool suite covers 6 materials x 5 tool types");

  for (const itemId of epic13Items) {
    assert(rules.itemIds.includes(itemId), `'${itemId}' is listed in itemIds`);
    for (const id of [itemId, `${itemId}.svg`, `item/${itemId}.svg`, `${itemId}.png`]) {
      const c = categorizeTexture(id, rules);
      assertEqual(c.category, "exempt", `'${id}' resolves to exempt`);
      assertEqual(c.testAxes.length, 0, `'${id}' is audited on no axis`);
    }
  }

  // Ids that are not vanilla texture stems must not be listed: `steak` is `cooked_beef`,
  // `crossbow` has only state textures, `shield` has no item texture, and `porkchop` is
  // the raw item while #177 ships `cooked_porkchop`.
  for (const bogus of ["steak", "crossbow", "shield", "porkchop"]) {
    assert(!rules.itemIds.includes(bogus), `'${bogus}' is not listed in itemIds`);
  }

  for (const itemId of ["compass_nexus", "plot_compass", "spiral_core", "ninja6_token"]) {
    assertEqual(resolveTilingCategory(itemId, rules), "exempt", `Pre-existing item '${itemId}' resolves to exempt`);
  }
}

// --------------------------------------------------------------------------
console.log("\n[15] itemIds match exact stems, never substrings");
// --------------------------------------------------------------------------
{
  // Real vanilla item textures that contain, or are contained in, a listed id without
  // being listed themselves. Each resolves on its own stem.
  const cases = [
    ["bowl.svg", "contains 'bow'"],
    ["enchanted_golden_apple.svg", "contains 'golden_apple'"],
    ["carrot.svg", "is contained in 'golden_carrot'"],
    ["potato.svg", "is contained in 'baked_potato'"],
    ["porkchop.svg", "is contained in 'cooked_porkchop'"]
  ];
  for (const [f, why] of cases) {
    assertEqual(resolveTilingCategory(f, rules), "toroidal", `${f} is not exempted (${why})`);
  }

  // Standard terrain blocks still fall through to toroidal, and sides stay X only.
  for (const f of ["stone.svg", "deepslate.svg", "dirt.svg", "sand.svg", "gravel.svg"]) {
    assertEqual(resolveTilingCategory(f, rules), "toroidal", `${f} is toroidal`);
  }
  assertEqual(resolveTilingCategory("grass_block_side.svg", rules), "x-only", "grass_block_side is x-only");
  assertEqual(resolveTilingCategory("dirt_path_side.svg", rules), "x-only", "dirt_path_side is x-only");
}

console.log("\n=======================================================");
console.log(`  RESULTS: ${passedTests}/${totalTests} tests passed`);
console.log("=======================================================\n");

if (passedTests !== totalTests) process.exit(1);

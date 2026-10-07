import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_RULES_PATH = path.resolve(__dirname, "..", "tiling-rules.json");

let cachedTilingRules = null;

export function loadTilingRules(rulesPath = DEFAULT_RULES_PATH) {
  if (cachedTilingRules && rulesPath === DEFAULT_RULES_PATH) {
    return cachedTilingRules;
  }
  if (rulesPath && fs.existsSync(rulesPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
      if (rulesPath === DEFAULT_RULES_PATH) {
        cachedTilingRules = parsed;
      }
      return parsed;
    } catch {
      // Fall through to default
    }
  }
  return {
    defaultCategory: "toroidal",
    categories: {
      toroidal: { testAxes: ["x", "y"], tolerance: 0 },
      "x-only": { testAxes: ["x"], tolerance: 0 },
      "y-only": { testAxes: ["y"], tolerance: 0 },
      exempt: { testAxes: [] }
    },
    patterns: [
      { pattern: "*_side.svg", category: "x-only" },
      { pattern: "*_overlay.svg", category: "exempt" },
      { pattern: "short_grass*.svg", category: "exempt" },
      { pattern: "tall_grass_*.svg", category: "exempt" },
      { pattern: "grass.svg", category: "exempt" }
    ],
    itemIds: [],
    overrides: {}
  };
}

/** Normalizes a texture path - relative, absolute, POSIX or Windows - to its basename. */
export function basenameOf(filename) {
  return path.basename(String(filename).replace(/\\/g, "/"));
}

const GLOB_METACHARS = /[.+^${}()|[\]\\]/g;
const globRegexCache = new Map();

/**
 * Translates a glob into an anchored RegExp. `*` matches any run of characters (including
 * none) in any position, `?` matches exactly one, and every other character is literal.
 * The expression is anchored at both ends, so the whole name must match.
 */
export function globToRegExp(pattern) {
  const cached = globRegexCache.get(pattern);
  if (cached) return cached;
  const body = pattern
    .replace(GLOB_METACHARS, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  const regex = new RegExp(`^${body}$`);
  globRegexCache.set(pattern, regex);
  return regex;
}

/**
 * Matches one glob against a texture name. Patterns in tiling-rules.json address the
 * **basename**, never the path a texture was discovered at, so `short_grass.svg` and
 * `block/short_grass.svg` give the same answer.
 */
export function matchGlob(filename, pattern) {
  return globToRegExp(pattern).test(basenameOf(filename));
}

export function categorizeTexture(filename, rules = null, axisOverride = null) {
  const effectiveRules = rules || loadTilingRules();
  // Rules address the basename. `findSvgFiles` already hands over `entry.filename`, but
  // this function is exported and the CLI's `--texture` path can carry a directory, so
  // normalize once here rather than trusting every caller to have stripped it.
  const base = basenameOf(filename);
  // Patterns are written against `<stem>.svg`, so a `.png`, upper-case extension or extensionless
  // id is rebuilt from its stem and resolves exactly as its `.svg` master does.
  const stem = base.replace(/\.(svg|png)$/i, "");
  const nameWithExt = stem + ".svg";

  if (axisOverride) {
    const axes = axisOverride.toLowerCase() === "x" ? ["x"] :
                 axisOverride.toLowerCase() === "y" ? ["y"] :
                 axisOverride.toLowerCase() === "xy" ? ["x", "y"] : [];
    return {
      category: "custom-override",
      testAxes: axes,
      tolerance: 0,
      reason: `CLI --axis override (${axisOverride})`
    };
  }

  // 1. Explicit overrides
  if (effectiveRules?.overrides && (effectiveRules.overrides[filename] || effectiveRules.overrides[base] || effectiveRules.overrides[nameWithExt] || effectiveRules.overrides[stem])) {
    const ovr = effectiveRules.overrides[filename] || effectiveRules.overrides[base] || effectiveRules.overrides[nameWithExt] || effectiveRules.overrides[stem];
    const catConfig = effectiveRules.categories?.[ovr.category] || { testAxes: ["x", "y"], tolerance: 0 };
    return {
      category: ovr.category,
      testAxes: catConfig.testAxes,
      tolerance: ovr.tolerance ?? catConfig.tolerance ?? 0,
      reason: ovr.notes || "Explicit override in tiling-rules.json"
    };
  }

  // 2. Handheld items
  const isItem = Array.isArray(effectiveRules?.itemIds)
    ? effectiveRules.itemIds.includes(stem)
    : (effectiveRules?.itemIds?.has ? effectiveRules.itemIds.has(stem) : false);

  if (isItem) {
    return {
      category: "exempt",
      testAxes: [],
      tolerance: 0,
      reason: "Handheld item icon (non-tiling world asset)"
    };
  }

  // 3. Glob patterns
  if (effectiveRules?.patterns) {
    for (const pat of effectiveRules.patterns) {
      if (matchGlob(nameWithExt, pat.pattern)) {
        const catConfig = effectiveRules.categories?.[pat.category] || { testAxes: [], tolerance: 0 };
        return {
          category: pat.category,
          testAxes: catConfig.testAxes,
          tolerance: catConfig.tolerance ?? 0,
          reason: pat.reason || `Matched pattern ${pat.pattern}`
        };
      }
    }
  }

  // 4. Default category
  const defCategory = effectiveRules?.defaultCategory || "toroidal";
  const defConfig = effectiveRules?.categories?.[defCategory] || { testAxes: ["x", "y"], tolerance: 0 };
  return {
    category: defCategory,
    testAxes: defConfig.testAxes,
    tolerance: defConfig.tolerance ?? 0,
    reason: "Default toroidal full-block surface"
  };
}

/**
 * Resolves a texture identifier or filename directly to its tiling category name
 * ('toroidal', 'x-only', 'y-only', 'exempt').
 */
export function resolveTilingCategory(filename, rules = null) {
  return categorizeTexture(filename, rules).category;
}

/**
 * Keyframe Shared-Base Sync Verifier
 *
 * Some texture masters are *derivatives*: an ore is the stone master with mineral
 * geometry laid over an untouched copy of the stone background. The two files have to
 * stay byte-for-byte equivalent in their shared sections - the striation groove
 * definitions (including every corner radius `rx`) and the groove placement group, which
 * holds the slate fill as its first child - or ore blocks stop blending into the
 * surrounding stone in caves.
 *
 * Anything shared has to live *inside* a registered section to be covered. The slate fill
 * rect was originally a loose sibling of the placement group, which put it outside both
 * sections: recolouring it in stone.svg alone passed the check while leaving the ores a
 * different colour from the stone around them. It is now the group's first child, which
 * changes neither document order nor paint order.
 *
 * Nothing about copy-pasted SVG geometry enforces that on its own, and the drift shows
 * up as a visual artefact in-game rather than as a build failure. This module turns the
 * convention into a machine check: `tools/build.mjs` runs it before rasterizing, so a
 * pack that has drifted cannot be compiled or released.
 *
 * The registry lives in `tools/base-sync.json`. A derivative is recognised by carrying
 * the base's marker group id (`<g id="stone_base">`), so a new ore master that copies
 * the stone base but is never registered is reported as an error rather than silently
 * skipped.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_RULES_FILE = path.join(__dirname, "..", "base-sync.json");

/**
 * Loads the shared-base registry. Returns an empty registry when the file is absent so
 * a checkout without it degrades to "nothing to verify" instead of failing the build.
 */
export function loadBaseSyncRules(rulesFile = DEFAULT_RULES_FILE) {
  if (!fs.existsSync(rulesFile)) {
    return { version: "0", bases: {} };
  }
  const parsed = JSON.parse(fs.readFileSync(rulesFile, "utf-8"));
  if (!parsed || typeof parsed !== "object" || typeof parsed.bases !== "object" || parsed.bases === null) {
    throw new Error(`Malformed base-sync registry at ${rulesFile}: expected an object with a "bases" map`);
  }
  return parsed;
}

/**
 * Removes XML comments. Comments are documentation, not geometry: stone.svg annotates
 * each groove rect and the ore derivatives do not, and that difference is not drift.
 */
export function stripComments(svgText) {
  return svgText.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Collapses insignificant whitespace so indentation differences are not drift either.
 */
export function normalizeFragment(fragment) {
  return fragment
    .replace(/\s*\/>/g, "/>")
    .replace(/\s+/g, " ")
    .replace(/>\s+</g, "><")
    .trim();
}

/**
 * Extracts `<defs>...</defs>` (inner content). Returns null when the element is absent.
 */
export function extractDefs(svgText) {
  const open = svgText.indexOf("<defs");
  if (open === -1) return null;
  const openEnd = svgText.indexOf(">", open);
  if (openEnd === -1) return null;
  const close = svgText.indexOf("</defs>", openEnd);
  if (close === -1) return null;
  return svgText.slice(openEnd + 1, close);
}

/** Escapes a string for literal use inside a RegExp. */
function escapeRe(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Builds the matcher for a `<g>` opening tag carrying the given id. `<g` is required to
 * be followed by whitespace, `>` or `/` so it cannot match `<glyph` or any other element
 * whose name merely starts with "g".
 */
export function groupOpenTagPattern(groupId, flags = "") {
  return new RegExp(`<g(?=[\\s/>])[^>]*\\bid\\s*=\\s*["']${escapeRe(groupId)}["']`, flags);
}

/**
 * Extracts the inner content of `<g id="<groupId>">`, counting nested `<g>` elements so
 * a group containing subgroups is captured whole. Returns null when absent.
 */
export function extractGroup(svgText, groupId) {
  const marker = groupOpenTagPattern(groupId);
  const match = marker.exec(svgText);
  if (!match) return null;

  const openEnd = svgText.indexOf(">", match.index);
  if (openEnd === -1) return null;
  // A self-closing `<g ... />` has no content to compare.
  if (svgText[openEnd - 1] === "/") return "";

  let depth = 1;
  let cursor = openEnd + 1;
  const contentStart = cursor;
  // `<g` must be followed by whitespace, `/` or `>` to count as a nested group; without
  // that guard `<glyph` would inflate the depth and swallow the rest of the document.
  const nestedOpen = /<g(?=[\s/>])/g;

  while (depth > 0) {
    nestedOpen.lastIndex = cursor;
    const openMatch = nestedOpen.exec(svgText);
    const nextOpen = openMatch ? openMatch.index : -1;
    const nextClose = svgText.indexOf("</g>", cursor);
    if (nextClose === -1) return null;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      const tagEnd = svgText.indexOf(">", nextOpen);
      if (tagEnd === -1) return null;
      if (svgText[tagEnd - 1] !== "/") depth++;
      cursor = tagEnd + 1;
    } else {
      depth--;
      if (depth === 0) return svgText.slice(contentStart, nextClose);
      cursor = nextClose + 4;
    }
  }
  return null;
}

/**
 * Pulls one comparable section out of an SVG. `section` is either "defs" or
 * "group:<id>". Returns { label, value } where value is null when the section is missing.
 */
export function extractSection(svgText, section) {
  const clean = stripComments(svgText);
  if (section === "defs") {
    const defs = extractDefs(clean);
    return { label: "<defs>", value: defs === null ? null : normalizeFragment(defs) };
  }
  if (section.startsWith("group:")) {
    const groupId = section.slice("group:".length);
    const group = extractGroup(clean, groupId);
    return { label: `<g id="${groupId}">`, value: group === null ? null : normalizeFragment(group) };
  }
  throw new Error(`Unknown base-sync section "${section}" (expected "defs" or "group:<id>")`);
}

function toPosix(p) {
  return p.replace(/\\/g, "/");
}

function listSvgFiles(dir, baseDir = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...listSvgFiles(full, baseDir));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".svg")) {
      results.push(toPosix(path.relative(baseDir, full)));
    }
  }
  return results;
}

/**
 * Verifies every registered derivative against its base.
 *
 * @returns {{ ok: boolean, errors: string[], comparisons: number, derivatives: string[] }}
 */
export function checkBaseSync(texturesDir, rules = loadBaseSyncRules()) {
  const errors = [];
  let comparisons = 0;
  const derivatives = [];

  const allSvgs = listSvgFiles(texturesDir);

  for (const [baseRel, spec] of Object.entries(rules.bases)) {
    const basePath = path.join(texturesDir, baseRel);
    if (!fs.existsSync(basePath)) {
      errors.push(`Registered base master "${baseRel}" does not exist under ${toPosix(texturesDir)}`);
      continue;
    }

    const sections = Array.isArray(spec.sharedSections) && spec.sharedSections.length > 0
      ? spec.sharedSections
      : ["defs"];
    const declared = Array.isArray(spec.derivatives) ? spec.derivatives : [];
    const baseText = fs.readFileSync(basePath, "utf-8");

    // A derivative is self-identifying: it carries the base's marker group id. Anything
    // that carries it without being registered is drift waiting to happen.
    if (spec.markerGroupId) {
      const markerRe = groupOpenTagPattern(spec.markerGroupId);
      for (const rel of allSvgs) {
        if (rel === baseRel || declared.includes(rel)) continue;
        const text = fs.readFileSync(path.join(texturesDir, rel), "utf-8");
        if (markerRe.test(stripComments(text))) {
          errors.push(
            `"${rel}" carries <g id="${spec.markerGroupId}"> from "${baseRel}" but is not listed ` +
            `in tools/base-sync.json. Add it to the "derivatives" list so its shared base is verified.`
          );
        }
      }
    }

    for (const rel of declared) {
      const derivPath = path.join(texturesDir, rel);
      if (!fs.existsSync(derivPath)) {
        errors.push(`Registered derivative "${rel}" of "${baseRel}" does not exist under ${toPosix(texturesDir)}`);
        continue;
      }
      derivatives.push(rel);
      const derivText = fs.readFileSync(derivPath, "utf-8");

      for (const section of sections) {
        const baseSection = extractSection(baseText, section);
        const derivSection = extractSection(derivText, section);
        comparisons++;

        if (baseSection.value === null) {
          errors.push(`Base "${baseRel}" is missing its shared section ${baseSection.label}`);
          continue;
        }
        if (derivSection.value === null) {
          errors.push(`Derivative "${rel}" is missing the shared section ${derivSection.label} it must copy from "${baseRel}"`);
          continue;
        }
        if (baseSection.value !== derivSection.value) {
          errors.push(
            `Shared base drift: ${derivSection.label} in "${rel}" no longer matches "${baseRel}". ` +
            `Ore backgrounds must keep the striation pattern and every corner radius (rx) identical to the ` +
            `stone master or ore blocks stop blending with surrounding stone. Re-copy the section from "${baseRel}".`
          );
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, comparisons, derivatives };
}

/**
 * Build-time gate. Throws on the first failing registry so a drifted pack cannot compile.
 */
export function assertBaseSync(texturesDir, rules = loadBaseSyncRules()) {
  const result = checkBaseSync(texturesDir, rules);
  if (!result.ok) {
    throw new Error(
      "Shared-base sync check failed:\n  - " + result.errors.join("\n  - ")
    );
  }
  return result;
}

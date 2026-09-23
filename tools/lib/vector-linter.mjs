#!/usr/bin/env node

/**
 * Keyframe Automated Static SVG Vector Master Linter
 *
 * Enforces production-grade vector constraints across all SVG masters in textures/:
 * 1. Root viewBox is exactly "0 0 512 512" (512x512 master resolution requirement).
 * 2. Absolute prohibition of editor namespaces (xmlns:inkscape, xmlns:sodipodi, xmlns:illustrator).
 * 3. Absolute prohibition of embedded raster images (<image>, and <feImage> with a
 *    non-fragment href).
 * 4. Referential integrity for clipPath definitions and url(#id) references,
 *    preventing silent @resvg/resvg-js rendering bugs and missing layer artifacts.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DEFAULT_TEXTURES_DIR = path.join(ROOT_DIR, "textures");

export const REQUIRED_VIEWBOX = "0 0 512 512";

export const FORBIDDEN_NAMESPACES = Object.freeze([
  "xmlns:inkscape",
  "xmlns:sodipodi",
  "xmlns:illustrator"
]);

/**
 * Strips XML comments so documentation and commented references do not cause false positives.
 */
export function stripComments(svgText) {
  return svgText.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Normalizes a file path to POSIX format.
 */
export function toPosix(p) {
  return p.replace(/\\/g, "/");
}

/**
 * Recursively locates all .svg files under target directory.
 */
export function findSvgFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".svg")) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results.sort();
}

/**
 * Lints the SVG content string against all Keyframe vector master invariants.
 *
 * @param {string} svgContent Raw SVG source text
 * @param {string} [filePath="<inline>"] Context path for error formatting
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function lintSvgContent(svgContent, filePath = "<inline>") {
  const errors = [];
  const clean = stripComments(svgContent);

  // 1. Root <svg> element and viewBox verification
  const rootSvgMatch = clean.match(/<svg\b([^>]*)>/i);
  if (!rootSvgMatch) {
    errors.push(`${filePath}: Missing <svg> root element`);
    return { ok: false, errors };
  }

  const svgAttrs = rootSvgMatch[1];
  const viewBoxMatch = svgAttrs.match(/\bviewBox\s*=\s*(["'])(.*?)\1/i);
  if (!viewBoxMatch) {
    errors.push(`${filePath}: Missing viewBox attribute (viewBox must be exactly "${REQUIRED_VIEWBOX}")`);
  } else {
    const rawViewBox = viewBoxMatch[2];
    const normalizedViewBox = rawViewBox.trim().replace(/\s+/g, " ");
    if (normalizedViewBox !== REQUIRED_VIEWBOX) {
      errors.push(`${filePath}: Invalid viewBox "${rawViewBox}" (must be exactly "${REQUIRED_VIEWBOX}")`);
    }
  }

  // 2. Forbidden editor namespaces & editor residue
  for (const ns of FORBIDDEN_NAMESPACES) {
    const nsRegex = new RegExp(`\\b${ns}\\b`, "i");
    if (nsRegex.test(clean)) {
      errors.push(`${filePath}: Forbidden editor namespace detected: "${ns}"`);
    }
  }

  const editorTagMatch = clean.match(/<(?:inkscape|sodipodi):[a-z0-9_-]+/i);
  if (editorTagMatch) {
    errors.push(`${filePath}: Forbidden editor element detected: "${editorTagMatch[0]}"`);
  }

  // 3. Forbidden embedded raster images
  if (/<(?:[a-zA-Z0-9_-]+:)?image\b/i.test(clean)) {
    errors.push(`${filePath}: Forbidden embedded raster image (<image>) detected`);
  }

  // <feImage> renders an external or data-URI raster inside a filter just like <image>.
  // Only a same-document fragment reference (href="#id") keeps the source vector.
  const feImageRegex = /<(?:[a-zA-Z0-9_-]+:)?feImage\b([^>]*)>/gi;
  let feImageMatch;
  while ((feImageMatch = feImageRegex.exec(clean)) !== null) {
    const hrefMatch = feImageMatch[1].match(/(?:^|\s)(?:xlink:)?href\s*=\s*(["'])(.*?)\1/i);
    if (hrefMatch && !hrefMatch[2].trim().startsWith("#")) {
      errors.push(`${filePath}: Forbidden embedded raster image (<feImage href="${hrefMatch[2]}">) detected`);
    }
  }

  // 4. ClipPath and url(#id) referential integrity
  // Anchored on preceding whitespace so attributes such as data-id="..." are not
  // mistaken for id declarations.
  const definedIds = new Set();
  const idRegex = /(?:^|\s)id\s*=\s*(["'])(.*?)\1/gi;
  let idMatch;
  while ((idMatch = idRegex.exec(clean)) !== null) {
    const id = idMatch[2].trim();
    if (id) {
      definedIds.add(id);
    }
  }

  // Inspect <clipPath> definitions
  const clipPathIds = new Set();
  const clipPathRegex = /<clipPath\b([^>]*)>/gi;
  let cpMatch;
  while ((cpMatch = clipPathRegex.exec(clean)) !== null) {
    const attrs = cpMatch[1];
    const clipIdMatch = attrs.match(/(?:^|\s)id\s*=\s*(["'])(.*?)\1/i);
    if (!clipIdMatch || !clipIdMatch[2].trim()) {
      errors.push(`${filePath}: <clipPath> element is missing required "id" attribute`);
    } else {
      clipPathIds.add(clipIdMatch[2].trim());
    }
  }

  // Inspect url(#id) references across all attributes and style declarations
  const urlRegex = /url\(\s*(["']?)#([^\s)"']+)\1\s*\)/gi;
  let urlMatch;
  while ((urlMatch = urlRegex.exec(clean)) !== null) {
    const refId = urlMatch[2].trim();
    if (!definedIds.has(refId)) {
      errors.push(`${filePath}: Missing referenced ID "${refId}" in url(#${refId}) (element with id="${refId}" does not exist in file)`);
    }
  }

  // Inspect clip-path attributes specifically referencing clip paths
  const clipPathRefRegex = /(?:clip-path\s*=\s*["']\s*url\(\s*["']?#([^\s)"']+)["']?\s*\)|clip-path\s*:\s*url\(\s*["']?#([^\s)"']+)["']?\s*\))/gi;
  let cprefMatch;
  while ((cprefMatch = clipPathRefRegex.exec(clean)) !== null) {
    const refId = (cprefMatch[1] || cprefMatch[2]).trim();
    if (definedIds.has(refId) && !clipPathIds.has(refId)) {
      errors.push(`${filePath}: Invalid clip-path reference "#${refId}": element exists but is not a <clipPath>`);
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

/**
 * Lints a single SVG file on disk.
 *
 * @param {string} filePath Absolute or relative path to SVG file
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function lintSvgFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return lintSvgContent(content, toPosix(path.relative(ROOT_DIR, filePath)));
  } catch (err) {
    return {
      ok: false,
      errors: [`${toPosix(filePath)}: Failed to read file: ${err.message}`]
    };
  }
}

/**
 * Lints all SVG files in the given directory (or single file).
 *
 * @param {string} [targetDir=DEFAULT_TEXTURES_DIR] Directory or file to inspect
 * @returns {{ ok: boolean, errors: string[], filesChecked: number }}
 */
export function lintVectors(targetDir = DEFAULT_TEXTURES_DIR) {
  const allErrors = [];
  let files = [];

  if (!fs.existsSync(targetDir)) {
    return {
      ok: false,
      errors: [`Target path does not exist: "${toPosix(targetDir)}"`],
      filesChecked: 0
    };
  }

  const stat = fs.statSync(targetDir);
  if (stat.isFile()) {
    files = [targetDir];
  } else {
    files = findSvgFiles(targetDir);
  }

  for (const file of files) {
    const result = lintSvgFile(file);
    if (!result.ok) {
      allErrors.push(...result.errors);
    }
  }

  return {
    ok: allErrors.length === 0,
    errors: allErrors,
    filesChecked: files.length
  };
}

/**
 * CLI execution handler
 */
export function runCli() {
  const target = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : DEFAULT_TEXTURES_DIR;
  const relTarget = toPosix(path.relative(process.cwd(), target)) || ".";

  console.log(`\n======================================================`);
  console.log(`  Keyframe Vector Master Linter`);
  console.log(`  Target: ${relTarget}`);
  console.log(`======================================================\n`);

  const result = lintVectors(target);

  if (result.ok) {
    console.log(`✓ PASS: All ${result.filesChecked} vector master(s) conform to specifications.`);
    console.log(`        - viewBox: ${REQUIRED_VIEWBOX}`);
    console.log(`        - Editor namespaces: None`);
    console.log(`        - Embedded raster images: None`);
    console.log(`        - ClipPath and url(#id) references: Fully verified\n`);
    process.exit(0);
  } else {
    console.error(`❌ FAIL: Vector master linter detected ${result.errors.length} error(s) across ${result.filesChecked} file(s):\n`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    console.error("");
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  runCli();
}

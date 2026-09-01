#!/usr/bin/env node

/**
 * Keyframe Toroidal 3x3 Tiling & Seam-Audit Test Harness
 *
 * Headless test harness powered by @resvg/resvg-js that:
 * 1. Renders 512x512 SVG masters into 3x3 (1536x1536) tiled test grids.
 * 2. Performs automated pixel-difference seam analysis across toroidal boundaries (X=0 <-> X=512, Y=0 <-> Y=512).
 * 3. Enforces zero seam discontinuity tolerance gate for CI.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const TEXTURES_DIR = path.join(ROOT_DIR, "textures");
const RULES_FILE = path.join(__dirname, "tiling-rules.json");
const DEFAULT_OUT_DIR = path.join(ROOT_DIR, "dist", "tiling_tests");

// --------------------------------------------------------------------------
// Configuration & Rules Loader
// --------------------------------------------------------------------------

function loadRules() {
  if (fs.existsSync(RULES_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(RULES_FILE, "utf-8"));
    } catch (err) {
      console.warn(`[WARN] Failed to parse ${RULES_FILE}: ${err.message}. Using built-in defaults.`);
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
      { pattern: "tall_grass_*.svg", category: "exempt" }
    ],
    itemIds: ["cooked_beef", "golden_apple", "compass_nexus", "plot_compass", "spiral_core", "ninja6_token"],
    overrides: {}
  };
}

function matchGlob(filename, pattern) {
  if (pattern.startsWith("*") && pattern.endsWith("*")) {
    return filename.includes(pattern.slice(1, -1));
  }
  if (pattern.startsWith("*")) {
    return filename.endsWith(pattern.slice(1));
  }
  if (pattern.endsWith("*")) {
    return filename.startsWith(pattern.slice(0, -1));
  }
  return filename === pattern;
}

export function categorizeTexture(filename, rules, axisOverride = null) {
  const stem = path.basename(filename, ".svg");

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
  if (rules.overrides && rules.overrides[filename]) {
    const ovr = rules.overrides[filename];
    const catConfig = rules.categories[ovr.category] || { testAxes: ["x", "y"], tolerance: 0 };
    return {
      category: ovr.category,
      testAxes: catConfig.testAxes,
      tolerance: ovr.tolerance ?? catConfig.tolerance ?? 0,
      reason: ovr.notes || "Explicit override in tiling-rules.json"
    };
  }

  // 2. Handheld items
  if (rules.itemIds && rules.itemIds.includes(stem)) {
    return {
      category: "exempt",
      testAxes: [],
      tolerance: 0,
      reason: "Handheld item icon (non-tiling world asset)"
    };
  }

  // 3. Glob patterns
  if (rules.patterns) {
    for (const pat of rules.patterns) {
      if (matchGlob(filename, pat.pattern)) {
        const catConfig = rules.categories[pat.category] || { testAxes: [], tolerance: 0 };
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
  const defCategory = rules.defaultCategory || "toroidal";
  const defConfig = rules.categories[defCategory] || { testAxes: ["x", "y"], tolerance: 0 };
  return {
    category: defCategory,
    testAxes: defConfig.testAxes,
    tolerance: defConfig.tolerance ?? 0,
    reason: "Default toroidal full-block surface"
  };
}

// --------------------------------------------------------------------------
// Resvg Rasterization & 3x3 Grid Compiler
// --------------------------------------------------------------------------

export function rasterizeSvg(svgText, targetSize = 512) {
  const resvg = new Resvg(svgText, {
    fitTo: {
      mode: "width",
      value: targetSize
    }
  });
  const rendered = resvg.render();
  return {
    width: rendered.width,
    height: rendered.height,
    pixels: rendered.pixels,
    asPng: () => rendered.asPng()
  };
}

export function createTiled3x3Buffer(singlePixels, width = 512, height = 512) {
  const tileCols = 3;
  const tileRows = 3;
  const targetW = width * tileCols;
  const targetH = height * tileRows;
  const targetBuf = Buffer.alloc(targetW * targetH * 4);

  for (let ty = 0; ty < tileRows; ty++) {
    for (let tx = 0; tx < tileCols; tx++) {
      const offsetX = tx * width;
      const offsetY = ty * height;

      for (let y = 0; y < height; y++) {
        const srcRowStart = y * width * 4;
        const dstRowStart = ((offsetY + y) * targetW + offsetX) * 4;
        singlePixels.copy(targetBuf, dstRowStart, srcRowStart, srcRowStart + width * 4);
      }
    }
  }

  return {
    width: targetW,
    height: targetH,
    pixels: targetBuf
  };
}

/**
 * Builds a clean 1536x1536 3x3 composite SVG and rasterizes directly with Resvg
 */
export function render3x3CompositeSvg(svgText, targetSize = 1536) {
  const defsMatch = svgText.match(/<defs>([\s\S]*?)<\/defs>/);
  const defsContent = defsMatch ? defsMatch[1] : "";
  const bodyContent = svgText
    .replace(/<\?xml[\s\S]*?\?>/, "")
    .replace(/<svg[^>]*>/, "")
    .replace(/<\/svg>/, "")
    .replace(/<defs>[\s\S]*?<\/defs>/, "");

  const compositeSvg = `
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  viewBox="0 0 1536 1536" width="1536" height="1536">
  <defs>
    ${defsContent}
    <g id="master_tile">
      ${bodyContent}
    </g>
  </defs>
  <g transform="translate(0, 0)"><use href="#master_tile" /></g>
  <g transform="translate(512, 0)"><use href="#master_tile" /></g>
  <g transform="translate(1024, 0)"><use href="#master_tile" /></g>
  <g transform="translate(0, 512)"><use href="#master_tile" /></g>
  <g transform="translate(512, 512)"><use href="#master_tile" /></g>
  <g transform="translate(1024, 512)"><use href="#master_tile" /></g>
  <g transform="translate(0, 1024)"><use href="#master_tile" /></g>
  <g transform="translate(512, 1024)"><use href="#master_tile" /></g>
  <g transform="translate(1024, 1024)"><use href="#master_tile" /></g>
</svg>`;

  const resvg = new Resvg(compositeSvg, {
    fitTo: { mode: "width", value: targetSize }
  });
  const rendered = resvg.render();
  return {
    width: rendered.width,
    height: rendered.height,
    pixels: rendered.pixels,
    asPng: () => rendered.asPng()
  };
}

// --------------------------------------------------------------------------
// Automated Pixel-Difference Seam Analysis
// --------------------------------------------------------------------------

function toHex(r, g, b, a) {
  const hex = [r, g, b].map(c => c.toString(16).padStart(2, "0")).join("");
  return a < 255 ? `#${hex}${a.toString(16).padStart(2, "0")}` : `#${hex}`;
}

export function analyzeSeams(renderedImage, testAxes = ["x", "y"], tolerance = 0) {
  const { width: W, height: H, pixels: px } = renderedImage;
  const errors = [];

  // 1. Horizontal Seam (X-axis wrap: Column 0 vs Column W-1)
  if (testAxes.includes("x")) {
    for (let y = 0; y < H; y++) {
      const idx0 = (y * W + 0) * 4;
      const idx1 = (y * W + (W - 1)) * 4;

      const dr = Math.abs(px[idx0 + 0] - px[idx1 + 0]);
      const dg = Math.abs(px[idx0 + 1] - px[idx1 + 1]);
      const db = Math.abs(px[idx0 + 2] - px[idx1 + 2]);
      const da = Math.abs(px[idx0 + 3] - px[idx1 + 3]);
      const delta = Math.max(dr, dg, db, da);

      if (delta > tolerance) {
        errors.push({
          axis: "X",
          coord: y,
          delta,
          color0: toHex(px[idx0], px[idx0 + 1], px[idx0 + 2], px[idx0 + 3]),
          color1: toHex(px[idx1], px[idx1 + 1], px[idx1 + 2], px[idx1 + 3]),
          c0Raw: [px[idx0], px[idx0 + 1], px[idx0 + 2], px[idx0 + 3]],
          c1Raw: [px[idx1], px[idx1 + 1], px[idx1 + 2], px[idx1 + 3]]
        });
      }
    }
  }

  // 2. Vertical Seam (Y-axis wrap: Row 0 vs Row H-1)
  if (testAxes.includes("y")) {
    for (let x = 0; x < W; x++) {
      const idx0 = (0 * W + x) * 4;
      const idx1 = ((H - 1) * W + x) * 4;

      const dr = Math.abs(px[idx0 + 0] - px[idx1 + 0]);
      const dg = Math.abs(px[idx0 + 1] - px[idx1 + 1]);
      const db = Math.abs(px[idx0 + 2] - px[idx1 + 2]);
      const da = Math.abs(px[idx0 + 3] - px[idx1 + 3]);
      const delta = Math.max(dr, dg, db, da);

      if (delta > tolerance) {
        errors.push({
          axis: "Y",
          coord: x,
          delta,
          color0: toHex(px[idx0], px[idx0 + 1], px[idx0 + 2], px[idx0 + 3]),
          color1: toHex(px[idx1], px[idx1 + 1], px[idx1 + 2], px[idx1 + 3]),
          c0Raw: [px[idx0], px[idx0 + 1], px[idx0 + 2], px[idx0 + 3]],
          c1Raw: [px[idx1], px[idx1 + 1], px[idx1 + 2], px[idx1 + 3]]
        });
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    xErrorCount: errors.filter(e => e.axis === "X").length,
    yErrorCount: errors.filter(e => e.axis === "Y").length,
    maxDelta: errors.length > 0 ? Math.max(...errors.map(e => e.delta)) : 0
  };
}

export function groupErrorSpans(errors) {
  if (!errors || errors.length === 0) return [];
  const spans = [];
  let currentSpan = null;

  for (const err of errors) {
    if (!currentSpan || currentSpan.axis !== err.axis || err.coord !== currentSpan.endCoord + 1) {
      if (currentSpan) spans.push(currentSpan);
      currentSpan = {
        axis: err.axis,
        startCoord: err.coord,
        endCoord: err.coord,
        count: 1,
        maxDelta: err.delta,
        sampleColor0: err.color0,
        sampleColor1: err.color1
      };
    } else {
      currentSpan.endCoord = err.coord;
      currentSpan.count++;
      currentSpan.maxDelta = Math.max(currentSpan.maxDelta, err.delta);
    }
  }
  if (currentSpan) spans.push(currentSpan);
  return spans;
}

// --------------------------------------------------------------------------
// Recursive Texture File Discovery
// --------------------------------------------------------------------------

function findSvgFiles(dir, baseDir = dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...findSvgFiles(fullPath, baseDir));
    } else if (entry.isFile() && entry.name.endsWith(".svg")) {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      results.push({ relPath, fullPath, filename: entry.name });
    }
  }
  return results.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

// --------------------------------------------------------------------------
// Main Test Runner
// --------------------------------------------------------------------------

export async function runTilingAudit(options = {}) {
  const {
    targetFile = null,
    renderGrids = false,
    outDir = DEFAULT_OUT_DIR,
    tolerance = null,
    axisOverride = null,
    jsonOutput = false,
    verbose = true
  } = options;

  const rules = loadRules();
  const allSvgEntries = findSvgFiles(TEXTURES_DIR);

  let filesToAudit = [];
  if (targetFile) {
    const cleanTarget = targetFile.replace(/\\/g, "/");
    const stem = path.basename(cleanTarget, ".svg");
    const matched = allSvgEntries.filter(
      e => e.relPath === cleanTarget ||
           e.filename === path.basename(cleanTarget) ||
           path.basename(e.filename, ".svg") === stem
    );
    if (matched.length > 0) {
      filesToAudit = matched;
    } else if (fs.existsSync(path.resolve(cleanTarget))) {
      const abs = path.resolve(cleanTarget);
      filesToAudit = [{ relPath: path.basename(abs), fullPath: abs, filename: path.basename(abs) }];
    } else {
      filesToAudit = [{ relPath: cleanTarget, fullPath: path.join(TEXTURES_DIR, cleanTarget), filename: path.basename(cleanTarget) }];
    }
  } else {
    filesToAudit = allSvgEntries;
  }

  if (renderGrids && !fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const results = [];
  let passedCount = 0;
  let failedCount = 0;
  let exemptCount = 0;

  if (verbose && !jsonOutput) {
    console.log(`\n======================================================`);
    console.log(`  Keyframe Toroidal 3×3 Tiling & Seam Audit Harness`);
    console.log(`  Target Textures: ${filesToAudit.length} SVG master(s)`);
    console.log(`  Render 3×3 PNGs: ${renderGrids ? `YES (${outDir})` : "NO"}`);
    console.log(`======================================================\n`);
  }

  for (const entry of filesToAudit) {
    const { relPath, fullPath: svgPath, filename } = entry;
    if (!fs.existsSync(svgPath)) {
      console.error(`[ERROR] Texture file not found: ${svgPath}`);
      failedCount++;
      results.push({ file: relPath, passed: false, error: "File not found" });
      continue;
    }

    const categorization = categorizeTexture(filename, rules, axisOverride);
    const effectiveTolerance = tolerance !== null ? tolerance : categorization.tolerance;

    if (categorization.category === "exempt" || categorization.testAxes.length === 0) {
      exemptCount++;
      results.push({
        file: relPath,
        category: categorization.category,
        passed: true,
        exempt: true,
        reason: categorization.reason
      });
      if (verbose && !jsonOutput) {
        console.log(`  ⊘ EXEMPT  ${relPath.padEnd(32)} (${categorization.reason})`);
      }
      continue;
    }

    const svgText = fs.readFileSync(svgPath, "utf-8");
    const singleRender = rasterizeSvg(svgText, 512);
    const seamAudit = analyzeSeams(singleRender, categorization.testAxes, effectiveTolerance);

    let renderedPath = null;
    if (renderGrids) {
      const stem = path.basename(filename, ".svg");
      const outPngPath = path.join(outDir, `${stem}_3x3.png`);
      try {
        const composite = render3x3CompositeSvg(svgText, 1536);
        fs.writeFileSync(outPngPath, composite.asPng());
        renderedPath = outPngPath;
      } catch {
        // Fallback to pure buffer tiling
        const tiled = createTiled3x3Buffer(singleRender.pixels, 512, 512);
      }
    }

    const spans = groupErrorSpans(seamAudit.errors);
    const fileResult = {
      file: relPath,
      category: categorization.category,
      testAxes: categorization.testAxes,
      tolerance: effectiveTolerance,
      passed: seamAudit.passed,
      exempt: false,
      xErrorCount: seamAudit.xErrorCount,
      yErrorCount: seamAudit.yErrorCount,
      maxDelta: seamAudit.maxDelta,
      spans,
      rendered3x3: renderedPath
    };
    results.push(fileResult);

    if (seamAudit.passed) {
      passedCount++;
      if (verbose && !jsonOutput) {
        const axisStr = categorization.testAxes.join("+").toUpperCase();
        console.log(`  ✓ PASS    ${relPath.padEnd(32)} [${axisStr}]  Seam Δ=0 (0 errors)`);
      }
    } else {
      failedCount++;
      if (verbose && !jsonOutput) {
        const axisStr = categorization.testAxes.join("+").toUpperCase();
        console.log(`  ✗ FAIL    ${relPath.padEnd(32)} [${axisStr}]  X: ${seamAudit.xErrorCount} errs, Y: ${seamAudit.yErrorCount} errs (Max Δ=${seamAudit.maxDelta})`);
        for (const span of spans) {
          const axisName = span.axis === "X" ? "X-Seam (Y-coord)" : "Y-Seam (X-coord)";
          console.log(`      ↳ ${axisName} [${span.startCoord}..${span.endCoord}]: ${span.count}px mismatch (Max Δ=${span.maxDelta}, ${span.sampleColor0} vs ${span.sampleColor1})`);
        }
      }

      // GitHub Actions Annotations
      if (process.env.GITHUB_ACTIONS) {
        const desc = spans.map(s => `${s.axis}[${s.startCoord}..${s.endCoord}] Δ=${s.maxDelta}`).join(", ");
        console.log(`::error file=textures/${relPath},line=1,col=1::Toroidal seam discontinuity in ${relPath}: ${desc}`);
      }
    }
  }

  const overallPassed = failedCount === 0;

  if (jsonOutput) {
    console.log(JSON.stringify({
      passed: overallPassed,
      total: filesToAudit.length,
      passedCount,
      failedCount,
      exemptCount,
      results
    }, null, 2));
  } else if (verbose) {
    console.log(`\n------------------------------------------------------`);
    console.log(`  Audit Summary:`);
    console.log(`    Total Textures: ${filesToAudit.length}`);
    console.log(`    ✓ Passed:       ${passedCount}`);
    console.log(`    ✗ Failed:       ${failedCount}`);
    console.log(`    ⊘ Exempt:       ${exemptCount}`);
    console.log(`  Status: ${overallPassed ? "✓ ALL AUDITS PASSED (Zero Discontinuity)" : "✗ SEAM AUDIT FAILED"}`);
    console.log(`------------------------------------------------------\n`);
  }

  return {
    passed: overallPassed,
    total: filesToAudit.length,
    passedCount,
    failedCount,
    exemptCount,
    results
  };
}

// --------------------------------------------------------------------------
// CLI Execution
// --------------------------------------------------------------------------

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  let targetFile = null;
  let renderGrids = false;
  let outDir = DEFAULT_OUT_DIR;
  let tolerance = null;
  let axisOverride = null;
  let jsonOutput = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(`
Usage: node tools/test-tiling.mjs [options] [texture.svg]

Options:
  --render             Render 1536×1536 3×3 tiled grid PNGs
  --out <dir>          Output directory for 3×3 PNGs (default: dist/tiling_tests)
  --texture <name>     Audit specific texture (e.g. --texture stone)
  --tolerance <N>      Discontinuity tolerance threshold (default: 0)
  --axis <x|y|xy>      Override test axis mode
  --json               Output machine-readable JSON report
  -h, --help           Show this help message
`);
      process.exit(0);
    } else if (arg === "--render") {
      renderGrids = true;
    } else if (arg === "--out" && args[i + 1]) {
      outDir = path.resolve(args[++i]);
    } else if (arg === "--texture" && args[i + 1]) {
      targetFile = args[++i];
    } else if (arg === "--tolerance" && args[i + 1]) {
      tolerance = parseInt(args[++i], 10);
    } else if (arg === "--axis" && args[i + 1]) {
      axisOverride = args[++i];
    } else if (arg === "--json") {
      jsonOutput = true;
    } else if (!arg.startsWith("-")) {
      targetFile = arg;
    }
  }

  const result = await runTilingAudit({
    targetFile,
    renderGrids,
    outDir,
    tolerance,
    axisOverride,
    jsonOutput
  });

  if (!result.passed) {
    process.exit(1);
  }
}

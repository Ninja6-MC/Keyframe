#!/usr/bin/env node

/**
 * Keyframe Automated SVG Palette-Injection Engine
 * 
 * Compiles 16-color Minecraft dye variations from master vector SVG templates
 * in milliseconds. Supports semantic color tokens, cinematic trailer & vanilla baselines,
 * custom palette overrides, automatic shade derivation, and SVG ID namespacing.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const DEFAULT_PALETTE_PATH = path.join(ROOT_DIR, "tools", "palettes", "minecraft-dyes.json");

/**
 * 16 Canonical Minecraft Dye Identifiers (Java 1.13+ standard)
 */
export const MINECRAFT_DYES = Object.freeze([
  "white",
  "orange",
  "magenta",
  "light_blue",
  "yellow",
  "lime",
  "pink",
  "gray",
  "light_gray",
  "cyan",
  "purple",
  "blue",
  "brown",
  "green",
  "red",
  "black"
]);

/**
 * Hex color validation regex (#RGB, #RGBA, #RRGGBB, #RRGGBBAA)
 */
export const HEX_COLOR_REGEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

/**
 * Validates a hex color code
 */
export function isValidHex(hex) {
  return typeof hex === "string" && HEX_COLOR_REGEX.test(hex.trim());
}

/**
 * Parses Hex string to RGBA components
 */
export function hexToRgb(hex) {
  if (!isValidHex(hex)) {
    throw new Error(`Invalid hex color code: "${hex}"`);
  }
  let c = hex.trim().replace(/^#/, "");
  if (c.length === 3 || c.length === 4) {
    c = c.split("").map((ch) => ch + ch).join("");
  }
  const num = parseInt(c, 16);
  if (c.length === 6) {
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255,
      a: 1.0
    };
  }
  return {
    r: (num >> 24) & 255,
    g: (num >> 16) & 255,
    b: (num >> 8) & 255,
    a: Math.round(((num & 255) / 255) * 1000) / 1000
  };
}

/**
 * Converts RGB(A) object to Hex string
 */
export function rgbToHex({ r, g, b, a = 1.0 }) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const hexR = clamp(r).toString(16).padStart(2, "0");
  const hexG = clamp(g).toString(16).padStart(2, "0");
  const hexB = clamp(b).toString(16).padStart(2, "0");
  if (a !== undefined && a < 1.0) {
    const hexA = clamp(a * 255).toString(16).padStart(2, "0");
    return `#${hexR}${hexG}${hexB}${hexA}`.toUpperCase();
  }
  return `#${hexR}${hexG}${hexB}`.toUpperCase();
}

/**
 * RGB to HSL conversion
 */
export function rgbToHsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h /= 6;
  }
  return { h: h * 360, s, l };
}

/**
 * HSL to RGB conversion
 */
export function hslToRgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hNorm = h / 360;
    r = hue2rgb(p, q, hNorm + 1 / 3);
    g = hue2rgb(p, q, hNorm);
    b = hue2rgb(p, q, hNorm - 1 / 3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255)
  };
}

/**
 * Perceptual Shade Derivation with warm/cool hue shifting.
 * Derives Highlight (+18% L, subtle warm shift) and Shadow (-20% L, subtle cool shift)
 * if only a primary hex is supplied.
 */
export function deriveShades(primaryHex) {
  const { r, g, b, a } = hexToRgb(primaryHex);
  const { h, s, l } = rgbToHsl(r, g, b);

  // Highlight: Higher lightness, subtle warm shift towards ~55° (yellow) or cyan
  const hlLightness = Math.min(1.0, l + 0.18 + (1.0 - l) * 0.1);
  const hlSat = Math.max(0.1, s * 0.95);
  const hlHue = h + (h > 60 && h < 240 ? -5 : 5);
  const hlRgb = hslToRgb(hlHue, hlSat, hlLightness);

  // Shadow: Lower lightness, subtle cool shift towards ~230° (blue/slate)
  const shLightness = Math.max(0.05, l - 0.22);
  const shSat = Math.min(1.0, s * 1.08);
  const shHue = h + (h > 60 && h < 240 ? 6 : -6);
  const shRgb = hslToRgb(shHue, shSat, shLightness);

  // Deep dark shadow: -35% lightness
  const darkShLightness = Math.max(0.02, l - 0.36);
  const darkShRgb = hslToRgb(shHue, Math.min(1.0, s * 1.15), darkShLightness);

  // Accent: High-contrast vibrant tone
  const accentLightness = Math.min(0.95, Math.max(0.3, l + 0.08));
  const accentSat = Math.min(1.0, s * 1.25);
  const accentRgb = hslToRgb(h, accentSat, accentLightness);

  return {
    PRIMARY_COLOR: rgbToHex({ r, g, b, a }),
    HIGHLIGHT_COLOR: rgbToHex({ ...hlRgb, a }),
    SHADOW_COLOR: rgbToHex({ ...shRgb, a }),
    DARK_SHADOW_COLOR: rgbToHex({ ...darkShRgb, a }),
    ACCENT_COLOR: rgbToHex({ ...accentRgb, a })
  };
}

/**
 * Loads and resolves a palette JSON file, merging overrides and normalizing color entries.
 * 
 * @param {string|object} [paletteNameOrPath="trailer"] - "trailer", "vanilla", or file path / palette object
 * @param {object|string} [overrides=null] - Optional override dictionary or path to JSON override file
 * @returns {object} Normalized dictionary mapping colorId -> colorMap
 */
export function loadPalette(paletteNameOrPath = "trailer", overrides = null) {
  let rawPaletteDoc;

  if (typeof paletteNameOrPath === "object" && paletteNameOrPath !== null) {
    rawPaletteDoc = paletteNameOrPath;
  } else if (typeof paletteNameOrPath === "string") {
    if (paletteNameOrPath.endsWith(".json") || fs.existsSync(paletteNameOrPath)) {
      const content = fs.readFileSync(path.resolve(paletteNameOrPath), "utf-8");
      rawPaletteDoc = JSON.parse(content);
    } else {
      const content = fs.readFileSync(DEFAULT_PALETTE_PATH, "utf-8");
      const defaultDoc = JSON.parse(content);
      const paletteKey = paletteNameOrPath.toLowerCase();
      if (defaultDoc.palettes && defaultDoc.palettes[paletteKey]) {
        rawPaletteDoc = defaultDoc.palettes[paletteKey];
      } else {
        throw new Error(`Unknown palette name "${paletteNameOrPath}". Available: ${Object.keys(defaultDoc.palettes || {}).join(", ")}`);
      }
    }
  } else {
    const content = fs.readFileSync(DEFAULT_PALETTE_PATH, "utf-8");
    const defaultDoc = JSON.parse(content);
    rawPaletteDoc = defaultDoc.palettes.trailer;
  }

  // Extract raw colors map
  const colorsMap = rawPaletteDoc.colors || rawPaletteDoc;

  // Load custom overrides if specified
  let overrideMap = {};
  if (overrides) {
    if (typeof overrides === "string") {
      if (overrides.trim().startsWith("{")) {
        overrideMap = JSON.parse(overrides);
      } else if (fs.existsSync(overrides)) {
        overrideMap = JSON.parse(fs.readFileSync(path.resolve(overrides), "utf-8"));
      }
    } else if (typeof overrides === "object") {
      overrideMap = overrides;
    }
    if (overrideMap.colors) {
      overrideMap = overrideMap.colors;
    }
  }

  const normalizedPalette = {};

  for (const dyeId of MINECRAFT_DYES) {
    const baseEntry = colorsMap[dyeId] || {};
    const overrideEntry = overrideMap[dyeId] || {};
    const merged = { ...baseEntry, ...overrideEntry };

    // Format human-readable title
    const name = merged.name || dyeId.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

    // Extract primary color
    const primary = merged.PRIMARY_COLOR || merged.primary || merged.primary_color || merged.hex || merged.color || null;

    if (!primary) {
      throw new Error(`Missing PRIMARY_COLOR for dye "${dyeId}" in palette.`);
    }

    if (!isValidHex(primary)) {
      throw new Error(`Invalid primary hex code "${primary}" for dye "${dyeId}".`);
    }

    // Derive or extract shadow, highlight, dark_shadow, accent
    const derived = deriveShades(primary);

    const shadow = merged.SHADOW_COLOR || merged.shadow || merged.shadow_color || derived.SHADOW_COLOR;
    const highlight = merged.HIGHLIGHT_COLOR || merged.highlight || merged.highlight_color || derived.HIGHLIGHT_COLOR;
    const darkShadow = merged.DARK_SHADOW_COLOR || merged.dark_shadow || merged.dark_shadow_color || derived.DARK_SHADOW_COLOR;
    const accent = merged.ACCENT_COLOR || merged.accent || merged.accent_color || derived.ACCENT_COLOR;

    if (!isValidHex(shadow)) throw new Error(`Invalid shadow hex "${shadow}" for dye "${dyeId}".`);
    if (!isValidHex(highlight)) throw new Error(`Invalid highlight hex "${highlight}" for dye "${dyeId}".`);
    if (!isValidHex(darkShadow)) throw new Error(`Invalid dark shadow hex "${darkShadow}" for dye "${dyeId}".`);
    if (!isValidHex(accent)) throw new Error(`Invalid accent hex "${accent}" for dye "${dyeId}".`);

    normalizedPalette[dyeId] = {
      id: dyeId,
      name,
      // Canonical tokens (Uppercase)
      PRIMARY_COLOR: primary.toUpperCase(),
      SHADOW_COLOR: shadow.toUpperCase(),
      HIGHLIGHT_COLOR: highlight.toUpperCase(),
      DARK_SHADOW_COLOR: darkShadow.toUpperCase(),
      ACCENT_COLOR: accent.toUpperCase(),
      // Convenient lowercase aliases
      primary: primary.toUpperCase(),
      shadow: shadow.toUpperCase(),
      highlight: highlight.toUpperCase(),
      dark_shadow: darkShadow.toUpperCase(),
      accent: accent.toUpperCase(),
      // Custom metadata & pass-through keys
      ...merged
    };
  }

  return normalizedPalette;
}

/**
 * Builds token substitution dictionary for a specific color entry
 */
export function buildTokenDictionary(colorId, colorData) {
  const dict = new Map();

  const setToken = (key, val) => {
    if (val !== undefined && val !== null) {
      dict.set(key.toUpperCase(), String(val));
    }
  };

  // 1. Color identifiers & names
  setToken("COLOR", colorId);
  setToken("COLOR_ID", colorId);
  setToken("DYE", colorId);
  setToken("DYE_ID", colorId);
  setToken("COLOR_NAME", colorData.name || colorId);
  setToken("COLOR_TITLE", colorData.name || colorId);

  // 2. Semantic Color Tokens & standard aliases
  const primary = colorData.PRIMARY_COLOR || colorData.primary;
  const shadow = colorData.SHADOW_COLOR || colorData.shadow;
  const highlight = colorData.HIGHLIGHT_COLOR || colorData.highlight;
  const darkShadow = colorData.DARK_SHADOW_COLOR || colorData.dark_shadow;
  const accent = colorData.ACCENT_COLOR || colorData.accent;

  setToken("PRIMARY_COLOR", primary);
  setToken("PRIMARY_COLOUR", primary);
  setToken("PRIMARY", primary);

  setToken("SHADOW_COLOR", shadow);
  setToken("SHADOW_COLOUR", shadow);
  setToken("SHADOW", shadow);

  setToken("HIGHLIGHT_COLOR", highlight);
  setToken("HIGHLIGHT_COLOUR", highlight);
  setToken("HIGHLIGHT", highlight);

  setToken("DARK_SHADOW_COLOR", darkShadow);
  setToken("DARK_SHADOW", darkShadow);
  setToken("DEEP_SHADOW", darkShadow);

  setToken("ACCENT_COLOR", accent);
  setToken("ACCENT", accent);

  // 3. Optional Opacity / Alpha tokens
  if (colorData.opacity !== undefined) {
    setToken("OPACITY", colorData.opacity);
    setToken("PRIMARY_OPACITY", colorData.opacity);
  }

  // 4. Custom pass-through tokens
  for (const [k, v] of Object.entries(colorData)) {
    if (typeof v === "string" || typeof v === "number") {
      setToken(k, v);
    }
  }

  return dict;
}

/**
 * Namespaces internal SVG `<defs>` and IDs to prevent collision when bundling multiple variations
 */
export function namespaceSvgIds(svgContent, colorId) {
  const idRegex = /\bid=["']([^"']+)["']/g;
  const foundIds = new Set();
  let match;
  while ((match = idRegex.exec(svgContent)) !== null) {
    const rawId = match[1];
    // Do not rename if ID already has a token like {{COLOR}}
    if (!rawId.includes("{{") && !rawId.startsWith(`${colorId}_`)) {
      foundIds.add(rawId);
    }
  }

  if (foundIds.size === 0) {
    return svgContent;
  }

  let transformed = svgContent;
  for (const id of foundIds) {
    const namespacedId = `${colorId}_${id}`;
    // Replace definition: id="foo" -> id="white_foo"
    transformed = transformed.replaceAll(`id="${id}"`, `id="${namespacedId}"`);
    transformed = transformed.replaceAll(`id='${id}'`, `id='${namespacedId}'`);
    // Replace URL refs: url(#foo) -> url(#white_foo)
    transformed = transformed.replaceAll(`url(#${id})`, `url(#${namespacedId})`);
    transformed = transformed.replaceAll(`url('#${id}')`, `url('#${namespacedId}')`);
    transformed = transformed.replaceAll(`url("#${id}")`, `url("#${namespacedId}")`);
    // Replace href/xlink:href: href="#foo" -> href="#white_foo"
    transformed = transformed.replaceAll(`href="#${id}"`, `href="#${namespacedId}"`);
    transformed = transformed.replaceAll(`xlink:href="#${id}"`, `xlink:href="#${namespacedId}"`);
  }

  return transformed;
}

/**
 * High-performance string token replacement engine
 * 
 * @param {string} svgContent - SVG template text
 * @param {Map<string, string>} tokenDict - Token lookup map
 * @param {object} [options={}] - Options (strict: boolean)
 * @returns {string} Injected SVG string
 */
export function injectTokens(svgContent, tokenDict, options = {}) {
  const { strict = true, colorId = "unknown" } = options;

  return svgContent.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/g, (fullMatch, token) => {
    const tokenKey = token.toUpperCase();
    if (tokenDict.has(tokenKey)) {
      return tokenDict.get(tokenKey);
    }
    if (strict) {
      throw new Error(`Unmapped semantic token "${fullMatch}" in template for color "${colorId}". Available tokens: ${Array.from(tokenDict.keys()).join(", ")}`);
    }
    return fullMatch;
  });
}

/**
 * Compiles a single color variation for an SVG template string
 * 
 * @param {string} svgTemplate - Master SVG template
 * @param {string} colorId - Color ID (e.g. "red", "light_blue")
 * @param {object} palette - Normalized palette map
 * @param {object} [options={}] - Options (strict, namespaceIds)
 * @returns {string} Injected SVG string
 */
export function compileVariation(svgTemplate, colorId, palette, options = {}) {
  const { strict = true, namespaceIds = true } = options;

  const colorData = palette[colorId];
  if (!colorData) {
    throw new Error(`Color ID "${colorId}" not found in active palette. Available colors: ${Object.keys(palette).join(", ")}`);
  }

  let content = svgTemplate;
  if (namespaceIds) {
    content = namespaceSvgIds(content, colorId);
  }

  const tokenDict = buildTokenDictionary(colorId, colorData);
  return injectTokens(content, tokenDict, { strict, colorId });
}

/**
 * Compiles all 16 Minecraft dye variations from a single master SVG template in-memory.
 * Returns in milliseconds (< 5ms typical).
 * 
 * @param {string} svgTemplate - Master SVG template
 * @param {object} palette - Normalized palette map
 * @param {object} [options={}] - Options
 * @returns {Array<{ id: string, name: string, filename: string, svg: string }>}
 */
export function compileAllVariations(svgTemplate, palette, options = {}) {
  const {
    namePattern = "{color}_{stem}.svg",
    stem = "block",
    dyes = MINECRAFT_DYES,
    strict = true,
    namespaceIds = true
  } = options;

  const results = [];

  for (const colorId of dyes) {
    const colorData = palette[colorId];
    if (!colorData) continue;

    const svg = compileVariation(svgTemplate, colorId, palette, { strict, namespaceIds });

    const filename = namePattern
      .replaceAll("{color}", colorId)
      .replaceAll("{dye}", colorId)
      .replaceAll("{stem}", stem)
      .replaceAll("{name}", stem);

    results.push({
      id: colorId,
      name: colorData.name || colorId,
      filename,
      svg
    });
  }

  return results;
}

/**
 * Reads template SVG file, compiles all 16 variations, and writes them to outputDir.
 * 
 * @param {string} templatePath - File path to master SVG template
 * @param {string} outputDir - Directory to write variations
 * @param {object} [options={}] - Configuration options
 * @returns {Promise<Array<{ id: string, filename: string, outPath: string, durationMs: number }>>}
 */
export async function injectPaletteToFile(templatePath, outputDir, options = {}) {
  const startTime = performance.now();
  const rawSvg = fs.readFileSync(path.resolve(templatePath), "utf-8");
  const stem = path.basename(templatePath).replace(/\.template\.svg$/, "").replace(/\.svg$/, "");

  const palette = typeof options.palette === "object" && options.palette !== null
    ? options.palette
    : loadPalette(options.palette || "trailer", options.override || null);

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const variations = compileAllVariations(rawSvg, palette, {
    stem,
    namePattern: options.namePattern || "{color}_{stem}.svg",
    strict: options.strict !== false,
    namespaceIds: options.namespaceIds !== false
  });

  const writtenFiles = [];

  for (const item of variations) {
    const outPath = path.join(outputDir, item.filename);
    fs.writeFileSync(outPath, item.svg, "utf-8");

    // Optional rasterization to PNG
    if (options.rasterize) {
      const size = options.size || 512;
      const pngPath = outPath.replace(/\.svg$/, ".png");
      const { Resvg } = await import("@resvg/resvg-js");
      const resvg = new Resvg(item.svg, {
        fitTo: { mode: "width", value: size }
      });
      fs.writeFileSync(pngPath, resvg.render().asPng());
    }

    writtenFiles.push({
      id: item.id,
      filename: item.filename,
      outPath
    });
  }

  const totalDurationMs = performance.now() - startTime;
  return {
    files: writtenFiles,
    count: writtenFiles.length,
    durationMs: totalDurationMs
  };
}

/**
 * Batch processes multiple SVG template files
 */
export async function batchProcessTemplates(templatePaths, outputDir, options = {}) {
  const results = [];
  const palette = typeof options.palette === "object" && options.palette !== null
    ? options.palette
    : loadPalette(options.palette || "trailer", options.override || null);

  for (const tPath of templatePaths) {
    const res = await injectPaletteToFile(tPath, outputDir, { ...options, palette });
    results.push({
      template: tPath,
      ...res
    });
  }
  return results;
}

// =========================================================================
// CLI Runner
// =========================================================================

function printHelp() {
  console.log(`
Keyframe SVG Palette-Injection Engine
Usage:
  node tools/lib/palette-injector.mjs <template.svg> [outputDir] [options]

Arguments:
  <template.svg>             Path to master SVG template
  [outputDir]                Output directory for variations (default: ./dist/variations)

Options:
  -p, --palette <name|file>  Palette name ("trailer", "vanilla") or JSON file path (default: trailer)
  --override <file|json>     Custom palette override JSON file or inline string
  -n, --name-pattern <pat>   Filename pattern, e.g. "{color}_{stem}.svg" (default: {color}_{stem}.svg)
  -r, --rasterize            Rasterize compiled SVGs to PNG
  -s, --size <res>           Rasterization resolution (default: 512)
  -w, --watch                Watch template file and auto-recompile on changes
  --ignore-missing           Permissive mode: do not throw error on unmapped tokens
  --no-namespace-ids         Disable automatic SVG ID namespacing
  -v, --verbose              Print detailed compilation timing
  -h, --help                 Show help
`);
}

async function runCli() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    printHelp();
    return;
  }

  let templatePath = null;
  let outputDir = "./dist/variations";
  let paletteName = "trailer";
  let override = null;
  let namePattern = "{color}_{stem}.svg";
  let rasterize = false;
  let size = 512;
  let watchMode = false;
  let strict = true;
  let namespaceIds = true;
  let verbose = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "-p" || arg === "--palette") {
      paletteName = args[++i];
    } else if (arg === "--override") {
      override = args[++i];
    } else if (arg === "-n" || arg === "--name-pattern") {
      namePattern = args[++i];
    } else if (arg === "-r" || arg === "--rasterize") {
      rasterize = true;
    } else if (arg === "-s" || arg === "--size" || arg === "--res") {
      size = parseInt(args[++i], 10) || 512;
    } else if (arg === "-w" || arg === "--watch") {
      watchMode = true;
    } else if (arg === "--ignore-missing") {
      strict = false;
    } else if (arg === "--no-namespace-ids") {
      namespaceIds = false;
    } else if (arg === "-v" || arg === "--verbose") {
      verbose = true;
    } else if (!templatePath && !arg.startsWith("-")) {
      templatePath = arg;
    } else if (!arg.startsWith("-")) {
      outputDir = arg;
    }
  }

  if (!templatePath) {
    console.error("Error: Please specify an SVG template file.");
    process.exit(1);
  }

  async function executeCompile() {
    try {
      const palette = loadPalette(paletteName, override);
      const res = await injectPaletteToFile(templatePath, outputDir, {
        palette,
        namePattern,
        rasterize,
        size,
        strict,
        namespaceIds
      });

      console.log(`✓ Compiled ${res.count} color variations into "${outputDir}" in ${res.durationMs.toFixed(2)}ms (Palette: ${paletteName})`);
      if (verbose) {
        for (const file of res.files) {
          console.log(`  - ${file.filename}`);
        }
      }
    } catch (err) {
      console.error(`Compilation failed: ${err.message}`);
      if (!watchMode) process.exit(1);
    }
  }

  await executeCompile();

  if (watchMode) {
    console.log(`\nWatching "${templatePath}" for changes... (Press Ctrl+C to stop)`);
    fs.watch(templatePath, async (eventType) => {
      if (eventType === "change") {
        console.log(`[Change detected] Recompiling variations...`);
        await executeCompile();
      }
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}

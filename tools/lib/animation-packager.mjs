import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";

/**
 * Built-in animation profiles for vanilla Minecraft and Keyframe cinematic aesthetic
 */
export const DEFAULT_ANIMATION_PRESETS = {
  water_still: { frametime: 2, interpolate: true },
  water_flow: { frametime: 1, interpolate: true },
  lava_still: { frametime: 3, interpolate: true },
  lava_flow: { frametime: 2, interpolate: true },
  fire_0: { frametime: 1, interpolate: false },
  fire_1: { frametime: 1, interpolate: false },
  soul_fire_0: { frametime: 1, interpolate: false },
  soul_fire_1: { frametime: 1, interpolate: false },
  prismarine: { frametime: 4, interpolate: true },
  prismarine_bricks: { frametime: 4, interpolate: true },
  dark_prismarine: { frametime: 4, interpolate: true },
  sea_lantern: { frametime: 5, interpolate: true },
  magma: { frametime: 4, interpolate: true },
  portal: { frametime: 2, interpolate: false },
  respawn_anchor: { frametime: 2, interpolate: true },
  respawn_anchor_top: { frametime: 2, interpolate: true },
  campfire_fire: { frametime: 1, interpolate: false },
  campfire_log_lit: { frametime: 1, interpolate: false },
  soul_campfire_fire: { frametime: 1, interpolate: false },
  soul_campfire_log_lit: { frametime: 1, interpolate: false },
  lantern: { frametime: 2, interpolate: true },
  soul_lantern: { frametime: 2, interpolate: true },
  kelp: { frametime: 2, interpolate: true },
  kelp_plant: { frametime: 2, interpolate: true },
  seagrass: { frametime: 2, interpolate: true },
  tall_seagrass_top: { frametime: 2, interpolate: true },
  tall_seagrass_bottom: { frametime: 2, interpolate: true }
};

const CATEGORY_DIR_NAMES = new Set([
  "block",
  "blocks",
  "item",
  "items",
  "gui",
  "entity",
  "entities",
  "model",
  "models",
  "font",
  "environment",
  "painting",
  "particle",
  "effect"
]);

/**
 * Sorts frame filenames naturally by numeric order (e.g. 0, 1, 2... 10 instead of 0, 1, 10, 2)
 */
export function naturalSortFrames(filenames) {
  return [...filenames].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" })
  );
}

/**
 * Checks if a collection of filenames looks like an animation frame sequence (e.g., 0.svg, 1.svg, frame_0.svg)
 */
function isFrameSequence(filenames) {
  if (!filenames || filenames.length === 0) return false;
  let numericFrames = 0;
  for (const f of filenames) {
    const base = path.basename(f, ".svg").toLowerCase();
    if (/^(\d+|frame_?\d+|f_?\d+)$/.test(base)) {
      numericFrames++;
    }
  }
  return numericFrames >= filenames.length / 2;
}

/**
 * Sanitizes XML declarations/DOCTYPES and namespaces IDs/references to prevent <defs> collisions across frames
 */
export function sanitizeAndNamespaceSvg(svgText, frameIndex = 0) {
  // Strip XML prolog and DOCTYPE declarations
  let clean = svgText
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .trim();

  // Extract viewBox if present
  let viewBox = "0 0 512 512";
  const viewBoxMatch = clean.match(/viewBox=["']([^"']+)["']/i);
  if (viewBoxMatch) {
    viewBox = viewBoxMatch[1].trim();
  }

  // Extract width and height if present
  let frameWidth = 512;
  let frameHeight = 512;
  const vbParts = viewBox.split(/[\s,]+/).map(Number);
  if (vbParts.length === 4 && !isNaN(vbParts[2]) && !isNaN(vbParts[3])) {
    frameWidth = vbParts[2];
    frameHeight = vbParts[3];
  }

  // Extract inner SVG content (strip outer <svg...> and </svg>)
  const svgOpenTagMatch = clean.match(/^<svg[^>]*>([\s\S]*)<\/svg>$/i);
  let innerContent = clean;
  if (svgOpenTagMatch) {
    innerContent = svgOpenTagMatch[1];
  }

  // Scope IDs to prevent collision across frames (e.g. id="grad1" -> id="f0_grad1")
  const prefix = "f" + frameIndex + "_";
  
  // Replace id="..."
  innerContent = innerContent.replace(/\bid=(["'])([^"']+)\1/g, (match, quote, id) => {
    return "id=" + quote + prefix + id + quote;
  });

  // Replace url(#...)
  innerContent = innerContent.replace(/url\((['"]?)#([^)'"]+)\1\)/g, (match, quote, id) => {
    return "url(" + quote + "#" + prefix + id + quote + ")";
  });

  // Replace href="#..." and xlink:href="#..."
  innerContent = innerContent.replace(/\b(href|xlink:href)=(["'])#([^"']+)\2/g, (match, attr, quote, id) => {
    return attr + "=" + quote + "#" + prefix + id + quote;
  });

  return {
    innerContent,
    viewBox,
    width: frameWidth,
    height: frameHeight
  };
}

/**
 * Combines multiple SVG frames into a single vertical composite SVG document
 */
export function assembleCompositeSvgStrip(svgFrames, options = {}) {
  if (!Array.isArray(svgFrames) || svgFrames.length === 0) {
    throw new Error("assembleCompositeSvgStrip requires a non-empty array of SVG frame strings or paths.");
  }

  const frameTexts = svgFrames.map((frame) => {
    if (typeof frame === "string" && (frame.endsWith(".svg") || fs.existsSync(frame))) {
      return fs.readFileSync(frame, "utf-8");
    }
    return String(frame);
  });

  const parsedFrames = frameTexts.map((text, idx) => sanitizeAndNamespaceSvg(text, idx));
  
  const frameWidth = options.frameWidth || parsedFrames[0].width || 512;
  const frameHeight = options.frameHeight || parsedFrames[0].height || 512;
  const frameCount = parsedFrames.length;
  const totalHeight = frameHeight * frameCount;

  const framesXml = parsedFrames.map((frame, idx) => {
    const yOffset = idx * frameHeight;
    return "  <svg x=\"0\" y=\"" + yOffset + "\" width=\"" + frameWidth + "\" height=\"" + frameHeight + "\" viewBox=\"" + frame.viewBox + "\">\n" + frame.innerContent + "\n  </svg>";
  }).join("\n");

  return "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"" + frameWidth + "\" height=\"" + totalHeight + "\" viewBox=\"0 0 " + frameWidth + " " + totalHeight + "\">\n" + framesXml + "\n</svg>";
}

/**
 * Compiles an animation frame sequence into a vertical PNG strip
 */
export function compileAnimationStrip(frameSources, destPngPath, targetRes = 512, options = {}) {
  const compositeSvg = assembleCompositeSvgStrip(frameSources, options);
  
  const resvg = new Resvg(compositeSvg, {
    fitTo: {
      mode: "width",
      value: targetRes
    }
  });

  const pngData = resvg.render();
  const pngBuffer = pngData.asPng();

  const destDir = path.dirname(destPngPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  fs.writeFileSync(destPngPath, pngBuffer);

  return {
    destPngPath,
    width: pngData.width,
    height: pngData.height,
    frameCount: frameSources.length,
    bytes: pngBuffer.length
  };
}

/**
 * Discovers companion .mcmeta files following the resolution ladder
 */
export function findCompanionMcmeta(texturePathOrStem, texturesDir = null) {
  let stem = texturePathOrStem;
  let basePath = null;

  if (texturesDir && fs.existsSync(texturesDir)) {
    basePath = texturesDir;
  }

  if (typeof texturePathOrStem === "string") {
    if (fs.existsSync(texturePathOrStem)) {
      const stats = fs.statSync(texturePathOrStem);
      if (stats.isDirectory()) {
        const dirName = path.basename(texturePathOrStem);
        stem = dirName;
        basePath = path.dirname(texturePathOrStem);

        // Check in-directory metadata files
        const inDirMcmeta1 = path.join(texturePathOrStem, stem + ".png.mcmeta");
        const inDirMcmeta2 = path.join(texturePathOrStem, stem + ".svg.mcmeta");
        const inDirMcmeta3 = path.join(texturePathOrStem, "animation.json");
        const inDirMcmeta4 = path.join(texturePathOrStem, "pack.mcmeta");

        if (fs.existsSync(inDirMcmeta1)) return loadMcmetaFile(inDirMcmeta1, stem);
        if (fs.existsSync(inDirMcmeta2)) return loadMcmetaFile(inDirMcmeta2, stem);
        if (fs.existsSync(inDirMcmeta3)) return loadMcmetaFile(inDirMcmeta3, stem);
        if (fs.existsSync(inDirMcmeta4)) return loadMcmetaFile(inDirMcmeta4, stem);
      } else {
        stem = path.basename(texturePathOrStem).replace(/\.(svg|png|mcmeta)$/i, "").replace(/\.svg$/i, "").replace(/\.png$/i, "");
        basePath = path.dirname(texturePathOrStem);
      }
    } else {
      stem = path.basename(texturePathOrStem).replace(/\.(svg|png|mcmeta)$/i, "").replace(/\.svg$/i, "").replace(/\.png$/i, "");
    }
  }

  if (basePath) {
    const candidate1 = path.join(basePath, stem + ".svg.mcmeta");
    const candidate2 = path.join(basePath, stem + ".png.mcmeta");
    const candidate3 = path.join(basePath, stem + ".mcmeta");

    if (fs.existsSync(candidate1)) return loadMcmetaFile(candidate1, stem);
    if (fs.existsSync(candidate2)) return loadMcmetaFile(candidate2, stem);
    if (fs.existsSync(candidate3)) return loadMcmetaFile(candidate3, stem);
  }

  // Preset fallback
  if (DEFAULT_ANIMATION_PRESETS[stem]) {
    return {
      found: true,
      sourcePath: null,
      isPreset: true,
      metadata: {
        animation: { ...DEFAULT_ANIMATION_PRESETS[stem] }
      }
    };
  }

  return {
    found: false,
    sourcePath: null,
    metadata: null
  };
}

/**
 * Helper to safely load and parse .mcmeta file with descriptive errors
 */
function loadMcmetaFile(filePath, stem) {
  try {
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) {
      // Empty file -> fallback to preset or empty animation
      const preset = DEFAULT_ANIMATION_PRESETS[stem] || {};
      return {
        found: true,
        sourcePath: filePath,
        metadata: { animation: { ...preset } }
      };
    }
    const parsed = JSON.parse(raw);
    const normalized = normalizeAnimationMetadata(parsed, stem);
    return {
      found: true,
      sourcePath: filePath,
      metadata: normalized
    };
  } catch (err) {
    throw new Error("Failed to parse .mcmeta JSON at " + filePath + ": " + err.message);
  }
}

/**
 * Normalizes metadata structure so it always contains a clean valid { animation: { ... } }
 */
export function normalizeAnimationMetadata(input, stem = null) {
  if (!input || typeof input !== "object") {
    const preset = stem && DEFAULT_ANIMATION_PRESETS[stem] ? DEFAULT_ANIMATION_PRESETS[stem] : {};
    return { animation: { ...preset } };
  }

  let animation = {};

  if (input.animation && typeof input.animation === "object") {
    animation = { ...input.animation };
  } else {
    // Top-level properties (e.g. { frametime: 2, interpolate: true })
    if (input.frametime !== undefined) animation.frametime = input.frametime;
    if (input.interpolate !== undefined) animation.interpolate = input.interpolate;
    if (input.frames !== undefined) animation.frames = input.frames;
    if (input.width !== undefined) animation.width = input.width;
    if (input.height !== undefined) animation.height = input.height;
  }

  // If preset exists, merge missing default values
  if (stem && DEFAULT_ANIMATION_PRESETS[stem]) {
    const preset = DEFAULT_ANIMATION_PRESETS[stem];
    if (animation.frametime === undefined && preset.frametime !== undefined) {
      animation.frametime = preset.frametime;
    }
    if (animation.interpolate === undefined && preset.interpolate !== undefined) {
      animation.interpolate = preset.interpolate;
    }
  }

  return { animation };
}

/**
 * Generates formatted Minecraft-compliant .png.mcmeta JSON string
 */
export function generateMcmeta(options = {}, stem = null) {
  let baseMetadata = {};

  if (options.metadata) {
    baseMetadata = normalizeAnimationMetadata(options.metadata, stem);
  } else {
    baseMetadata = normalizeAnimationMetadata(options, stem);
  }

  // CLI / explicit overrides
  const frametimeOverride = options.overrideFrametime !== undefined ? options.overrideFrametime : options.frametime;
  const interpolateOverride = options.overrideInterpolate !== undefined ? options.overrideInterpolate : options.interpolate;

  if (frametimeOverride !== undefined && frametimeOverride !== null) {
    baseMetadata.animation.frametime = parseInt(frametimeOverride, 10);
  }
  if (interpolateOverride !== undefined && interpolateOverride !== null) {
    baseMetadata.animation.interpolate = Boolean(interpolateOverride);
  }

  return JSON.stringify(baseMetadata, null, 2) + "\n";
}

/**
 * Discovers, compiles, and packages all animated textures in a workspace
 */
export function processAnimatedTextures(texturesDir, targetDirs, targetRes = 512, options = {}) {
  if (!fs.existsSync(texturesDir)) {
    return [];
  }

  const { blocksDir, itemsDir } = targetDirs;
  const ITEM_IDS = options.itemIds || new Set(["cooked_beef", "golden_apple", "compass_nexus", "plot_compass", "spiral_core", "ninja6_token"]);
  const results = [];

  function scanDirectory(dir, defaultIsItem = false) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const stem = entry.name;
        const isCategory = CATEGORY_DIR_NAMES.has(stem.toLowerCase());

        if (!isCategory) {
          // Check if this directory is an animation folder
          const frameFiles = fs.readdirSync(fullPath)
            .filter((f) => f.endsWith(".svg"))
            .map((f) => path.join(fullPath, f));

          const hasMcmeta = fs.existsSync(path.join(fullPath, stem + ".png.mcmeta")) ||
                            fs.existsSync(path.join(fullPath, stem + ".svg.mcmeta")) ||
                            fs.existsSync(path.join(fullPath, "animation.json")) ||
                            Boolean(DEFAULT_ANIMATION_PRESETS[stem]);

          if (frameFiles.length > 0 && (hasMcmeta || isFrameSequence(frameFiles))) {
            const sortedFrames = naturalSortFrames(frameFiles);
            const isItem = defaultIsItem || ITEM_IDS.has(stem) || fullPath.includes(path.sep + "item" + path.sep) || fullPath.includes("/item/");
            const targetDir = isItem ? itemsDir : blocksDir;
            const destPng = path.join(targetDir, stem + ".png");
            const destMcmeta = path.join(targetDir, stem + ".png.mcmeta");

            // Compile PNG vertical strip
            const animResult = compileAnimationStrip(sortedFrames, destPng, targetRes, options);

            // Find or generate companion .mcmeta
            const mcmetaInfo = findCompanionMcmeta(fullPath, dir);
            const mcmetaContent = generateMcmeta({
              metadata: mcmetaInfo.metadata || (DEFAULT_ANIMATION_PRESETS[stem] ? { animation: DEFAULT_ANIMATION_PRESETS[stem] } : { animation: {} }),
              overrideFrametime: options.overrideFrametime || options.frametime,
              overrideInterpolate: options.overrideInterpolate !== undefined ? options.overrideInterpolate : options.interpolate
            }, stem);

            fs.writeFileSync(destMcmeta, mcmetaContent, "utf-8");

            results.push({
              stem,
              isItem,
              frameCount: sortedFrames.length,
              destPng,
              destMcmeta,
              res: targetRes,
              dimensions: animResult.width + "x" + animResult.height
            });
            continue;
          }
        }

        // Recurse into subdirectories (e.g. textures/block or textures/item)
        const isItemDir = stem === "item" || stem === "items";
        scanDirectory(fullPath, isItemDir);
      }
    }
  }

  scanDirectory(texturesDir);
  return results;
}

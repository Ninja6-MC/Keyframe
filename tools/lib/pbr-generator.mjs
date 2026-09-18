import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_RULES_PATH = path.join(__dirname, "pbr-rules.json");
const TILING_RULES_PATH = path.join(__dirname, "..", "tiling-rules.json");

export const DEFAULT_FALLBACK_RULES = {
  version: "1.0.0",
  defaultMaterial: {
    baseHeight: 215,
    smoothness: 35,
    f0: 10,
    porosity: 5,
    emission: 0,
    ao: 255,
    normalStrength: 1.0
  },
  materials: {},
  patterns: []
};

// --------------------------------------------------------------------------
// Standard IEEE 802.3 CRC32 Implementation
// --------------------------------------------------------------------------

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC_TABLE[n] = c >>> 0;
}

/**
 * Computes standard IEEE 802.3 CRC32 checksum for buffer slice.
 */
export function crc32(buf, start = 0, end = buf.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

// --------------------------------------------------------------------------
// Pure Node.js PNG Encoding Engine (Zero External Dependencies)
// --------------------------------------------------------------------------

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

function makeChunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcPayload = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcPayload), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

/**
 * Serializes raw RGBA pixel buffer into valid PNG byte buffer.
 * Uses deflateSync level 9 and standard IEEE 802.3 CRC32 chunk framing.
 * Omits sRGB and gAMA chunks for clean linear data storage.
 */
export function encodePng(width, height, rgbaBuffer) {
  if (rgbaBuffer.length < width * height * 4) {
    throw new Error(
      `Invalid buffer length ${rgbaBuffer.length}: expected at least ${width * height * 4} bytes for ${width}x${height} RGBA`
    );
  }

  const rowStride = width * 4;
  const scanlineStride = 1 + rowStride;
  const scanlines = Buffer.alloc(height * scanlineStride);

  for (let y = 0; y < height; y++) {
    scanlines[y * scanlineStride] = 0; // Filter 0 (None)
    rgbaBuffer.copy(scanlines, y * scanlineStride + 1, y * rowStride, (y + 1) * rowStride);
  }

  const compressed = zlib.deflateSync(scanlines, { level: 9 });

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // Bit depth: 8 bits per channel
  ihdrData[9] = 6; // Color type: 6 (RGBA)
  ihdrData[10] = 0; // Compression method: deflate
  ihdrData[11] = 0; // Filter method: standard adaptive
  ihdrData[12] = 0; // Interlace method: none

  const ihdrChunk = makeChunk("IHDR", ihdrData);
  const idatChunk = makeChunk("IDAT", compressed);
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([PNG_SIGNATURE, ihdrChunk, idatChunk, iendChunk]);
}

// --------------------------------------------------------------------------
// Pattern Matching & Tiling Helpers
// --------------------------------------------------------------------------

const GLOB_METACHARS = /[.+^${}()|[\]\\]/g;
const globRegexCache = new Map();

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

export function matchGlob(name, pattern) {
  return globToRegExp(pattern).test(name);
}

let cachedTilingRules = null;

export function loadTilingRules(tilingPath = TILING_RULES_PATH) {
  if (cachedTilingRules) return cachedTilingRules;
  if (fs.existsSync(tilingPath)) {
    try {
      cachedTilingRules = JSON.parse(fs.readFileSync(tilingPath, "utf-8"));
      return cachedTilingRules;
    } catch {
      // Fall through to default
    }
  }
  return { defaultCategory: "toroidal", categories: {}, patterns: [] };
}

export function resolveTilingCategory(stem, tilingRules) {
  const base = path.basename(String(stem).replace(/\\/g, "/"));
  const nameWithExt = base.endsWith(".svg") ? base : base + ".svg";
  const stemWithoutExt = base.replace(/\.(svg|png)$/i, "");

  if (tilingRules?.overrides?.[nameWithExt]) {
    return tilingRules.overrides[nameWithExt].category;
  }
  if (tilingRules?.overrides?.[stemWithoutExt]) {
    return tilingRules.overrides[stemWithoutExt].category;
  }
  if (tilingRules?.itemIds && tilingRules.itemIds.includes(stemWithoutExt)) {
    return "exempt";
  }
  if (tilingRules?.patterns) {
    for (const p of tilingRules.patterns) {
      if (matchGlob(nameWithExt, p.pattern) || matchGlob(stemWithoutExt, p.pattern)) {
        return p.category;
      }
    }
  }
  return tilingRules?.defaultCategory || "toroidal";
}

// --------------------------------------------------------------------------
// Material Rules Resolution & Color Matching
// --------------------------------------------------------------------------

export function hexToRgb(hex) {
  const clean = hex.replace(/^#/, "");
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}

let cachedRules = null;
let cachedRulesPath = null;

export function loadPbrRules(rulesPath = DEFAULT_RULES_PATH) {
  if (cachedRules && cachedRulesPath === rulesPath) {
    return cachedRules;
  }
  if (fs.existsSync(rulesPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(rulesPath, "utf-8"));
      cachedRules = parsed;
      cachedRulesPath = rulesPath;
      return parsed;
    } catch (err) {
      console.warn(`[WARN] Failed to parse ${rulesPath}: ${err.message}. Using defaults.`);
    }
  }
  return DEFAULT_FALLBACK_RULES;
}

export function resolveMaterial(stem, rules = null) {
  const activeRules = rules || loadPbrRules();
  const defaultMat = activeRules.defaultMaterial || DEFAULT_FALLBACK_RULES.defaultMaterial;
  const baseStem = path.basename(String(stem).replace(/\\/g, "/")).replace(/\.(svg|png)$/i, "");

  let rawMat = null;

  // 1. Exact match on stem
  if (activeRules.materials && activeRules.materials[baseStem]) {
    rawMat = activeRules.materials[baseStem];
  } else if (activeRules.patterns && Array.isArray(activeRules.patterns)) {
    // 2. Pattern match in declaration order
    for (const entry of activeRules.patterns) {
      if (entry.pattern && matchGlob(baseStem, entry.pattern)) {
        const targetMat = activeRules.materials?.[entry.material];
        if (targetMat) {
          rawMat = targetMat;
          break;
        }
      }
    }
  }

  if (!rawMat) {
    rawMat = defaultMat;
  }

  const resolved = { ...defaultMat, ...rawMat };

  // Pre-parse colorFeatures hex to RGB
  if (resolved.colorFeatures && Array.isArray(resolved.colorFeatures)) {
    resolved.parsedFeatures = resolved.colorFeatures.map((f) => ({
      ...f,
      rgb: hexToRgb(f.hex)
    }));
  } else {
    resolved.parsedFeatures = [];
  }

  return resolved;
}

function evaluatePixel(r, g, b, a, material, options = {}) {
  if (a === 0) {
    return {
      height: 1,
      ao: 255,
      smoothness: 0,
      f0: 0,
      porosity: 0,
      emission: 0
    };
  }

  const features = material.parsedFeatures || [];
  let bestFeat = null;
  let bestDist = Infinity;

  for (let i = 0; i < features.length; i++) {
    const f = features[i];
    const dist = Math.hypot(r - f.rgb.r, g - f.rgb.g, b - f.rgb.b);
    if (dist < bestDist) {
      bestDist = dist;
      bestFeat = f;
    }
  }

  const tolerance = typeof options.colorTolerance === "number" ? options.colorTolerance : 64;

  if (bestFeat && bestDist <= tolerance) {
    return {
      height: bestFeat.height ?? material.baseHeight ?? 215,
      ao: bestFeat.ao ?? material.ao ?? 255,
      smoothness: bestFeat.smoothness ?? material.smoothness ?? 35,
      f0: bestFeat.f0 ?? material.f0 ?? 10,
      porosity: bestFeat.porosity ?? material.porosity ?? 5,
      emission: bestFeat.emission ?? material.emission ?? 0
    };
  }

  // Fallback to luminance
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  let height;

  if (options.useLuminance) {
    height = Math.max(1, Math.min(255, Math.round(lum)));
  } else if (features.length === 0) {
    // Material without explicit colorFeatures (e.g. coarse_dirt, sand, gravel)
    height = Math.max(1, Math.min(255, Math.round((material.baseHeight ?? 215) + (lum - 128) * 0.25)));
  } else {
    height = material.baseHeight ?? 215;
  }

  return {
    height,
    ao: material.ao ?? 255,
    smoothness: material.smoothness ?? 35,
    f0: material.f0 ?? 10,
    porosity: material.porosity ?? 5,
    emission: material.emission ?? 0
  };
}

// --------------------------------------------------------------------------
// LabPBR 1.3 Normal Map Generator (_n.png)
// --------------------------------------------------------------------------

/**
 * Generates LabPBR 1.3 Normal Map (_n) tangent space buffer with DirectX Y- encoding.
 * - Red (R): Normal X (0 = left, 128 = flat, 255 = right)
 * - Green (G): Normal Y in DirectX top-down format (0 = up, 128 = flat, 255 = down)
 * - Blue (B): Linear Material AO (0 = occluded, 255 = open)
 * - Alpha (A): Linear POM Displacement Depth (clamped to [1, 255])
 */
export function generateNormalMap(stem, pixels, width, height, options = {}) {
  const rules = options.rules || loadPbrRules(options.rulesPath);
  const material = resolveMaterial(stem, rules);
  const tilingRules = options.tilingRules || loadTilingRules();
  const tilingCategory = options.tilingCategory || resolveTilingCategory(stem, tilingRules);

  const heightGrid = new Float32Array(width * height);
  const aoGrid = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];

      const props = evaluatePixel(r, g, b, a, material, options);
      heightGrid[y * width + x] = props.height;
      aoGrid[y * width + x] = props.ao;
    }
  }

  function sampleHeight(x, y) {
    let sx = x;
    let sy = y;
    if (tilingCategory === "toroidal") {
      sx = (x % width + width) % width;
      sy = (y % height + height) % height;
    } else if (tilingCategory === "x-only") {
      sx = (x % width + width) % width;
      sy = Math.max(0, Math.min(height - 1, y));
    } else if (tilingCategory === "y-only") {
      sx = Math.max(0, Math.min(width - 1, x));
      sy = (y % height + height) % height;
    } else {
      sx = Math.max(0, Math.min(width - 1, x));
      sy = Math.max(0, Math.min(height - 1, y));
    }
    return heightGrid[sy * width + sx];
  }

  const normalStrength = options.normalStrength ?? material.normalStrength ?? 1.0;
  const normalPixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;

      const h_tl = sampleHeight(x - 1, y - 1);
      const h_t  = sampleHeight(x,     y - 1);
      const h_tr = sampleHeight(x + 1, y - 1);
      const h_l  = sampleHeight(x - 1, y);
      const h_r  = sampleHeight(x + 1, y);
      const h_bl = sampleHeight(x - 1, y + 1);
      const h_b  = sampleHeight(x,     y + 1);
      const h_br = sampleHeight(x + 1, y + 1);

      // Standard 3x3 Sobel filter
      const dx = ((h_tr + 2 * h_r + h_br) - (h_tl + 2 * h_l + h_bl)) / (8 * 255);
      const dy = ((h_bl + 2 * h_b + h_br) - (h_tl + 2 * h_t + h_tr)) / (8 * 255);

      // Tangent space normal vector:
      // dx > 0 means height rises to the right -> surface faces left -> Nx < 0 -> Red < 128 (0 = left)
      // dy > 0 means height rises downwards -> surface faces up -> Ny < 0 -> Green < 128 (0 = up in DirectX Y-)
      const vx = -dx * normalStrength;
      const vy = -dy * normalStrength;
      const vz = 1.0;
      const len = Math.hypot(vx, vy, vz);

      const Nx = vx / len;
      const Ny = vy / len;

      const rOut = Math.max(0, Math.min(255, Math.round((Nx * 0.5 + 0.5) * 255)));
      const gOut = Math.max(0, Math.min(255, Math.round((Ny * 0.5 + 0.5) * 255)));
      const bOut = Math.max(0, Math.min(255, aoGrid[y * width + x]));
      const aOut = Math.max(1, Math.min(255, Math.round(heightGrid[y * width + x])));

      normalPixels[idx] = rOut;
      normalPixels[idx + 1] = gOut;
      normalPixels[idx + 2] = bOut;
      normalPixels[idx + 3] = aOut;
    }
  }

  // Lazy PNG encoder attachment
  let cachedNormalPng = null;
  Object.defineProperty(normalPixels, "png", {
    get() {
      if (!cachedNormalPng) cachedNormalPng = encodePng(width, height, normalPixels);
      return cachedNormalPng;
    },
    set(val) {
      cachedNormalPng = val;
    },
    configurable: true
  });

  if (options.encode === true) {
    const pngBuf = encodePng(width, height, normalPixels);
    pngBuf.pixels = normalPixels;
    return pngBuf;
  }

  return normalPixels;
}

// --------------------------------------------------------------------------
// LabPBR 1.3 Specular Map Generator (_s.png)
// --------------------------------------------------------------------------

/**
 * Generates LabPBR 1.3 Specular Map (_s) buffer.
 * - Red (R): Perceptual Smoothness (0 = rough matte, 255 = mirror)
 * - Green (G): Reflectance / Linear F0 (0..229 = dielectric, 230..255 = metals)
 * - Blue (B): Porosity (0..64) / SSS (65..255)
 * - Alpha (A): Linear Emission (0..254, 255 reserved)
 */
export function generateSpecularMap(stem, pixels, width, height, options = {}) {
  const rules = options.rules || loadPbrRules(options.rulesPath);
  const material = resolveMaterial(stem, rules);
  const specularPixels = Buffer.alloc(width * height * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const a = pixels[idx + 3];

      const props = evaluatePixel(r, g, b, a, material, options);

      const rOut = Math.max(0, Math.min(255, Math.round(props.smoothness)));
      const gOut = Math.max(0, Math.min(255, Math.round(props.f0)));
      const bOut = Math.max(0, Math.min(255, Math.round(props.porosity)));
      const aOut = Math.max(0, Math.min(254, Math.round(props.emission)));

      specularPixels[idx] = rOut;
      specularPixels[idx + 1] = gOut;
      specularPixels[idx + 2] = bOut;
      specularPixels[idx + 3] = aOut;
    }
  }

  let cachedSpecPng = null;
  Object.defineProperty(specularPixels, "png", {
    get() {
      if (!cachedSpecPng) cachedSpecPng = encodePng(width, height, specularPixels);
      return cachedSpecPng;
    },
    set(val) {
      cachedSpecPng = val;
    },
    configurable: true
  });

  if (options.encode === true) {
    const pngBuf = encodePng(width, height, specularPixels);
    pngBuf.pixels = specularPixels;
    return pngBuf;
  }

  return specularPixels;
}

// --------------------------------------------------------------------------
// Unified PBR Companion Map Generator
// --------------------------------------------------------------------------

/**
 * Generates companion LabPBR 1.3 normal and specular maps for a texture.
 * Returns { normalMap, specularMap, normalPixels, specularPixels }.
 * normalMap and specularMap are ready-to-write PNG Buffers.
 */
export function generatePbrMaps(stem, pixels, width, height, options = {}) {
  const normalPixels = generateNormalMap(stem, pixels, width, height, { ...options, encode: false });
  const specularPixels = generateSpecularMap(stem, pixels, width, height, { ...options, encode: false });

  const normalPng = encodePng(width, height, normalPixels);
  const specularPng = encodePng(width, height, specularPixels);

  normalPng.pixels = normalPixels;
  specularPng.pixels = specularPixels;

  normalPixels.png = normalPng;
  specularPixels.png = specularPng;

  return {
    normalMap: normalPng,
    specularMap: specularPng,
    normalPixels,
    specularPixels
  };
}

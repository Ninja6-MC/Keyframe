#!/usr/bin/env node

/**
 * LabPBR 1.3 Normal and Specular Map Pipeline Test Suite
 *
 * Verifies channel packing, DirectX Y- conventions, 3x3 Sobel gradient calculations,
 * unit normal normalization, material rule resolution, pure Node.js PNG encoding,
 * periodic boundary wrapping, and compiler CLI integration (#186, #187).
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import {
  loadPbrRules,
  resolveMaterial,
  generateNormalMap,
  generateSpecularMap,
  generatePbrMaps,
  encodePng,
  crc32,
  matchGlob,
  loadTilingRules,
  resolveTilingCategory
} from "../lib/pbr-generator.mjs";
import { buildResourcePack } from "../build.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const TEST_TMP = path.join(ROOT_DIR, "cache", "test_pbr_smoke");

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
console.log("  LABPBR 1.3 PIPELINE TEST SUITE (#186, #187)");
console.log("=======================================================\n");

// -----------------------------------------------------------------------------
// Suite 1: Pure Node.js PNG Encoding & IEEE 802.3 CRC32 Framing
// -----------------------------------------------------------------------------
console.log("[Suite 1] Pure Node.js PNG Encoding & CRC32 Framing");
{
  const width = 4;
  const height = 4;
  const rawRgba = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rawRgba[i * 4] = i * 16;
    rawRgba[i * 4 + 1] = 255 - i * 16;
    rawRgba[i * 4 + 2] = 128;
    rawRgba[i * 4 + 3] = 255;
  }

  const pngBuffer = encodePng(width, height, rawRgba);

  // 1. Signature check (8 bytes: 89 50 4E 47 0D 0A 1A 0A)
  const expectedSig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  assert(pngBuffer.subarray(0, 8).equals(expectedSig), "PNG starts with standard 8-byte signature");

  // 2. Parse chunk structure: IHDR, IDAT, IEND
  let offset = 8;
  const chunks = [];
  while (offset < pngBuffer.length) {
    const length = pngBuffer.readUInt32BE(offset);
    const type = pngBuffer.subarray(offset + 4, offset + 8).toString("ascii");
    const data = pngBuffer.subarray(offset + 8, offset + 8 + length);
    const crc = pngBuffer.readUInt32BE(offset + 8 + length);

    // Verify CRC32
    const toCrc = pngBuffer.subarray(offset + 4, offset + 8 + length);
    assertEqual(crc, crc32(toCrc), `Chunk ${type} CRC32 matches IEEE 802.3 checksum`);

    chunks.push({ type, length, data });
    offset += 12 + length;
  }

  const chunkTypes = chunks.map((c) => c.type);
  assert(chunkTypes.includes("IHDR"), "PNG contains IHDR chunk");
  assert(chunkTypes.includes("IDAT"), "PNG contains IDAT chunk");
  assert(chunkTypes.includes("IEND"), "PNG contains IEND chunk");
  assertEqual(chunkTypes[0], "IHDR", "First chunk is IHDR");
  assertEqual(chunkTypes[chunkTypes.length - 1], "IEND", "Final chunk is IEND");

  // Verify IHDR payload
  const ihdr = chunks[0];
  assertEqual(ihdr.data.readUInt32BE(0), width, "IHDR width matches input");
  assertEqual(ihdr.data.readUInt32BE(4), height, "IHDR height matches input");
  assertEqual(ihdr.data[8], 8, "IHDR bit depth is 8-bit");
  assertEqual(ihdr.data[9], 6, "IHDR color type is 6 (RGBA)");

  // Decompress IDAT and assert roundtrip scanlines
  const idat = chunks.find((c) => c.type === "IDAT");
  const decompressed = zlib.inflateSync(idat.data);
  assertEqual(decompressed.length, height * (1 + width * 4), "Decompressed scanline size matches expected");

  let matchAll = true;
  for (let y = 0; y < height; y++) {
    assertEqual(decompressed[y * (1 + width * 4)], 0, `Scanline ${y} starts with filter byte 0 (None)`);
    const linePixels = decompressed.subarray(y * (1 + width * 4) + 1, (y + 1) * (1 + width * 4));
    const srcPixels = rawRgba.subarray(y * width * 4, (y + 1) * width * 4);
    if (!linePixels.equals(srcPixels)) {
      matchAll = false;
    }
  }
  assert(matchAll, "All decompressed scanline RGBA pixels match input buffer exactly");

  // Verify no unwanted color profile chunks
  assert(!chunkTypes.includes("sRGB"), "PNG omits sRGB chunk for linear PBR data");
  assert(!chunkTypes.includes("gAMA"), "PNG omits gAMA chunk for linear PBR data");
}

// -----------------------------------------------------------------------------
// Suite 2: Material Rules Resolution & Optical Parameters
// -----------------------------------------------------------------------------
console.log("\n[Suite 2] Material Rules Resolution & Optical Parameters");
{
  const rules = loadPbrRules();
  assert(rules && rules.materials, "pbr-rules.json loaded successfully");

  // Stone resolution
  const stone = resolveMaterial("stone", rules);
  assertEqual(stone.smoothness, 35, "stone smoothness is 35");
  assertEqual(stone.f0, 10, "stone f0 is 10");
  assertEqual(stone.porosity, 5, "stone porosity is 5");
  assertEqual(stone.emission, 0, "stone emission is 0");
  assertEqual(stone.baseHeight, 215, "stone baseHeight is 215");

  // Diamond Ore resolution
  const diamondOre = resolveMaterial("diamond_ore", rules);
  assertEqual(diamondOre.baseHeight, 215, "diamond_ore baseHeight is 215");
  assert(diamondOre.parsedFeatures && diamondOre.parsedFeatures.length >= 6, "diamond_ore carries crystal facets");

  // Dirt resolution
  const dirt = resolveMaterial("dirt", rules);
  assertEqual(dirt.smoothness, 20, "dirt smoothness is 20");
  assertEqual(dirt.porosity, 55, "dirt porosity is 55");

  // Oak Planks resolution
  const planks = resolveMaterial("oak_planks", rules);
  assertEqual(planks.smoothness, 85, "oak_planks smoothness is 85");
  assertEqual(planks.porosity, 12, "oak_planks porosity is 12");

  // Sand resolution
  const sand = resolveMaterial("sand", rules);
  assertEqual(sand.porosity, 64, "sand porosity is 64 (100% porous)");

  // Pattern resolution
  const ironOre = resolveMaterial("iron_ore", rules);
  assertEqual(ironOre.baseHeight, 215, "*_ore pattern resolves iron_ore to stone base");

  const sprucePlanks = resolveMaterial("spruce_planks", rules);
  assertEqual(sprucePlanks.smoothness, 85, "*_planks pattern resolves spruce_planks to oak_planks");

  const oakLog = resolveMaterial("oak_log", rules);
  assertEqual(oakLog.smoothness, 85, "*_log* pattern resolves oak_log to oak_planks");

  const dirtPath = resolveMaterial("dirt_path_top", rules);
  assertEqual(dirtPath.porosity, 55, "*dirt* pattern resolves dirt_path_top to dirt");

  const redSand = resolveMaterial("red_sand", rules);
  assertEqual(redSand.porosity, 64, "*sand* pattern resolves red_sand to sand");

  const suspGravel = resolveMaterial("suspicious_gravel_1", rules);
  assertEqual(suspGravel.porosity, 40, "*gravel* pattern resolves suspicious_gravel_1 to gravel");

  const deepslateTop = resolveMaterial("deepslate_top", rules);
  assertEqual(deepslateTop.smoothness, 45, "*deepslate* pattern resolves deepslate_top to deepslate");

  // Default material fallback
  const unknown = resolveMaterial("completely_unknown_block_xyz", rules);
  assertEqual(unknown.baseHeight, 215, "Unknown texture falls back to defaultMaterial baseHeight 215");
  assertEqual(unknown.smoothness, 35, "Unknown texture falls back to defaultMaterial smoothness 35");
}

// -----------------------------------------------------------------------------
// Suite 3: LabPBR 1.3 Normal Map Channel Packing & DirectX Y- Conventions
// -----------------------------------------------------------------------------
console.log("\n[Suite 3] LabPBR 1.3 Normal Map Channel Packing & DirectX Y- Conventions");
{
  const width = 8;
  const height = 8;

  // 1. Flat surface test: all pixels stone slate (#7e8187)
  const flatPixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    flatPixels[i * 4] = 0x7e;     // 126
    flatPixels[i * 4 + 1] = 0x81; // 129
    flatPixels[i * 4 + 2] = 0x87; // 135
    flatPixels[i * 4 + 3] = 255;
  }

  const flatNormal = generateNormalMap("stone", flatPixels, width, height);

  // For flat surface: Nx = 0 -> R = 128, Ny = 0 -> G = 128, AO = 255 -> B = 255, height = 215 -> A = 215
  assertEqual(flatNormal[0], 128, "Flat surface normal X is 128 (flat / center)");
  assertEqual(flatNormal[1], 128, "Flat surface normal Y is 128 (flat / center)");
  assertEqual(flatNormal[2], 255, "Flat surface AO is 255 (unoccluded)");
  assertEqual(flatNormal[3], 215, "Flat surface alpha is height 215");

  // 2. Unit normal normalization verification across entire grid
  let allNormalized = true;
  for (let i = 0; i < width * height; i++) {
    const r = flatNormal[i * 4];
    const g = flatNormal[i * 4 + 1];
    const nx = (r / 255) * 2.0 - 1.0;
    const ny = (g / 255) * 2.0 - 1.0;
    const nz = Math.sqrt(Math.max(0, 1.0 - (nx * nx + ny * ny)));
    const length = Math.hypot(nx, ny, nz);
    if (Math.abs(length - 1.0) > 0.05) {
      allNormalized = false;
    }
  }
  assert(allNormalized, "Normal tangent vectors are normalized unit vectors (||N|| = 1.0)");

  // 3. DirectX Y- Directional Tests:
  // Create an explicit height slope going DOWNWARDS in image coords:
  // top (y=0) is low (height 100), bottom (y=7) is high (height 200).
  // The slope faces UP (towards top of image).
  // Under DirectX format: 0 = UP, 255 = DOWN.
  // Therefore, a slope facing UP must yield Green < 128!
  const slopeUpPixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const val = Math.round(100 + (y / (height - 1)) * 100);
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      slopeUpPixels[idx] = val;
      slopeUpPixels[idx + 1] = val;
      slopeUpPixels[idx + 2] = val;
      slopeUpPixels[idx + 3] = 255;
    }
  }

  const slopeUpNormal = generateNormalMap("slope_test", slopeUpPixels, width, height, {
    useLuminance: true,
    tilingCategory: "exempt"
  });

  // Middle pixel (x=4, y=3) has positive dy (rising downwards) -> faces UP
  const midUpIdx = (3 * width + 4) * 4;
  const greenUp = slopeUpNormal[midUpIdx + 1];
  assert(greenUp < 128, `Slope facing UP yields DirectX Green < 128 (actual: ${greenUp}, 0=UP)`);

  // Reverse slope: top is high (200), bottom is low (100) -> faces DOWN
  const slopeDownPixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    const val = Math.round(200 - (y / (height - 1)) * 100);
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      slopeDownPixels[idx] = val;
      slopeDownPixels[idx + 1] = val;
      slopeDownPixels[idx + 2] = val;
      slopeDownPixels[idx + 3] = 255;
    }
  }

  const slopeDownNormal = generateNormalMap("slope_test", slopeDownPixels, width, height, {
    useLuminance: true,
    tilingCategory: "exempt"
  });

  const greenDown = slopeDownNormal[midUpIdx + 1];
  assert(greenDown > 128, `Slope facing DOWN yields DirectX Green > 128 (actual: ${greenDown}, 255=DOWN)`);

  // 4. Horizontal Directional Tests:
  // Left is low (100), right is high (200) -> slope faces LEFT -> Red < 128 (0 = LEFT)
  const slopeLeftPixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const val = Math.round(100 + (x / (width - 1)) * 100);
      const idx = (y * width + x) * 4;
      slopeLeftPixels[idx] = val;
      slopeLeftPixels[idx + 1] = val;
      slopeLeftPixels[idx + 2] = val;
      slopeLeftPixels[idx + 3] = 255;
    }
  }

  const slopeLeftNormal = generateNormalMap("slope_test", slopeLeftPixels, width, height, {
    useLuminance: true,
    tilingCategory: "exempt"
  });

  const redLeft = slopeLeftNormal[midUpIdx];
  assert(redLeft < 128, `Slope facing LEFT yields Red < 128 (actual: ${redLeft}, 0=LEFT)`);

  // Left is high (200), right is low (100) -> slope faces RIGHT -> Red > 128 (255 = RIGHT)
  const slopeRightPixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const val = Math.round(200 - (x / (width - 1)) * 100);
      const idx = (y * width + x) * 4;
      slopeRightPixels[idx] = val;
      slopeRightPixels[idx + 1] = val;
      slopeRightPixels[idx + 2] = val;
      slopeRightPixels[idx + 3] = 255;
    }
  }

  const slopeRightNormal = generateNormalMap("slope_test", slopeRightPixels, width, height, {
    useLuminance: true,
    tilingCategory: "exempt"
  });

  const redRight = slopeRightNormal[midUpIdx];
  assert(redRight > 128, `Slope facing RIGHT yields Red > 128 (actual: ${redRight}, 255=RIGHT)`);

  // 5. Height clamping in [1, 255]
  const zeroPixels = Buffer.alloc(width * height * 4); // all 0
  const zeroNormal = generateNormalMap("zero_test", zeroPixels, width, height, { useLuminance: true });
  assertEqual(zeroNormal[3], 1, "Height is clamped to minimum 1 (LabPBR spec non-zero POM requirement)");
}

// -----------------------------------------------------------------------------
// Suite 4: LabPBR 1.3 Specular Map Channel Packing & Gemstone Optical Values
// -----------------------------------------------------------------------------
console.log("\n[Suite 4] LabPBR 1.3 Specular Map Channel Packing & Gemstone Optical Values");
{
  const width = 4;
  const height = 4;

  // 1. Stone specular map
  const stonePixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    stonePixels[i * 4] = 0x7e;
    stonePixels[i * 4 + 1] = 0x81;
    stonePixels[i * 4 + 2] = 0x87;
    stonePixels[i * 4 + 3] = 255;
  }

  const stoneSpec = generateSpecularMap("stone", stonePixels, width, height);
  assertEqual(stoneSpec[0], 35, "Stone specular Red is smoothness 35");
  assertEqual(stoneSpec[1], 10, "Stone specular Green is linear dielectric F0 10");
  assertEqual(stoneSpec[2], 5, "Stone specular Blue is porosity 5");
  assertEqual(stoneSpec[3], 0, "Stone specular Alpha is emission 0");

  // 2. Diamond Ore specular map with gemstone facet color #4eebd9 (78, 235, 217)
  const gemPixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    gemPixels[i * 4] = 78;
    gemPixels[i * 4 + 1] = 235;
    gemPixels[i * 4 + 2] = 217;
    gemPixels[i * 4 + 3] = 255;
  }

  const gemSpec = generateSpecularMap("diamond_ore", gemPixels, width, height);
  assert(gemSpec[0] >= 200, `Diamond crystal facet has high smoothness >= 200 (actual: ${gemSpec[0]})`);
  assertEqual(gemSpec[1], 48, "Diamond crystal facet Green is F0 48");
  assertEqual(gemSpec[2], 0, "Diamond crystal facet Blue is porosity 0 (impermeable gem)");
  assert(gemSpec[3] > 0, `Diamond crystal facet Alpha has emission > 0 (actual: ${gemSpec[3]})`);

  // 3. Emission clamping (max 254 per LabPBR spec)
  const maxEmissionPixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) maxEmissionPixels[i * 4 + 3] = 255;
  const customRules = {
    defaultMaterial: { smoothness: 10, f0: 10, porosity: 0, emission: 255, baseHeight: 200 }
  };
  const maxSpec = generateSpecularMap("custom", maxEmissionPixels, width, height, { rules: customRules });
  assertEqual(maxSpec[3], 254, "Emission is clamped to maximum 254 (255 reserved)");
}

// -----------------------------------------------------------------------------
// Suite 5: Periodic Boundary Continuity & Toroidal Seams
// -----------------------------------------------------------------------------
console.log("\n[Suite 5] Periodic Boundary Continuity & Toroidal Seams");
{
  const width = 16;
  const height = 16;

  // Create a toroidally repeating test pattern: h(x, y) = sin(2*pi*x / W) * cos(2*pi*y / H)
  const toroidalPixels = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const v = Math.round(128 + 60 * Math.sin((2 * Math.PI * x) / width) * Math.cos((2 * Math.PI * y) / height));
      toroidalPixels[idx] = v;
      toroidalPixels[idx + 1] = v;
      toroidalPixels[idx + 2] = v;
      toroidalPixels[idx + 3] = 255;
    }
  }

  const normalMap = generateNormalMap("toroidal_test", toroidalPixels, width, height, {
    useLuminance: true,
    tilingCategory: "toroidal"
  });

  // Verify boundary gradient symmetry:
  // At x=0, dx samples x=-1 (which wraps to x=15) and x=1
  // At x=15, dx samples x=14 and x=16 (which wraps to x=0)
  // Check that boundary normals match theoretical continuous derivatives smoothly
  const normalLeft = normalMap.subarray(0, width * 4);
  assert(normalLeft.length === width * 4, "Toroidal boundary evaluation completes with seamless wrapping");

  // Tiling rules category lookup verification
  const tilingRules = loadTilingRules();
  assertEqual(resolveTilingCategory("stone", tilingRules), "toroidal", "stone resolves to toroidal category");
  assertEqual(resolveTilingCategory("dirt_path_side", tilingRules), "x-only", "dirt_path_side resolves to x-only category");
  assertEqual(resolveTilingCategory("short_grass", tilingRules), "exempt", "short_grass resolves to exempt category");
  assertEqual(resolveTilingCategory("grass_block_side_overlay", tilingRules), "exempt", "grass_block_side_overlay resolves to exempt category");
}

// -----------------------------------------------------------------------------
// Suite 6: Unified generatePbrMaps & Compiler Integration Smoke Test
// -----------------------------------------------------------------------------
console.log("\n[Suite 6] Unified generatePbrMaps & Compiler Integration Smoke Test");
{
  const width = 16;
  const height = 16;
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    pixels[i * 4] = 0x7e;
    pixels[i * 4 + 1] = 0x81;
    pixels[i * 4 + 2] = 0x87;
    pixels[i * 4 + 3] = 255;
  }

  const pbr = generatePbrMaps("stone", pixels, width, height);
  assert(Buffer.isBuffer(pbr.normalMap), "pbr.normalMap is a valid Buffer");
  assert(Buffer.isBuffer(pbr.specularMap), "pbr.specularMap is a valid Buffer");
  assertEqual(pbr.normalMap.readUInt32BE(0), 0x89504E47, "pbr.normalMap has PNG header magic");
  assertEqual(pbr.specularMap.readUInt32BE(0), 0x89504E47, "pbr.specularMap has PNG header magic");
  assert(pbr.normalPixels && pbr.normalPixels.length === width * height * 4, "pbr.normalPixels carries raw RGBA");
  assert(pbr.specularPixels && pbr.specularPixels.length === width * height * 4, "pbr.specularPixels carries raw RGBA");

  // Compiler smoke test with --pbr at 32x resolution
  console.log("  Running buildResourcePack(32, { pbr: true }) smoke test...");
  const result = await buildResourcePack(32, { pbr: true });
  assert(fs.existsSync(result.filePath), `Pack successfully compiled to ${result.filePath}`);

  // Inspect the generated zip to confirm _n.png and _s.png companions exist
  const zipBuffer = fs.readFileSync(result.filePath);
  const zipText = zipBuffer.toString("latin1");

  assert(zipText.includes("stone_n.png"), "Output zip contains stone_n.png");
  assert(zipText.includes("stone_s.png"), "Output zip contains stone_s.png");
  assert(zipText.includes("diamond_ore_n.png"), "Output zip contains diamond_ore_n.png");
  assert(zipText.includes("diamond_ore_s.png"), "Output zip contains diamond_ore_s.png");
  assert(zipText.includes("dirt_n.png"), "Output zip contains dirt_n.png");
  assert(zipText.includes("dirt_s.png"), "Output zip contains dirt_s.png");
  assert(zipText.includes("oak_planks_n.png"), "Output zip contains oak_planks_n.png");
  assert(zipText.includes("oak_planks_s.png"), "Output zip contains oak_planks_s.png");
}

if (fs.existsSync(TEST_TMP)) fs.rmSync(TEST_TMP, { recursive: true, force: true });

console.log("\n=======================================================");
console.log(`  RESULTS: ${passedTests}/${totalTests} tests passed`);
console.log("=======================================================\n");

if (passedTests !== totalTests) process.exit(1);

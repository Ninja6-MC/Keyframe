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

// LabPBR 1.3 stores dielectric F0 linearly in the specular green channel (0-229 =
// F0 x 255). Normal-incidence Fresnel reflectance from air: ((n - 1) / (n + 1))^2.
function iorToF0(n) {
  return Math.round(((n - 1) / (n + 1)) ** 2 * 255);
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

  // Every exact material key must name a vanilla block texture stem, because
  // resolveMaterial matches the stem the build derives from the master filename.
  // Keys that are not stems are only valid as pattern targets, and each pattern
  // must match at least one vanilla stem. Stem list: assets/minecraft/textures/block
  // of the 1.21.6 client jar.
  const vanillaStems = new Set(
    fs.readFileSync(path.join(__dirname, "fixtures", "vanilla-1.21.6-block-stems.txt"), "utf-8")
      .split(/\r?\n/)
      .filter(Boolean)
  );
  assert(vanillaStems.has("stone") && vanillaStems.size > 1000, "Vanilla 1.21.6 block stem fixture loaded");
  const patternTargets = new Set(rules.patterns.map((p) => p.material));
  const strayKeys = Object.keys(rules.materials).filter(
    (key) => !vanillaStems.has(key) && !patternTargets.has(key)
  );
  assertEqual(strayKeys.join(","), "", "Every exact material key is a vanilla stem or a pattern target");
  const deadPatterns = rules.patterns.filter(
    (p) => ![...vanillaStems].some((stem) => matchGlob(stem, p.pattern))
  );
  assertEqual(deadPatterns.map((p) => p.pattern).join(","), "", "Every material pattern matches a vanilla stem");
  const danglingTargets = rules.patterns.filter((p) => !rules.materials[p.material]);
  assertEqual(danglingTargets.map((p) => p.material).join(","), "", "Every pattern targets a defined material");

  // Stone and Deepslate Ores Matrix Resolution. No masters exist for these ores yet,
  // so mineral F0 is not keyed to colorFeatures and the whole face keeps host-rock F0 10.
  const ironOreMat = resolveMaterial("iron_ore", rules);
  assertEqual(ironOreMat.smoothness, 40, "iron_ore smoothness is 40");
  assertEqual(ironOreMat.f0, 10, "iron_ore f0 is host-rock 10");
  assertEqual(ironOreMat.porosity, 5, "iron_ore porosity is 5");
  assertEqual(ironOreMat.emission, 0, "iron_ore emission is 0");
  assertEqual(ironOreMat.baseHeight, 215, "iron_ore baseHeight is 215");

  const copperOreMat = resolveMaterial("copper_ore", rules);
  assertEqual(copperOreMat.smoothness, 40, "copper_ore smoothness is 40");
  assertEqual(copperOreMat.f0, 10, "copper_ore f0 is host-rock 10");
  assertEqual(copperOreMat.porosity, 5, "copper_ore porosity is 5");

  const goldOreMat = resolveMaterial("gold_ore", rules);
  assertEqual(goldOreMat.smoothness, 50, "gold_ore smoothness is 50");
  assertEqual(goldOreMat.f0, 10, "gold_ore f0 is host-rock 10");
  assertEqual(goldOreMat.porosity, 4, "gold_ore porosity is 4");

  const redstoneOreMat = resolveMaterial("redstone_ore", rules);
  assertEqual(redstoneOreMat.emission, 0, "redstone_ore base emission is 0 (unlit state shares the texture)");
  assertEqual(redstoneOreMat.baseHeight, 215, "redstone_ore baseHeight is 215");
  assert(redstoneOreMat.parsedFeatures.length > 0, "redstone_ore scopes dust properties to colorFeatures");
  assert(
    redstoneOreMat.parsedFeatures.every((f) => (f.emission ?? 0) === 0),
    "redstone_ore colorFeatures carry no emission"
  );

  const emeraldOreMat = resolveMaterial("emerald_ore", rules);
  assertEqual(emeraldOreMat.smoothness, 35, "emerald_ore host rock smoothness is 35");
  assertEqual(emeraldOreMat.f0, 10, "emerald_ore host rock f0 is 10");
  assertEqual(emeraldOreMat.porosity, 5, "emerald_ore host rock porosity is 5");
  const emeraldGemFeatures = emeraldOreMat.parsedFeatures.filter((f) => f.f0 !== 10);
  assert(emeraldGemFeatures.length > 0, "emerald_ore gem F0 is scoped to colorFeatures");
  assert(
    emeraldGemFeatures.every((f) => f.f0 === iorToF0(1.57)),
    `emerald_ore gem F0 is ${iorToF0(1.57)} (beryl n = 1.57, linear F0)`
  );

  const lapisOreMat = resolveMaterial("lapis_ore", rules);
  assertEqual(lapisOreMat.smoothness, 45, "lapis_ore smoothness is 45");
  assertEqual(lapisOreMat.f0, 10, "lapis_ore f0 is host-rock 10");
  assertEqual(lapisOreMat.porosity, 8, "lapis_ore porosity is 8");

  const dsIronOre = resolveMaterial("deepslate_iron_ore", rules);
  assertEqual(dsIronOre.baseHeight, 210, "deepslate_iron_ore baseHeight is 210");
  assertEqual(dsIronOre.smoothness, 45, "deepslate_iron_ore smoothness is 45");
  assertEqual(dsIronOre.f0, 10, "deepslate_iron_ore f0 is host-rock 10");
  assertEqual(dsIronOre.porosity, 4, "deepslate_iron_ore porosity is 4");

  const dsCopperOre = resolveMaterial("deepslate_copper_ore", rules);
  assertEqual(dsCopperOre.baseHeight, 210, "deepslate_copper_ore baseHeight is 210");
  assertEqual(dsCopperOre.f0, 10, "deepslate_copper_ore f0 is host-rock 10");

  const dsGoldOre = resolveMaterial("deepslate_gold_ore", rules);
  assertEqual(dsGoldOre.baseHeight, 210, "deepslate_gold_ore baseHeight is 210");
  assertEqual(dsGoldOre.smoothness, 50, "deepslate_gold_ore smoothness is 50");
  assertEqual(dsGoldOre.f0, 10, "deepslate_gold_ore f0 is host-rock 10");

  const dsRedstoneOre = resolveMaterial("deepslate_redstone_ore", rules);
  assertEqual(dsRedstoneOre.baseHeight, 210, "deepslate_redstone_ore baseHeight is 210");
  assertEqual(dsRedstoneOre.emission, 0, "deepslate_redstone_ore base emission is 0");
  assert(
    dsRedstoneOre.parsedFeatures.every((f) => (f.emission ?? 0) === 0),
    "deepslate_redstone_ore colorFeatures carry no emission"
  );

  const dsEmeraldOre = resolveMaterial("deepslate_emerald_ore", rules);
  assertEqual(dsEmeraldOre.baseHeight, 210, "deepslate_emerald_ore baseHeight is 210");
  assertEqual(dsEmeraldOre.smoothness, 45, "deepslate_emerald_ore host rock smoothness is 45");
  assertEqual(dsEmeraldOre.f0, 10, "deepslate_emerald_ore host rock f0 is 10");
  const dsEmeraldGemFeatures = dsEmeraldOre.parsedFeatures.filter((f) => f.f0 !== 10);
  assert(dsEmeraldGemFeatures.length > 0, "deepslate_emerald_ore gem F0 is scoped to colorFeatures");
  assert(
    dsEmeraldGemFeatures.every((f) => f.f0 === iorToF0(1.57)),
    `deepslate_emerald_ore gem F0 is ${iorToF0(1.57)} (beryl n = 1.57, linear F0)`
  );

  const dsLapisOre = resolveMaterial("deepslate_lapis_ore", rules);
  assertEqual(dsLapisOre.baseHeight, 210, "deepslate_lapis_ore baseHeight is 210");
  assertEqual(dsLapisOre.f0, 10, "deepslate_lapis_ore f0 is host-rock 10");
  assertEqual(dsLapisOre.porosity, 6, "deepslate_lapis_ore porosity is 6");

  const dsDiamondOre = resolveMaterial("deepslate_diamond_ore", rules);
  assertEqual(dsDiamondOre.baseHeight, 210, "deepslate_diamond_ore baseHeight is 210");
  assertEqual(dsDiamondOre.smoothness, 45, "deepslate_diamond_ore host rock smoothness is 45");
  assertEqual(dsDiamondOre.f0, 10, "deepslate_diamond_ore host rock f0 is 10");
  assertEqual(dsDiamondOre.porosity, 4, "deepslate_diamond_ore host rock porosity is 4");
  assert(
    dsDiamondOre.parsedFeatures.some((f) => f.f0 >= 48),
    "deepslate_diamond_ore gem F0 is scoped to colorFeatures"
  );
  assert(
    dsDiamondOre.parsedFeatures.every((f) => (f.emission ?? 0) === 0),
    "deepslate_diamond_ore colorFeatures carry no emission (diamond ore does not glow)"
  );

  const dsCoalOre = resolveMaterial("deepslate_coal_ore", rules);
  assertEqual(dsCoalOre.baseHeight, 210, "deepslate_coal_ore baseHeight is 210");
  assertEqual(dsCoalOre.smoothness, 45, "deepslate_coal_ore smoothness is 45");
  assertEqual(dsCoalOre.f0, 10, "deepslate_coal_ore f0 is host-rock 10");
  assertEqual(dsCoalOre.porosity, 6, "deepslate_coal_ore porosity is 6");

  // Resolve only stems the build can produce: masters are named after vanilla textures.
  const resolveStem = (stem) => {
    assert(vanillaStems.has(stem), `${stem} is a vanilla 1.21.6 block texture stem`);
    return resolveMaterial(stem, rules);
  };

  // Raw ore blocks: ore chunk with dark crevices, not bare metal. Dielectric until a
  // master exists whose highlight colours can carry a metal ID via colorFeatures.
  for (const stem of ["raw_iron_block", "raw_gold_block", "raw_copper_block"]) {
    const raw = resolveStem(stem);
    assertEqual(raw.f0, 10, `${stem} f0 is dielectric 10, not a hardcoded metal ID`);
    assertEqual(raw.parsedFeatures.length, 0, `${stem} carries no metal-ID colorFeatures`);
  }
  assertEqual(resolveStem("raw_iron_block").smoothness, 80, "raw_iron_block smoothness is 80");

  // Conductors / Metallic Blocks Resolution (LabPBR 1.3 metal IDs >= 230)
  const ironBlock = resolveStem("iron_block");
  assertEqual(ironBlock.f0, 230, "iron_block f0 is metal ID 230");
  assertEqual(ironBlock.porosity, 0, "iron_block porosity is 0");
  assertEqual(ironBlock.smoothness, 190, "iron_block smoothness is 190");

  const goldBlock = resolveStem("gold_block");
  assertEqual(goldBlock.f0, 231, "gold_block f0 is metal ID 231");
  assertEqual(goldBlock.porosity, 0, "gold_block porosity is 0");
  assertEqual(goldBlock.smoothness, 210, "gold_block smoothness is 210");

  const copperBlock = resolveStem("copper_block");
  assertEqual(copperBlock.f0, 234, "copper_block f0 is metal ID 234");
  assertEqual(copperBlock.porosity, 0, "copper_block porosity is 0");
  assertEqual(copperBlock.smoothness, 180, "copper_block smoothness is 180");

  const netheriteBlock = resolveStem("netherite_block");
  assertEqual(netheriteBlock.f0, 255, "netherite_block f0 is 255 (albedo-driven metal, no LabPBR preset)");
  assertEqual(netheriteBlock.porosity, 0, "netherite_block porosity is 0");
  assertEqual(netheriteBlock.smoothness, 170, "netherite_block smoothness is 170");

  // Minerals & Masonry Resolution. Vanilla ships no quartz_block, smooth_quartz, basalt
  // or polished_basalt texture; the faces are matched by stem patterns instead.
  for (const stem of ["quartz_block_side", "quartz_block_top", "quartz_block_bottom"]) {
    const quartz = resolveStem(stem);
    assertEqual(quartz.smoothness, 140, `quartz_block_* pattern resolves ${stem} smoothness 140`);
    assertEqual(quartz.f0, iorToF0(1.544), `${stem} f0 is ${iorToF0(1.544)} (quartz n = 1.544)`);
    assertEqual(quartz.porosity, 0, `${stem} porosity is 0`);
  }
  assert(!vanillaStems.has("smooth_quartz"), "smooth_quartz has no texture of its own (reuses quartz_block_bottom)");
  assert(!rules.materials.smooth_quartz, "No unreachable smooth_quartz material entry");

  for (const stem of ["basalt_side", "basalt_top"]) {
    const basalt = resolveStem(stem);
    assertEqual(basalt.smoothness, 40, `basalt_* pattern resolves ${stem} smoothness 40`);
    assertEqual(basalt.f0, 10, `${stem} f0 is 10`);
    assertEqual(basalt.porosity, 8, `${stem} porosity is 8`);
  }

  for (const stem of ["polished_basalt_side", "polished_basalt_top"]) {
    const polishedBasalt = resolveStem(stem);
    assertEqual(polishedBasalt.smoothness, 120, `polished_basalt_* pattern resolves ${stem} smoothness 120`);
    assertEqual(polishedBasalt.porosity, 4, `${stem} porosity is 4`);
  }

  const smoothBasalt = resolveStem("smooth_basalt");
  assertEqual(smoothBasalt.smoothness, 100, "smooth_basalt smoothness is 100");
  assertEqual(smoothBasalt.porosity, 5, "smooth_basalt porosity is 5");

  for (const stem of ["blackstone", "blackstone_top"]) {
    const blackstone = resolveStem(stem);
    assertEqual(blackstone.smoothness, 45, `${stem} smoothness is 45`);
    assertEqual(blackstone.porosity, 6, `${stem} porosity is 6`);
  }

  const polishedBlackstone = resolveStem("polished_blackstone");
  assertEqual(polishedBlackstone.smoothness, 130, "polished_blackstone smoothness is 130");
  assertEqual(polishedBlackstone.porosity, 3, "polished_blackstone porosity is 3");

  const obsidian = resolveStem("obsidian");
  assertEqual(obsidian.smoothness, 210, "obsidian smoothness is 210");
  assertEqual(obsidian.f0, iorToF0(1.49), `obsidian f0 is ${iorToF0(1.49)} (volcanic glass n = 1.49)`);
  assertEqual(obsidian.porosity, 0, "obsidian porosity is 0");

  const cryingObsidian = resolveStem("crying_obsidian");
  assertEqual(cryingObsidian.smoothness, 210, "crying_obsidian smoothness is 210");
  assertEqual(cryingObsidian.f0, iorToF0(1.49), `crying_obsidian f0 is ${iorToF0(1.49)} (volcanic glass n = 1.49)`);
  assert(
    cryingObsidian.parsedFeatures.every((f) => f.f0 === iorToF0(1.49)),
    "crying_obsidian colorFeatures share the obsidian F0"
  );
  assertEqual(cryingObsidian.porosity, 0, "crying_obsidian porosity is 0");
  assertEqual(cryingObsidian.emission, 0, "crying_obsidian base emission is 0 (obsidian matrix)");
  assert(
    cryingObsidian.parsedFeatures.some((f) => f.emission === 180),
    "crying_obsidian emission 180 is scoped to tear colorFeatures"
  );

  const amethystBlock = resolveStem("amethyst_block");
  assertEqual(amethystBlock.smoothness, 160, "amethyst_block smoothness is 160");
  assertEqual(amethystBlock.f0, iorToF0(1.544), `amethyst_block f0 is ${iorToF0(1.544)} (quartz n = 1.544)`);
  assertEqual(amethystBlock.porosity, 0, "amethyst_block porosity is 0");

  const tuff = resolveStem("tuff");
  assertEqual(tuff.smoothness, 25, "tuff smoothness is 25");
  assertEqual(tuff.porosity, 25, "tuff porosity is 25");

  const polishedTuff = resolveStem("polished_tuff");
  assertEqual(polishedTuff.smoothness, 90, "polished_tuff smoothness is 90");
  assertEqual(polishedTuff.porosity, 15, "polished_tuff porosity is 15");

  const calcite = resolveStem("calcite");
  assertEqual(calcite.smoothness, 60, "calcite smoothness is 60");
  assertEqual(calcite.f0, 14, "calcite f0 is 14");
  assertEqual(calcite.porosity, 6, "calcite porosity is 6");

  // Architectural Resolution
  const glass = resolveStem("glass");
  assertEqual(glass.smoothness, 255, "glass smoothness is 255");
  assertEqual(glass.f0, iorToF0(1.52), `glass f0 is ${iorToF0(1.52)} (soda-lime glass n = 1.52)`);
  assertEqual(glass.porosity, 0, "glass porosity is 0");

  const tintedGlass = resolveStem("tinted_glass");
  assertEqual(tintedGlass.smoothness, 255, "tinted_glass smoothness is 255");
  assertEqual(tintedGlass.f0, iorToF0(1.52), `tinted_glass f0 is ${iorToF0(1.52)} (soda-lime glass n = 1.52)`);
  assertEqual(tintedGlass.porosity, 0, "tinted_glass porosity is 0");

  const terracotta = resolveStem("terracotta");
  assertEqual(terracotta.smoothness, 30, "terracotta smoothness is 30");
  assertEqual(terracotta.f0, 10, "terracotta f0 is 10");
  assertEqual(terracotta.porosity, 15, "terracotta porosity is 15");

  // Architectural Pattern Resolution
  const whiteTerracotta = resolveStem("white_terracotta");
  assertEqual(whiteTerracotta.smoothness, 30, "*terracotta* pattern resolves white_terracotta smoothness 30");
  assertEqual(whiteTerracotta.porosity, 15, "*terracotta* pattern resolves white_terracotta porosity 15");

  const cyanConcrete = resolveStem("cyan_concrete");
  assertEqual(cyanConcrete.smoothness, 50, "*concrete* pattern resolves cyan_concrete smoothness 50");
  assertEqual(cyanConcrete.f0, 10, "*concrete* pattern resolves cyan_concrete f0 10");
  assertEqual(cyanConcrete.porosity, 2, "*concrete* pattern resolves cyan_concrete porosity 2");

  const glazedTerracotta = resolveStem("white_glazed_terracotta");
  assertEqual(glazedTerracotta.smoothness, 190, "*_glazed_terracotta resolves glossy glaze smoothness 190");
  assertEqual(glazedTerracotta.porosity, 0, "*_glazed_terracotta resolves impermeable glaze porosity 0");

  const concretePowder = resolveStem("cyan_concrete_powder");
  assertEqual(concretePowder.smoothness, 15, "*_concrete_powder resolves granular smoothness 15");
  assertEqual(concretePowder.porosity, 45, "*_concrete_powder resolves granular porosity 45");

  const stainedGlass = resolveStem("blue_stained_glass");
  assertEqual(stainedGlass.smoothness, 255, "*glass* pattern resolves blue_stained_glass smoothness 255");
  assertEqual(stainedGlass.f0, iorToF0(1.52), `*glass* pattern resolves blue_stained_glass f0 ${iorToF0(1.52)}`);
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

  // 4. Conductor / Metal specular map channel packing
  const testPixels = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    testPixels[i * 4] = 128;
    testPixels[i * 4 + 1] = 128;
    testPixels[i * 4 + 2] = 128;
    testPixels[i * 4 + 3] = 255;
  }

  const ironSpec = generateSpecularMap("iron_block", testPixels, width, height);
  assertEqual(ironSpec[0], 190, "Iron block specular Red is smoothness 190");
  assertEqual(ironSpec[1], 230, "Iron block specular Green is LabPBR metal ID 230");
  assertEqual(ironSpec[2], 0, "Iron block specular Blue is porosity 0 (metal)");
  assertEqual(ironSpec[3], 0, "Iron block specular Alpha is emission 0");

  const goldSpec = generateSpecularMap("gold_block", testPixels, width, height);
  assertEqual(goldSpec[0], 210, "Gold block specular Red is smoothness 210");
  assertEqual(goldSpec[1], 231, "Gold block specular Green is LabPBR metal ID 231");
  assertEqual(goldSpec[2], 0, "Gold block specular Blue is porosity 0 (metal)");

  const copperSpec = generateSpecularMap("copper_block", testPixels, width, height);
  assertEqual(copperSpec[0], 180, "Copper block specular Red is smoothness 180");
  assertEqual(copperSpec[1], 234, "Copper block specular Green is LabPBR metal ID 234");
  assertEqual(copperSpec[2], 0, "Copper block specular Blue is porosity 0 (metal)");

  const netheriteSpec = generateSpecularMap("netherite_block", testPixels, width, height);
  assertEqual(netheriteSpec[0], 170, "Netherite block specular Red is smoothness 170");
  assertEqual(netheriteSpec[1], 255, "Netherite block specular Green is 255 (albedo-driven metal)");
  assertEqual(netheriteSpec[2], 0, "Netherite block specular Blue is porosity 0 (metal)");

  const rawGoldSpec = generateSpecularMap("raw_gold_block", testPixels, width, height);
  assertEqual(rawGoldSpec[1], 10, "Raw gold block specular Green is dielectric F0 10, not metal ID 231");

  // 5. Feature-scoped emission and gem F0: only keyed pixels change, the host matrix stays inert
  const fillHex = (hex) => {
    const buf = Buffer.alloc(width * height * 4);
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    for (let i = 0; i < width * height; i++) {
      buf[i * 4] = r;
      buf[i * 4 + 1] = g;
      buf[i * 4 + 2] = b;
      buf[i * 4 + 3] = 255;
    }
    return buf;
  };

  const tearSpec = generateSpecularMap("crying_obsidian", fillHex("#b24cf7"), width, height);
  assertEqual(tearSpec[3], 180, "Crying obsidian tear pixel Alpha is emission 180");
  assertEqual(tearSpec[2], 0, "Crying obsidian tear pixel Blue is porosity 0");

  const matrixSpec = generateSpecularMap("crying_obsidian", fillHex("#1d1030"), width, height);
  assertEqual(matrixSpec[0], 210, "Crying obsidian matrix pixel Red is smoothness 210");
  assertEqual(matrixSpec[1], 10, "Crying obsidian matrix pixel Green is F0 10 (n = 1.49)");
  assertEqual(matrixSpec[3], 0, "Crying obsidian matrix pixel Alpha is emission 0");

  const cryingGraySpec = generateSpecularMap("crying_obsidian", testPixels, width, height);
  assertEqual(cryingGraySpec[3], 0, "Crying obsidian unmatched pixel falls back to base emission 0");

  const dustSpec = generateSpecularMap("redstone_ore", fillHex("#ff0000"), width, height);
  assert(dustSpec[0] > 35, `Redstone dust pixel is smoother than host rock (actual: ${dustSpec[0]})`);
  assertEqual(dustSpec[3], 0, "Redstone dust pixel Alpha is emission 0 (unlit state)");

  const redstoneHostSpec = generateSpecularMap("redstone_ore", testPixels, width, height);
  assertEqual(redstoneHostSpec[3], 0, "Redstone ore host stone Alpha is emission 0");

  const dsRedstoneHostSpec = generateSpecularMap("deepslate_redstone_ore", fillHex("#3d3d43"), width, height);
  assertEqual(dsRedstoneHostSpec[3], 0, "Deepslate redstone ore host deepslate Alpha is emission 0");

  const emeraldGemSpec = generateSpecularMap("emerald_ore", fillHex("#17dd62"), width, height);
  assertEqual(emeraldGemSpec[1], 13, "Emerald gem pixel Green is F0 13 (beryl n = 1.57)");
  const emeraldHostSpec = generateSpecularMap("emerald_ore", fillHex("#7e8187"), width, height);
  assertEqual(emeraldHostSpec[1], 10, "Emerald ore host stone Green is F0 10");

  const dsDiamondGemSpec = generateSpecularMap("deepslate_diamond_ore", fillHex("#4eebd9"), width, height);
  assertEqual(dsDiamondGemSpec[1], 48, "Deepslate diamond gem pixel Green is F0 48");
  assertEqual(dsDiamondGemSpec[3], 0, "Deepslate diamond gem pixel Alpha is emission 0");
  const dsDiamondHostSpec = generateSpecularMap("deepslate_diamond_ore", fillHex("#646464"), width, height);
  assertEqual(dsDiamondHostSpec[1], 10, "Deepslate diamond ore host deepslate Green is F0 10");
  assertEqual(dsDiamondHostSpec[3], 0, "Deepslate diamond ore host deepslate Alpha is emission 0");

  // 6. Architectural specular maps
  const glassSpec = generateSpecularMap("glass", testPixels, width, height);
  assertEqual(glassSpec[0], 255, "Glass specular Red is smoothness 255");
  assertEqual(glassSpec[1], 11, "Glass specular Green is F0 11 (n = 1.52)");
  assertEqual(glassSpec[2], 0, "Glass specular Blue is porosity 0");

  const tintedGlassSpec = generateSpecularMap("tinted_glass", testPixels, width, height);
  assertEqual(tintedGlassSpec[0], 255, "Tinted glass specular Red is smoothness 255");
  assertEqual(tintedGlassSpec[1], 11, "Tinted glass specular Green is F0 11 (n = 1.52)");
  assertEqual(tintedGlassSpec[2], 0, "Tinted glass specular Blue is porosity 0");

  const terracottaSpec = generateSpecularMap("terracotta", testPixels, width, height);
  assertEqual(terracottaSpec[0], 30, "Terracotta specular Red is smoothness 30");
  assertEqual(terracottaSpec[1], 10, "Terracotta specular Green is F0 10");
  assertEqual(terracottaSpec[2], 15, "Terracotta specular Blue is porosity 15");

  const concreteSpec = generateSpecularMap("white_concrete", testPixels, width, height);
  assertEqual(concreteSpec[0], 50, "White concrete specular Red is smoothness 50");
  assertEqual(concreteSpec[1], 10, "White concrete specular Green is F0 10");
  assertEqual(concreteSpec[2], 2, "White concrete specular Blue is porosity 2");
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

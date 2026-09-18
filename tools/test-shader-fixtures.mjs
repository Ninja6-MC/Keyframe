#!/usr/bin/env node

/**
 * Keyframe Shaderpack Calibration & Iris / Sodium Verification Fixtures
 *
 * Headless test harness verifying LabPBR 1.3 normal and specular texture compatibility
 * with the exact PBR BRDF evaluation equations used by Complementary Reimagined / Iris.
 *
 * Implements:
 * 1. LabPBR 1.3 DirectX Y- tangent normal unpacking and Z-reconstruction.
 * 2. Cook-Torrance / GGX microfacet specular BRDF and Lambertian diffuse evaluation.
 * 3. Dielectric vs Conductor metalness blending and albedo chromatic tinting.
 * 4. Ambient occlusion (AO) attenuation from _n Blue channel.
 * 5. Emissive boost and shadow immunity from _s Alpha channel.
 * 6. Dynamic lighting toroidal boundary continuity validation.
 * 7. Zero external binary dependency (runs purely in Node.js Float32Array buffers).
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(ROOT_DIR, "dist", "shader_fixtures");

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

function assertCloseTo(actual, expected, maxDelta, message) {
  totalTests++;
  const delta = Math.abs(actual - expected);
  if (delta > maxDelta) {
    console.error(`  ❌ FAIL: ${message}\n      Expected: ~${expected} (±${maxDelta})\n      Actual:   ${actual} (Δ=${delta})`);
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

// ---------------------------------------------------------------------------
// 1. Pure Vector Mathematics Library
// ---------------------------------------------------------------------------

export function vec3(x = 0, y = 0, z = 0) {
  return [x, y, z];
}

export function vec3Dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vec3Cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}

export function vec3Length(v) {
  return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
}

export function vec3Normalize(v) {
  const len = vec3Length(v);
  if (len < 1e-9) return [0, 0, 1];
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function vec3Scale(v, s) {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function vec3Add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vec3Subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vec3Mix(a, b, t) {
  return [
    a[0] * (1 - t) + b[0] * t,
    a[1] * (1 - t) + b[1] * t,
    a[2] * (1 - t) + b[2] * t
  ];
}

export function vec3Reflect(i, n) {
  const d = vec3Dot(i, n);
  return vec3Subtract(i, vec3Scale(n, 2.0 * d));
}

// ---------------------------------------------------------------------------
// 2. LabPBR 1.3 Channel Unpackers
// ---------------------------------------------------------------------------

/**
 * Unpacks tangent-space normal vector and parameters from LabPBR 1.3 _n pixel.
 * Note on coordinate space:
 * LabPBR encodes normal Y in DirectX format (top-down, where 0 is +Y up and 255 is -Y down).
 * To reconstruct standard +Y Up tangent space for shading:
 * Ny = 1.0 - (G / 255.0) * 2.0
 */
export function unpackNormal(r, g, b, a) {
  const nx = (r / 255.0) * 2.0 - 1.0;
  const ny = 1.0 - (g / 255.0) * 2.0;
  const xyLenSq = nx * nx + ny * ny;
  const nz = Math.sqrt(Math.max(0.0, 1.0 - xyLenSq));

  const normal = vec3Normalize([nx, ny, nz]);
  const ao = b / 255.0;
  const height = a / 255.0;

  return { normal, ao, height };
}

/**
 * Unpacks specular, roughness, metalness, and emission from LabPBR 1.3 _s pixel.
 * Red: Smoothness (0..255)
 * Green: Reflectance / Metalness (0..229: Dielectric F0, 230..255: Conductor metalness)
 * Blue: Porosity (0..64) or Subsurface Scattering (65..255)
 * Alpha: Emissivity (0: inert, 1..255: glowing radiance)
 */
export function unpackSpecular(r, g, b, a, albedo = [1, 1, 1]) {
  const smoothness = r / 255.0;
  const roughness = 1.0 - smoothness;
  const alpha = Math.max(0.001, roughness * roughness);

  let metalness = 0.0;
  let f0;

  if (g < 230) {
    // Dielectric material: base F0 mapped from Green channel
    metalness = 0.0;
    const dielectricF0 = (g / 255.0) * 0.08;
    f0 = [dielectricF0, dielectricF0, dielectricF0];
  } else {
    // Conductor material (iron, gold, diamond ore metal matrix, etc.)
    metalness = 1.0;
    f0 = [albedo[0], albedo[1], albedo[2]];
  }

  let porosity = 0.0;
  let sss = 0.0;
  if (b <= 64) {
    porosity = b / 64.0;
  } else {
    sss = (b - 65) / 190.0;
  }

  const emissive = a > 0 ? a / 255.0 : 0.0;

  return {
    smoothness,
    roughness,
    alpha,
    metalness,
    f0,
    porosity,
    sss,
    emissive
  };
}

// ---------------------------------------------------------------------------
// 3. GGX / Cook-Torrance Microfacet BRDF Evaluator
// ---------------------------------------------------------------------------

export function evaluateGGX_D(NdotH, alpha) {
  const alpha2 = alpha * alpha;
  const cos2 = NdotH * NdotH;
  const denom = cos2 * (alpha2 - 1.0) + 1.0;
  return alpha2 / Math.max(1e-7, Math.PI * denom * denom);
}

export function evaluateSmith_G1(NdotX, alpha) {
  const alpha2 = alpha * alpha;
  return (2.0 * NdotX) / Math.max(1e-7, NdotX + Math.sqrt(alpha2 + (1.0 - alpha2) * NdotX * NdotX));
}

export function evaluateSmith_G(NdotV, NdotL, alpha) {
  return evaluateSmith_G1(NdotV, alpha) * evaluateSmith_G1(NdotL, alpha);
}

export function evaluateSchlick_F(VdotH, f0) {
  const factor = Math.pow(Math.max(0.0, 1.0 - VdotH), 5.0);
  return [
    f0[0] + (1.0 - f0[0]) * factor,
    f0[1] + (1.0 - f0[1]) * factor,
    f0[2] + (1.0 - f0[2]) * factor
  ];
}

/**
 * Evaluates the full BRDF for a single surface point under directional and ambient lighting.
 */
export function shadePixel({
  albedo,
  normal,
  specular,
  viewDir,
  lightDir,
  lightColor = [1.0, 1.0, 1.0],
  ambientColor = [0.15, 0.15, 0.15],
  emissionBoost = 2.0
}) {
  const N = normal;
  const V = vec3Normalize(viewDir);
  const L = vec3Normalize(lightDir);
  const H = vec3Normalize(vec3Add(V, L));

  const NdotL = Math.max(0.0, vec3Dot(N, L));
  const NdotV = Math.max(0.001, vec3Dot(N, V));
  const NdotH = Math.max(0.0, vec3Dot(N, H));
  const VdotH = Math.max(0.0, vec3Dot(V, H));

  // 1. GGX Specular
  const D = evaluateGGX_D(NdotH, specular.alpha);
  const G = evaluateSmith_G(NdotV, NdotL, specular.alpha);
  const F = evaluateSchlick_F(VdotH, specular.f0);

  const specDenom = 4.0 * NdotV * NdotL + 1e-4;
  const fSpec = [
    (D * G * F[0]) / specDenom,
    (D * G * F[1]) / specDenom,
    (D * G * F[2]) / specDenom
  ];

  // 2. Lambertian Diffuse with Energy Conservation
  // Conductors have 0 diffuse reflection (all light absorbed or reflected specularly)
  const kD = [
    (1.0 - F[0]) * (1.0 - specular.metalness),
    (1.0 - F[1]) * (1.0 - specular.metalness),
    (1.0 - F[2]) * (1.0 - specular.metalness)
  ];

  const fDiffuse = [
    (kD[0] * albedo[0]) / Math.PI,
    (kD[1] * albedo[1]) / Math.PI,
    (kD[2] * albedo[2]) / Math.PI
  ];

  // 3. Direct Radiance Integration
  const directRadiance = [
    (fDiffuse[0] + fSpec[0]) * lightColor[0] * NdotL,
    (fDiffuse[1] + fSpec[1]) * lightColor[1] * NdotL,
    (fDiffuse[2] + fSpec[2]) * lightColor[2] * NdotL
  ];

  // 4. Ambient Radiance with AO Attenuation
  const aoFactor = specular.ao ?? 1.0;
  const ambientRadiance = [
    albedo[0] * ambientColor[0] * aoFactor,
    albedo[1] * ambientColor[1] * aoFactor,
    albedo[2] * ambientColor[2] * aoFactor
  ];

  // 5. Unshadowed Emissive Boost
  const emissiveRadiance = [
    albedo[0] * specular.emissive * emissionBoost,
    albedo[1] * specular.emissive * emissionBoost,
    albedo[2] * specular.emissive * emissionBoost
  ];

  return [
    directRadiance[0] + ambientRadiance[0] + emissiveRadiance[0],
    directRadiance[1] + ambientRadiance[1] + emissiveRadiance[1],
    directRadiance[2] + ambientRadiance[2] + emissiveRadiance[2]
  ];
}

// ---------------------------------------------------------------------------
// 4. Synthetic Reference Calibration Fixtures
// ---------------------------------------------------------------------------

/**
 * Builds a calibrated stone striation fixture with periodic normal relief and ambient occlusion crevices.
 */
export function createStoneStriationFixture(size = 64) {
  const albedo = new Float32Array(size * size * 3);
  const normalMap = new Uint8Array(size * size * 4);
  const specularMap = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const idx3 = idx * 3;
      const idx4 = idx * 4;

      // Albedo: Neutral Stone Gray (#7b7b7b -> [0.48, 0.48, 0.48])
      albedo[idx3 + 0] = 0.48;
      albedo[idx3 + 1] = 0.48;
      albedo[idx3 + 2] = 0.48;

      // Normal Map: Periodic striations with sharp relief and seamless wrapping
      // 2 complete wave cycles over width and height
      // Ensure toroidal periodicity between coordinate 0 and coordinate size - 1:
      const u = (x / (size - 1)) * Math.PI * 4;
      const v = (y / (size - 1)) * Math.PI * 4;
      const sinU = Math.abs(Math.sin(u)) < 1e-10 ? 0 : Math.sin(u);
      const nx = sinU * 0.55;
      const ny = Math.cos(v) * 0.30;

      // AO: Crevices (where sin(u) is deeply negative) have stronger ambient occlusion
      const aoVal = Math.max(0.35, 0.70 + 0.30 * sinU);

      // Encode into LabPBR 1.3:
      // R = (Nx + 1) * 0.5 * 255
      // G = (1.0 - Ny) * 0.5 * 255 (DirectX Y- inversion)
      // B = AO
      // A = Height (0.5 + 0.4 * sin(u))
      normalMap[idx4 + 0] = Math.round(((nx + 1.0) * 0.5) * 255);
      normalMap[idx4 + 1] = Math.round(((1.0 - ny) * 0.5) * 255);
      normalMap[idx4 + 2] = Math.round(aoVal * 255);
      normalMap[idx4 + 3] = Math.round((0.5 + 0.4 * sinU) * 255);

      // Specular Map: Low-smoothness dielectric stone matrix
      specularMap[idx4 + 0] = 31;  // Smoothness ~0.12 (Roughness ~0.88)
      specularMap[idx4 + 1] = 64;  // Dielectric mineral F0 (~0.04)
      specularMap[idx4 + 2] = 10;  // Low porosity
      specularMap[idx4 + 3] = 0;   // Inert (non-emissive)
    }
  }

  return { size, albedo, normalMap, specularMap };
}

/**
 * Builds a calibrated diamond ore fixture with low-smoothness stone matrix and high-smoothness glowing crystal.
 */
export function createDiamondOreFixture(size = 64) {
  const albedo = new Float32Array(size * size * 3);
  const normalMap = new Uint8Array(size * size * 4);
  const specularMap = new Uint8Array(size * size * 4);
  const crystalMask = new Uint8Array(size * size);

  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.22;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const idx3 = idx * 3;
      const idx4 = idx * 4;

      const dist = Math.hypot(x - cx, y - cy);
      const isDiamond = dist <= radius;
      crystalMask[idx] = isDiamond ? 1 : 0;

      if (isDiamond) {
        // Diamond Crystal: Vibrant Cyan (#4dedf0 -> [0.30, 0.93, 0.94])
        albedo[idx3 + 0] = 0.30;
        albedo[idx3 + 1] = 0.93;
        albedo[idx3 + 2] = 0.94;

        // Normal: Beveled facet pointing towards center
        const fnx = (x - cx) / radius * 0.3;
        const fny = (y - cy) / radius * 0.3;
        normalMap[idx4 + 0] = Math.round(((fnx + 1.0) * 0.5) * 255);
        normalMap[idx4 + 1] = Math.round(((1.0 - fny) * 0.5) * 255);
        normalMap[idx4 + 2] = 255; // 1.0 AO (exposed crystal)
        normalMap[idx4 + 3] = 250; // Elevated height

        // Specular: High smoothness (0.92), dielectric F0 (0.04), emissive glow (A = 180)
        specularMap[idx4 + 0] = 235; // Smoothness ~0.92
        specularMap[idx4 + 1] = 64;  // Dielectric mineral F0 (~0.04)
        specularMap[idx4 + 2] = 0;   // Zero porosity
        specularMap[idx4 + 3] = 180; // Emissive glow core
      } else {
        // Stone Matrix: Neutral Stone Gray
        albedo[idx3 + 0] = 0.48;
        albedo[idx3 + 1] = 0.48;
        albedo[idx3 + 2] = 0.48;

        normalMap[idx4 + 0] = 128;
        normalMap[idx4 + 1] = 128;
        normalMap[idx4 + 2] = 240;
        normalMap[idx4 + 3] = 128;

        specularMap[idx4 + 0] = 31;  // Smoothness ~0.12
        specularMap[idx4 + 1] = 64;  // Dielectric F0
        specularMap[idx4 + 2] = 10;
        specularMap[idx4 + 3] = 0;   // Non-emissive
      }
    }
  }

  return { size, albedo, normalMap, specularMap, crystalMask };
}

/**
 * Builds a calibrated metallicity fixture: Left side dielectric, Right side metallic gold conductor.
 */
export function createMetallicityFixture(size = 64) {
  const albedo = new Float32Array(size * size * 3);
  const normalMap = new Uint8Array(size * size * 4);
  const specularMap = new Uint8Array(size * size * 4);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const idx3 = idx * 3;
      const idx4 = idx * 4;

      const isMetal = x >= size / 2;

      normalMap[idx4 + 0] = 128;
      normalMap[idx4 + 1] = 128;
      normalMap[idx4 + 2] = 255;
      normalMap[idx4 + 3] = 128;

      if (isMetal) {
        // Metallic Gold: Base albedo [1.0, 0.85, 0.35]
        albedo[idx3 + 0] = 1.00;
        albedo[idx3 + 1] = 0.85;
        albedo[idx3 + 2] = 0.35;

        specularMap[idx4 + 0] = 200; // Smoothness ~0.78
        specularMap[idx4 + 1] = 230; // LabPBR Conductor (G >= 230)
        specularMap[idx4 + 2] = 0;
        specularMap[idx4 + 3] = 0;
      } else {
        // Dielectric Quartz: Base albedo [0.90, 0.90, 0.90]
        albedo[idx3 + 0] = 0.90;
        albedo[idx3 + 1] = 0.90;
        albedo[idx3 + 2] = 0.90;

        specularMap[idx4 + 0] = 200; // Smoothness ~0.78
        specularMap[idx4 + 1] = 64;  // Dielectric (G < 230)
        specularMap[idx4 + 2] = 0;
        specularMap[idx4 + 3] = 0;
      }
    }
  }

  return { size, albedo, normalMap, specularMap };
}

/**
 * Shaded Quad Renderer: Simulates shading across the entire grid and returns Float32Array RGB radiance.
 */
export function renderShadedQuad(fixture, lightingParams) {
  const { size, albedo, normalMap, specularMap } = fixture;
  const outRadiance = new Float32Array(size * size * 3);

  for (let i = 0; i < size * size; i++) {
    const idx3 = i * 3;
    const idx4 = i * 4;

    const alb = [albedo[idx3 + 0], albedo[idx3 + 1], albedo[idx3 + 2]];
    const nUnpacked = unpackNormal(
      normalMap[idx4 + 0],
      normalMap[idx4 + 1],
      normalMap[idx4 + 2],
      normalMap[idx4 + 3]
    );
    const sUnpacked = unpackSpecular(
      specularMap[idx4 + 0],
      specularMap[idx4 + 1],
      specularMap[idx4 + 2],
      specularMap[idx4 + 3],
      alb
    );

    sUnpacked.ao = nUnpacked.ao;

    const shaded = shadePixel({
      albedo: alb,
      normal: nUnpacked.normal,
      specular: sUnpacked,
      viewDir: lightingParams.viewDir,
      lightDir: lightingParams.lightDir,
      lightColor: lightingParams.lightColor,
      ambientColor: lightingParams.ambientColor,
      emissionBoost: lightingParams.emissionBoost ?? 2.0
    });

    outRadiance[idx3 + 0] = shaded[0];
    outRadiance[idx3 + 1] = shaded[1];
    outRadiance[idx3 + 2] = shaded[2];
  }

  return outRadiance;
}

// ---------------------------------------------------------------------------
// 5. Minimal Dependency-Free PNG Exporter (node:zlib)
// ---------------------------------------------------------------------------

function writeUInt32BE(buf, value, offset) {
  buf.writeUInt32BE(value, offset);
}

function crc32(buf) {
  let crc = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

export function encodeRawRgbaToPng(width, height, rgbaBuffer) {
  const scanlineLength = width * 4 + 1;
  const rawData = Buffer.alloc(height * scanlineLength);

  for (let y = 0; y < height; y++) {
    const dstOffset = y * scanlineLength;
    rawData[dstOffset] = 0; // Filter: None
    rgbaBuffer.copy(rawData, dstOffset + 1, y * width * 4, (y + 1) * width * 4);
  }

  const deflated = zlib.deflateSync(rawData);

  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  writeUInt32BE(ihdr, width, 0);
  writeUInt32BE(ihdr, height, 4);
  ihdr[8] = 8; // Bit depth: 8
  ihdr[9] = 6; // Color type: RGBA (6)
  ihdr[10] = 0; // Compression
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", deflated);
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([pngSignature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = data.length;
  const buf = Buffer.alloc(8 + len + 4);
  buf.writeUInt32BE(len, 0);
  buf.write(type, 4, 4, "ascii");
  data.copy(buf, 8);
  const crcData = buf.subarray(4, 8 + len);
  buf.writeUInt32BE(crc32(crcData), 8 + len);
  return buf;
}

// ---------------------------------------------------------------------------
// 6. Test Suite Definitions
// ---------------------------------------------------------------------------

export async function runShaderCalibrationSuite(options = {}) {
  const { render = false, verbose = false } = options;

  console.log("\n=======================================================");
  console.log("  KEYFRAME LABPBR 1.3 SHADERPACK CALIBRATION HARNESS  ");
  console.log("  Target Profile: Complementary Reimagined / Iris / Sodium");
  console.log(`  Export Render PNGs: ${render ? "YES" : "NO"}`);
  console.log("=======================================================\n");

  if (render) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  // -------------------------------------------------------------------------
  // [Suite 1] Vector Mathematics & LabPBR Tangent Space Unpacking
  // -------------------------------------------------------------------------
  console.log("[Suite 1] Vector Mathematics & LabPBR Tangent Space Unpacking");
  {
    const flat = unpackNormal(128, 128, 255, 128);
    assertCloseTo(flat.normal[0], 0.0, 0.02, "Flat normal Nx centers at 0.0");
    assertCloseTo(flat.normal[1], 0.0, 0.02, "Flat normal Ny centers at 0.0");
    assertCloseTo(flat.normal[2], 1.0, 0.02, "Flat normal Nz reconstructs to 1.0");
    assertEqual(flat.ao, 1.0, "AO unpacked from Blue channel 255 yields 1.0");

    // DirectX Y- Inversion Test:
    // LabPBR Green channel: 0 = +Y Up, 255 = -Y Down.
    // In our unpacked +Y Up coordinate space:
    // Green = 64 (<128) must yield positive Ny > 0
    // Green = 192 (>128) must yield negative Ny < 0
    const upNormal = unpackNormal(128, 64, 255, 128);
    assert(upNormal.normal[1] > 0.4, "LabPBR DirectX G=64 unpacks to positive +Y Up (Ny > 0)");

    const downNormal = unpackNormal(128, 192, 255, 128);
    assert(downNormal.normal[1] < -0.4, "LabPBR DirectX G=192 unpacks to negative -Y Down (Ny < 0)");

    // Roughness & Smoothness Mapping
    const specMatte = unpackSpecular(0, 64, 0, 0);
    assertEqual(specMatte.smoothness, 0.0, "Smoothness R=0 maps to 0.0");
    assertEqual(specMatte.roughness, 1.0, "Roughness for R=0 maps to 1.0");
    assertEqual(specMatte.alpha, 1.0, "Linear roughness alpha for matte is 1.0");

    const specMirror = unpackSpecular(255, 64, 0, 0);
    assertEqual(specMirror.smoothness, 1.0, "Smoothness R=255 maps to 1.0");
    assertEqual(specMirror.roughness, 0.0, "Roughness for R=255 maps to 0.0");
    assertEqual(specMirror.alpha, 0.001, "Linear roughness alpha clamped to 0.001 minimum");

    // Dielectric vs Conductor Classification
    const dielectric = unpackSpecular(128, 64, 0, 0);
    assertEqual(dielectric.metalness, 0.0, "Green < 230 classifies as Dielectric (metalness = 0.0)");

    const conductor = unpackSpecular(128, 230, 0, 0, [0.8, 0.5, 0.2]);
    assertEqual(conductor.metalness, 1.0, "Green >= 230 classifies as Conductor (metalness = 1.0)");
    assertEqual(conductor.f0[0], 0.8, "Conductor F0 tints to red albedo component");
    assertEqual(conductor.f0[1], 0.5, "Conductor F0 tints to green albedo component");
    assertEqual(conductor.f0[2], 0.2, "Conductor F0 tints to blue albedo component");
  }

  // -------------------------------------------------------------------------
  // [Suite 2] Grazing Light Angle Relief Calibration
  // -------------------------------------------------------------------------
  console.log("\n[Suite 2] Grazing Light Angle Relief Calibration");
  {
    const fixture = createStoneStriationFixture(64);

    // Directional grazing light at 75° zenith angle (15° elevation from surface)
    // L = normalize([cos(15°), 0, sin(15°)])
    const elevRad = (15.0 * Math.PI) / 180.0;
    const lightDir = vec3Normalize([Math.cos(elevRad), 0, Math.sin(elevRad)]);
    const viewDir = [0, 0, 1]; // Top-down camera view

    const shaded = renderShadedQuad(fixture, {
      viewDir,
      lightDir,
      lightColor: [1.8, 1.8, 1.8],
      ambientColor: [0.03, 0.03, 0.03]
    });

    // Compute luminance values across all pixels
    const size = fixture.size;
    let sumY = 0;
    let minLum = Infinity;
    let maxLum = -Infinity;
    const lums = new Float32Array(size * size);

    for (let i = 0; i < size * size; i++) {
      const r = shaded[i * 3 + 0];
      const g = shaded[i * 3 + 1];
      const b = shaded[i * 3 + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lums[i] = lum;
      sumY += lum;
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
    }

    const meanY = sumY / (size * size);
    let varianceY = 0;
    for (let i = 0; i < size * size; i++) {
      const d = lums[i] - meanY;
      varianceY += d * d;
    }
    const stdDevY = Math.sqrt(varianceY / (size * size));
    const coefVariation = stdDevY / meanY;
    const contrastRatio = maxLum / Math.max(1e-4, minLum);

    if (verbose) {
      console.log(`    Grazing Light: Mean=${meanY.toFixed(3)}, StdDev=${stdDevY.toFixed(3)}, CV=${coefVariation.toFixed(3)}, Contrast=${contrastRatio.toFixed(2)}x`);
    }

    assert(coefVariation >= 0.40, `Grazing light relief contrast CV=${coefVariation.toFixed(3)} exceeds contract (>= 0.40)`);
    assert(contrastRatio >= 5.0, `Peak-to-trough relief contrast ratio ${contrastRatio.toFixed(2)}x exceeds contract (>= 5.0x)`);

    if (render) {
      exportFixturePng("grazing_relief_fixture.png", size, shaded);
    }
  }

  // -------------------------------------------------------------------------
  // [Suite 3] Specular Highlight Calibration (Diamond Gleam vs Stone Matrix)
  // -------------------------------------------------------------------------
  console.log("\n[Suite 3] Specular Highlight Calibration (Diamond Gleam vs Stone Matrix)");
  {
    const fixture = createDiamondOreFixture(64);

    // Specular reflection setup at 45° incidence:
    // View vector from top-south [0, -sin(45°), cos(45°)]
    // Light vector from top-north [0, sin(45°), cos(45°)]
    const rad45 = (45.0 * Math.PI) / 180.0;
    const viewDir = vec3Normalize([0, -Math.sin(rad45), Math.cos(rad45)]);
    const lightDir = vec3Normalize([0, Math.sin(rad45), Math.cos(rad45)]);

    const shaded = renderShadedQuad(fixture, {
      viewDir,
      lightDir,
      lightColor: [2.0, 2.0, 2.0],
      ambientColor: [0.05, 0.05, 0.05]
    });

    const size = fixture.size;
    let maxDiamondLum = 0;
    let avgStoneLum = 0;
    let stoneCount = 0;

    for (let i = 0; i < size * size; i++) {
      const r = shaded[i * 3 + 0];
      const g = shaded[i * 3 + 1];
      const b = shaded[i * 3 + 2];
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;

      if (fixture.crystalMask[i] === 1) {
        if (lum > maxDiamondLum) maxDiamondLum = lum;
      } else {
        avgStoneLum += lum;
        stoneCount++;
      }
    }
    avgStoneLum /= stoneCount;

    const specularContrast = maxDiamondLum / Math.max(1e-4, avgStoneLum);

    if (verbose) {
      console.log(`    Specular Peak: Diamond=${maxDiamondLum.toFixed(3)}, Stone Avg=${avgStoneLum.toFixed(3)}, Ratio=${specularContrast.toFixed(2)}x`);
    }

    assert(maxDiamondLum >= 5.0, `Diamond crystal specular highlight lum=${maxDiamondLum.toFixed(2)} produces brilliant gleam (>= 5.0)`);
    assert(specularContrast >= 25.0, `Diamond-to-stone specular contrast ratio ${specularContrast.toFixed(1)}x exceeds contract (>= 25.0x)`);

    if (render) {
      exportFixturePng("specular_diamond_gleam.png", size, shaded);
    }
  }

  // -------------------------------------------------------------------------
  // [Suite 4] Metallicity & Conductor Tinting Calibration
  // -------------------------------------------------------------------------
  console.log("\n[Suite 4] Metallicity & Conductor Tinting Calibration");
  {
    const fixture = createMetallicityFixture(64);

    // Warm directional illumination [1.0, 0.90, 0.70]
    const viewDir = [0, 0, 1];
    const lightDir = [0, 0, 1];

    const shaded = renderShadedQuad(fixture, {
      viewDir,
      lightDir,
      lightColor: [1.0, 0.90, 0.70],
      ambientColor: [0, 0, 0] // Zero ambient to isolate BRDF reflectance
    });

    const size = fixture.size;
    // Sample dielectric pixel (left side)
    const dIdx = (size / 2) * size + Math.round(size * 0.25);
    const dR = shaded[dIdx * 3 + 0];
    const dG = shaded[dIdx * 3 + 1];
    const dB = shaded[dIdx * 3 + 2];

    // Sample conductor gold pixel (right side)
    const mIdx = (size / 2) * size + Math.round(size * 0.75);
    const mR = shaded[mIdx * 3 + 0];
    const mG = shaded[mIdx * 3 + 1];
    const mB = shaded[mIdx * 3 + 2];

    // Conductor gold specular tint: Red > Green > Blue (matches golden albedo [1.0, 0.85, 0.35])
    assert(mR > mG && mG > mB, `Metallic conductor reflection preserves golden chromatic tint (R=${mR.toFixed(2)} > G=${mG.toFixed(2)} > B=${mB.toFixed(2)})`);

    // Dielectric reflection: Blue channel maintains neutral ratio
    const dRatio = dB / dR;
    const mRatio = mB / mR;
    assert(mRatio < dRatio * 0.6, `Conductor suppresses blue specular reflection (mRatio=${mRatio.toFixed(2)} < dRatio=${dRatio.toFixed(2)})`);

    if (render) {
      exportFixturePng("metallicity_tinting.png", size, shaded);
    }
  }

  // -------------------------------------------------------------------------
  // [Suite 5] Emissive Boost & Shadow Immunity Calibration
  // -------------------------------------------------------------------------
  console.log("\n[Suite 5] Emissive Boost & Shadow Immunity Calibration");
  {
    const fixture = createDiamondOreFixture(64);

    // Zero direct and ambient lighting (complete darkness / eclipse)
    const shadedDarkness = renderShadedQuad(fixture, {
      viewDir: [0, 0, 1],
      lightDir: [0, 0, -1], // Direction away from surface (N.L = 0)
      lightColor: [0, 0, 0],
      ambientColor: [0, 0, 0],
      emissionBoost: 2.0
    });

    const size = fixture.size;
    let maxDiamondEmissive = 0;
    let maxStoneEmissive = 0;

    for (let i = 0; i < size * size; i++) {
      const lum = 0.2126 * shadedDarkness[i * 3 + 0] +
                  0.7152 * shadedDarkness[i * 3 + 1] +
                  0.0722 * shadedDarkness[i * 3 + 2];

      if (fixture.crystalMask[i] === 1) {
        if (lum > maxDiamondEmissive) maxDiamondEmissive = lum;
      } else {
        if (lum > maxStoneEmissive) maxStoneEmissive = lum;
      }
    }

    assertEqual(maxStoneEmissive, 0.0, "Non-emissive stone matrix emits strictly 0.0 radiance in darkness");
    assert(maxDiamondEmissive > 1.0, `Emissive diamond core emits unshadowed radiance (${maxDiamondEmissive.toFixed(2)} > 1.0) in total darkness`);

    if (render) {
      exportFixturePng("emissive_glow_darkness.png", size, shadedDarkness);
    }
  }

  // -------------------------------------------------------------------------
  // [Suite 6] Toroidal Boundary Continuity Under Dynamic Lighting
  // -------------------------------------------------------------------------
  console.log("\n[Suite 6] Toroidal Boundary Continuity Under Dynamic Lighting");
  {
    const fixture = createStoneStriationFixture(64);
    const size = fixture.size;

    // Asymmetric off-axis directional light
    const lightDir = vec3Normalize([0.65, 0.45, 0.60]);
    const viewDir = vec3Normalize([0.15, -0.25, 0.95]);

    const shaded = renderShadedQuad(fixture, {
      viewDir,
      lightDir,
      lightColor: [1.5, 1.4, 1.2],
      ambientColor: [0.15, 0.15, 0.15]
    });

    // Check boundary differences: X=0 vs X=size-1, Y=0 vs Y=size-1
    let xSeamDiscontinuity = 0;
    let ySeamDiscontinuity = 0;

    for (let y = 0; y < size; y++) {
      const idxLeft = (y * size + 0) * 3;
      const idxRight = (y * size + (size - 1)) * 3;
      const dr = Math.abs(shaded[idxLeft + 0] - shaded[idxRight + 0]);
      const dg = Math.abs(shaded[idxLeft + 1] - shaded[idxRight + 1]);
      const db = Math.abs(shaded[idxLeft + 2] - shaded[idxRight + 2]);
      xSeamDiscontinuity = Math.max(xSeamDiscontinuity, dr + dg + db);
    }

    for (let x = 0; x < size; x++) {
      const idxTop = (0 * size + x) * 3;
      const idxBottom = ((size - 1) * size + x) * 3;
      const dr = Math.abs(shaded[idxTop + 0] - shaded[idxBottom + 0]);
      const dg = Math.abs(shaded[idxTop + 1] - shaded[idxBottom + 1]);
      const db = Math.abs(shaded[idxTop + 2] - shaded[idxBottom + 2]);
      ySeamDiscontinuity = Math.max(ySeamDiscontinuity, dr + dg + db);
    }

    if (verbose) {
      console.log(`    Toroidal Seam: ΔX=${xSeamDiscontinuity.toFixed(5)}, ΔY=${ySeamDiscontinuity.toFixed(5)}`);
    }

    assert(xSeamDiscontinuity < 1e-4, `Toroidal X-seam discontinuity ΔX=${xSeamDiscontinuity.toFixed(6)} satisfies seamless lighting tolerance (< 1e-4)`);
    assert(ySeamDiscontinuity < 1e-4, `Toroidal Y-seam discontinuity ΔY=${ySeamDiscontinuity.toFixed(6)} satisfies seamless lighting tolerance (< 1e-4)`);

    if (render) {
      exportFixturePng("toroidal_shaded_stone.png", size, shaded);
    }
  }

  // -------------------------------------------------------------------------
  // [Suite 7] Repository & CI Pipeline Wiring Verification
  // -------------------------------------------------------------------------
  console.log("\n[Suite 7] Repository & CI Pipeline Wiring Verification");
  {
    const pkgPath = path.join(ROOT_DIR, "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const scripts = pkg.scripts || {};

    assert(Boolean(scripts["test:shader-fixtures"]), "package.json exposes test:shader-fixtures");
    assert(
      typeof scripts.test === "string" && scripts.test.includes("test-shader-fixtures.mjs"),
      "npm test runs this shader calibration fixtures harness"
    );

    const ciPath = path.join(ROOT_DIR, ".github", "workflows", "ci.yml");
    const ciContent = fs.readFileSync(ciPath, "utf-8");

    assert(
      ciContent.includes("npm run test:shader-fixtures"),
      ".github/workflows/ci.yml runs test:shader-fixtures as its own step"
    );
    assert(
      ciContent.includes("persist-credentials: false"),
      ".github/workflows/ci.yml maintains persist-credentials: false (N6-CI-08)"
    );
  }

  // -------------------------------------------------------------------------
  // Results
  // -------------------------------------------------------------------------
  console.log("\n=======================================================");
  console.log(`  RESULTS: ${passedTests}/${totalTests} tests passed`);
  console.log("=======================================================\n");

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

function exportFixturePng(filename, size, radianceArray) {
  const outPath = path.join(DIST_DIR, filename);
  const rgbaBuffer = Buffer.alloc(size * size * 4);

  for (let i = 0; i < size * size; i++) {
    // Tonemapping & gamma encoding (sRGB approx) for PNG preview
    const rLinear = Math.min(1.0, Math.max(0.0, radianceArray[i * 3 + 0]));
    const gLinear = Math.min(1.0, Math.max(0.0, radianceArray[i * 3 + 1]));
    const bLinear = Math.min(1.0, Math.max(0.0, radianceArray[i * 3 + 2]));

    const rGamma = Math.pow(rLinear, 1.0 / 2.2);
    const gGamma = Math.pow(gLinear, 1.0 / 2.2);
    const bGamma = Math.pow(bLinear, 1.0 / 2.2);

    rgbaBuffer[i * 4 + 0] = Math.round(rGamma * 255);
    rgbaBuffer[i * 4 + 1] = Math.round(gGamma * 255);
    rgbaBuffer[i * 4 + 2] = Math.round(bGamma * 255);
    rgbaBuffer[i * 4 + 3] = 255;
  }

  const pngBuf = encodeRawRgbaToPng(size, size, rgbaBuffer);
  fs.writeFileSync(outPath, pngBuf);
  console.log(`    [PNG] Exported preview: ${outPath}`);
}

// ---------------------------------------------------------------------------
// CLI Execution
// ---------------------------------------------------------------------------

function parseCliArgs() {
  const args = process.argv.slice(2);
  const options = {
    render: false,
    verbose: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--render") {
      options.render = true;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(`
Keyframe LabPBR 1.3 Shader Calibration Harness

Usage:
  node tools/test-shader-fixtures.mjs [options]

Options:
  --render         Export rendered shaded fixtures as PNG to dist/shader_fixtures/
  --verbose, -v    Output quantitative photometric metrics for each fixture
  --help, -h       Display this help message
      `);
      process.exit(0);
    }
  }

  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const options = parseCliArgs();
  runShaderCalibrationSuite(options).catch((err) => {
    console.error(`\nSuite terminated with error: ${err.message}`);
    process.exit(1);
  });
}

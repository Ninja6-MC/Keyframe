import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Resvg } from "@resvg/resvg-js";

const require = createRequire(import.meta.url);
const archiver = require("archiver");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const TEXTURES_DIR = path.join(ROOT_DIR, "textures");
const TEMPLATE_DIR = path.join(ROOT_DIR, "pack_template");
const DIST_DIR = path.join(ROOT_DIR, "dist");

/**
 * Creates a clean POSIX zip archive using pure Node.js (cross-platform Linux/Win/macOS)
 */
function createZipArchive(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = new archiver.ZipArchive({
      zlib: { level: 9 }
    });

    output.on("close", () => resolve());
    archive.on("error", (err) => reject(err));

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

/**
 * Keyframe Resource Pack Compiler
 */
export async function buildResourcePack(targetRes = 512) {
  console.log(`\n======================================================`);
  console.log(`  Keyframe Resource Pack Compiler`);
  console.log(`  Target Resolution: ${targetRes}×${targetRes}`);
  console.log(`======================================================\n`);

  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  const BUILD_TMP = path.join(ROOT_DIR, "cache", `build_tmp_${targetRes}`);
  if (fs.existsSync(BUILD_TMP)) {
    fs.rmSync(BUILD_TMP, { recursive: true, force: true });
  }

  const BLOCKS_DIR = path.join(BUILD_TMP, "assets", "minecraft", "textures", "block");
  const ITEMS_DIR = path.join(BUILD_TMP, "assets", "minecraft", "textures", "item");
  fs.mkdirSync(BLOCKS_DIR, { recursive: true });
  fs.mkdirSync(ITEMS_DIR, { recursive: true });

  // 1. Generate pack.mcmeta (Universal 1.20 - 1.21.4+ support)
  const mcmeta = {
    pack: {
      pack_format: 46,
      supported_formats: {
        min_inclusive: 15,
        max_inclusive: 46
      },
      description: `§6Keyframe §8- §a${targetRes}x§r\n§7The Cinematic Trailer Vector Pack`
    }
  };

  fs.writeFileSync(path.join(BUILD_TMP, "pack.mcmeta"), JSON.stringify(mcmeta, null, 2), "utf-8");
  console.log(`[1/4] Created pack.mcmeta (Supported Formats: 1.20 - 1.21.4+)`);

function generateWaterStillStripSvg(frameCount = 16) {
  const frames = [];
  for (let f = 0; f < frameCount; f++) {
    const phi = (2 * Math.PI * f) / frameCount;
    const dy1 = Math.sin(phi) * 18;
    const dx1 = Math.cos(phi) * 22;
    const dy2 = Math.sin(phi + 1.6) * 16;
    const dx2 = Math.cos(phi + 1.6) * 20;

    frames.push(`
    <g transform="translate(0, ${f * 512})">
      <defs>
        <radialGradient id="caustic_g1_${f}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.20" />
          <stop offset="60%" stop-color="#ffffff" stop-opacity="0.08" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0.0" />
        </radialGradient>
        <radialGradient id="caustic_g2_${f}" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.18" />
          <stop offset="70%" stop-color="#ffffff" stop-opacity="0.06" />
          <stop offset="100%" stop-color="#ffffff" stop-opacity="0.0" />
        </radialGradient>
      </defs>

      <!-- Base Translucent Aquatic Surface (48% opacity, crystal clear) -->
      <rect width="512" height="512" fill="#b6b6b6" fill-opacity="0.48" />

      <!-- Broad Soft Toroidal Rolling Wave Swells (Zero wireframe lines) -->
      <path d="M 0 ${160 + dy1} C 128 ${110 + dy1}, 256 ${190 + dy2}, 384 ${140 + dy1} C 448 ${115 + dy2}, 480 ${135 + dy1}, 512 ${160 + dy1} L 512 ${220 + dy1} C 480 ${195 + dy1}, 448 ${175 + dy2}, 384 ${200 + dy1} C 256 ${250 + dy2}, 128 ${170 + dy1}, 0 ${220 + dy1} Z" fill="url(#caustic_g1_${f})" />

      <path d="M 0 ${390 + dy2} C 128 ${340 + dy2}, 256 ${420 + dy1}, 384 ${370 + dy2} C 448 ${345 + dy1}, 480 ${365 + dy2}, 512 ${390 + dy2} L 512 ${450 + dy2} C 480 ${425 + dy2}, 448 ${405 + dy1}, 384 ${430 + dy2} C 256 ${480 + dy1}, 128 ${400 + dy2}, 0 ${450 + dy2} Z" fill="url(#caustic_g2_${f})" />

      <!-- Diffuse Sunlit Shimmer Patches -->
      <ellipse cx="${160 + dx1}" cy="${120 + dy1}" rx="100" ry="55" fill="url(#caustic_g1_${f})" />
      <ellipse cx="${390 + dx2}" cy="${270 + dy2}" rx="110" ry="60" fill="url(#caustic_g2_${f})" />
      <ellipse cx="${210 + dx1}" cy="${420 + dy1}" rx="105" ry="55" fill="url(#caustic_g1_${f})" />
    </g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 ${512 * frameCount}" width="512" height="${512 * frameCount}">${frames.join("\n")}</svg>`;
}

function generateWaterFlowStripSvg(frameCount = 16) {
  const frames = [];
  const W = 1024;
  for (let f = 0; f < frameCount; f++) {
    const shiftY = (W * f) / frameCount;

    frames.push(`
    <g transform="translate(0, ${f * W})">
      <!-- Frame ${f} Base Translucent Flowing Water (#c8c8c8 at 48% opacity) -->
      <rect width="${W}" height="${W}" fill="#c8c8c8" fill-opacity="0.48" />

      <!-- Smooth Directional Downstream Currents -->
      <g id="flow_currents_${f}" stroke="#ffffff" stroke-opacity="0.45" stroke-width="24" stroke-linecap="round" fill="none">
        <path d="M 128 0 C 128 256, 192 512, 128 1024" />
        <path d="M 384 0 C 448 256, 320 512, 384 1024" />
        <path d="M 640 0 C 608 256, 704 512, 640 1024" />
        <path d="M 896 0 C 928 256, 864 512, 896 1024" />
      </g>

      <!-- Downstream Ripple Crests -->
      <g stroke="#ffffff" stroke-opacity="0.65" stroke-width="8" stroke-linecap="round" fill="none">
        <path d="M 0 ${(shiftY + 256) % W} Q 256 ${(shiftY + 320) % W}, 512 ${(shiftY + 256) % W} T 1024 ${(shiftY + 256) % W}" />
        <path d="M 0 ${(shiftY + 768) % W} Q 256 ${(shiftY + 832) % W}, 512 ${(shiftY + 768) % W} T 1024 ${(shiftY + 768) % W}" />
      </g>
    </g>`);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${W * frameCount}" width="${W}" height="${W * frameCount}">${frames.join("\n")}</svg>`;
}

  // 2. High-Speed Rust Resvg Rasterization
  const svgFiles = fs.readdirSync(TEXTURES_DIR).filter((f) => f.endsWith(".svg"));
  const ITEM_IDS = new Set(["cooked_beef", "golden_apple", "compass_nexus", "plot_compass", "spiral_core", "ninja6_token"]);

  function rasterize(srcSvgTextOrPath, destPngPath, size) {
    const svgText = srcSvgTextOrPath.startsWith("<svg") ? srcSvgTextOrPath : fs.readFileSync(srcSvgTextOrPath, "utf-8");
    const resvg = new Resvg(svgText, {
      fitTo: {
        mode: "width",
        value: size
      }
    });
    const pngData = resvg.render();
    fs.writeFileSync(destPngPath, pngData.asPng());
  }

  console.log(`[2/4] Rasterizing ${svgFiles.length} vector textures to ${targetRes}×${targetRes} PNG...`);

  for (const svgFile of svgFiles) {
    const stem = path.basename(svgFile, ".svg");
    const isItem = ITEM_IDS.has(stem);
    const targetDir = isItem ? ITEMS_DIR : BLOCKS_DIR;
    const destPng = path.join(targetDir, `${stem}.png`);
    const srcSvg = path.join(TEXTURES_DIR, svgFile);

    if (stem === "water_still") {
      // 16-frame animated vertical sprite strip with smooth 60fps interpolation
      const stripSvg = generateWaterStillStripSvg(16);
      rasterize(stripSvg, destPng, targetRes);
      console.log(`  ✓ block/water_still.png (16-Frame Animated Strip, ${targetRes}×${targetRes * 16})`);
    } else if (stem === "water_flow") {
      // Flowing water in Minecraft is 2x width (e.g. targetRes * 2)
      const flowRes = targetRes * 2;
      const stripSvg = generateWaterFlowStripSvg(16);
      rasterize(stripSvg, destPng, flowRes);
      console.log(`  ✓ block/water_flow.png (16-Frame Flow Strip, ${flowRes}×${flowRes * 16})`);
    } else {
      rasterize(srcSvg, destPng, targetRes);
      console.log(`  ✓ ${isItem ? "item" : "block"}/${stem}.png`);
    }
  }

  // 3. Bundle custom pack_template/assets (blockstates, models)
  const templateAssets = path.join(TEMPLATE_DIR, "assets");
  if (fs.existsSync(templateAssets)) {
    fs.cpSync(templateAssets, path.join(BUILD_TMP, "assets"), { recursive: true });
    console.log(`[3/5] Bundled pack_template/assets (un-rotated blockstates)`);
  }

  // 4. Generate pack.png (128x128 pack icon)
  const packIconDest = path.join(BUILD_TMP, "pack.png");
  const grassTopSvg = path.join(TEXTURES_DIR, "grass_block_top.svg");
  if (fs.existsSync(grassTopSvg)) {
    rasterize(grassTopSvg, packIconDest, 128);
  }
  console.log(`[4/5] Generated pack.png (128×128 icon)`);

  // 5. Package into clean Minecraft-compliant .ZIP (pure Node.js archiver)
  const zipFileName = `Keyframe-${targetRes}x.zip`;
  const zipOutputPath = path.join(DIST_DIR, zipFileName);

  if (fs.existsSync(zipOutputPath)) {
    fs.unlinkSync(zipOutputPath);
  }

  console.log(`[4/4] Creating pure cross-platform ZIP archive: ${zipFileName}...`);
  await createZipArchive(BUILD_TMP, zipOutputPath);

  // 6. Auto-sync clean .zip archive to local .minecraft/resourcepacks if present
  const mcResourcePacks = path.join(process.env.APPDATA || "", ".minecraft", "resourcepacks");
  if (fs.existsSync(mcResourcePacks)) {
    const destZip = path.join(mcResourcePacks, zipFileName);
    fs.copyFileSync(zipOutputPath, destZip);
    console.log(`[5/5] Auto-deployed to Minecraft: ${destZip}`);
  }

  const fileBuffer = fs.readFileSync(zipOutputPath);
  const sha1Hash = crypto.createHash("sha1").update(fileBuffer).digest("hex");
  const stats = fs.statSync(zipOutputPath);

  fs.rmSync(BUILD_TMP, { recursive: true, force: true });

  console.log(`\n======================================================`);
  console.log(`  ✓ BUILD SUCCESSFUL!`);
  console.log(`  File:    ${zipOutputPath}`);
  console.log(`  Size:    ${(stats.size / 1024).toFixed(1)} KB`);
  console.log(`  SHA-1:   ${sha1Hash}`);
  console.log(`======================================================\n`);

  return {
    filePath: zipOutputPath,
    fileName: zipFileName,
    sizeKb: (stats.size / 1024).toFixed(1),
    sha1: sha1Hash
  };
}

// CLI Execution Support
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--all")) {
    const resolutions = [512, 256, 128, 64, 32];
    for (const res of resolutions) {
      await buildResourcePack(res);
    }
  } else {
    let targetRes = 512;
    for (let i = 2; i < process.argv.length; i++) {
      if (process.argv[i] === "--res" && process.argv[i + 1]) {
        targetRes = parseInt(process.argv[i + 1], 10) || 512;
        i++;
      } else if (!isNaN(parseInt(process.argv[i], 10))) {
        targetRes = parseInt(process.argv[i], 10);
      }
    }
    await buildResourcePack(targetRes);
  }
}

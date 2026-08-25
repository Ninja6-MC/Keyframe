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
    const dx1 = Math.sin(phi) * 16;
    const dy1 = Math.cos(phi) * 12;
    const dx2 = Math.cos(phi) * 20;
    const dy2 = Math.sin(phi) * 14;
    const dx3 = Math.sin(phi + 1.2) * 15;
    const dy3 = Math.cos(phi + 1.2) * 18;
    const dx4 = Math.cos(phi + 2.1) * 18;
    const dy4 = Math.sin(phi + 2.1) * 16;

    frames.push(`
    <g transform="translate(0, ${f * 512})">
      <!-- Frame ${f} Base Translucent Aquatic Volume (48% opacity, crystal clear) -->
      <rect width="512" height="512" fill="#c8c8c8" fill-opacity="0.48" />

      <!-- Seamless Toroidal Caustic Lattice Web with Harmonic Phase Shift -->
      <g stroke="#ffffff" stroke-opacity="0.55" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none">
        <!-- Horizontal Web Struts -->
        <path d="M 0 ${128 + dy1} C ${64 + dx1} ${140 + dy1}, ${112 + dx2} ${96 + dy2}, ${176 + dx1} ${112 + dy1} C ${240 + dx2} ${128 + dy2}, ${272 + dx3} ${192 + dy3}, ${336 + dx2} ${176 + dy2} C ${400 + dx1} ${160 + dy1}, ${448 + dx2} ${112 + dy2}, 512 ${128 + dy1}" />
        <path d="M 0 ${384 + dy3} C ${64 + dx3} ${368 + dy3}, ${128 + dx4} ${416 + dy4}, ${192 + dx3} ${384 + dy3} C ${256 + dx4} ${352 + dy4}, ${304 + dx1} ${416 + dy1}, ${384 + dx4} ${400 + dy4} C ${448 + dx3} ${384 + dy3}, ${480 + dx4} ${368 + dy4}, 512 ${384 + dy3}" />
        
        <!-- Vertical Struts -->
        <path d="M ${128 + dx1} 0 C ${144 + dx2} ${64 + dy1}, ${160 + dx1} ${112 + dy2}, ${176 + dx2} ${192 + dy1} C ${192 + dx1} ${272 + dy2}, ${160 + dx2} ${336 + dy1}, ${192 + dx1} ${384 + dy2} C ${208 + dx2} ${432 + dy1}, ${176 + dx1} ${480 + dy2}, ${128 + dx1} 512" />
        <path d="M ${384 + dx3} 0 C ${368 + dx4} ${64 + dy3}, ${352 + dx3} ${128 + dy4}, ${336 + dx4} ${176 + dy3} C ${320 + dx3} ${256 + dy4}, ${368 + dx4} ${320 + dy3}, ${384 + dx3} ${400 + dy4} C ${400 + dx4} ${448 + dy3}, ${384 + dx3} ${480 + dy4}, ${384 + dx3} 512" />

        <!-- Interior Caustic Connectors -->
        <path d="M ${176 + dx1} ${112 + dy1} C ${208 + dx2} ${160 + dy2}, ${288 + dx3} ${144 + dy3}, ${336 + dx2} ${176 + dy2}" />
        <path d="M ${176 + dx2} ${192 + dy1} C ${240 + dx3} ${224 + dy2}, ${272 + dx4} ${240 + dy3}, ${336 + dx2} ${176 + dy2}" />
        <path d="M ${176 + dx2} ${192 + dy1} C ${208 + dx1} ${272 + dy2}, ${288 + dx2} ${288 + dy3}, ${320 + dx3} ${256 + dy4} C ${352 + dx2} ${224 + dy3}, ${368 + dx3} ${320 + dy2}, ${384 + dx4} ${400 + dy4}" />
        <path d="M ${176 + dx2} ${192 + dy1} C ${144 + dx1} ${256 + dy2}, ${160 + dx2} ${320 + dy3}, ${192 + dx3} ${384 + dy3}" />
        <path d="M ${192 + dx3} ${384 + dy3} C ${256 + dx4} ${368 + dy4}, ${320 + dx1} ${352 + dy1}, ${384 + dx4} ${400 + dy4}" />

        <!-- Toroidal Corner Bridges -->
        <path d="M 0 ${256 + dy2} C ${48 + dx1} ${240 + dy2}, ${96 + dx2} ${224 + dy1}, ${176 + dx2} ${192 + dy1}" />
        <path d="M 512 ${256 + dy2} C ${464 + dx3} ${240 + dy2}, ${416 + dx4} ${224 + dy1}, ${336 + dx2} ${176 + dy2}" />
      </g>

      <!-- Crisp Sunlit Glints -->
      <g stroke="#ffffff" stroke-opacity="0.80" stroke-width="5" stroke-linecap="round" fill="none">
        <path d="M ${176 + dx1} ${112 + dy1} C ${240 + dx2} ${128 + dy2}, ${272 + dx3} ${192 + dy3}, ${336 + dx2} ${176 + dy2}" />
        <path d="M ${192 + dx3} ${384 + dy3} C ${256 + dx4} ${352 + dy4}, ${304 + dx1} ${416 + dy1}, ${384 + dx4} ${400 + dy4}" />
        <path d="M 0 ${128 + dy1} C ${48 + dx1} ${136 + dy1}, ${96 + dx2} ${104 + dy2}, ${140 + dx1} ${108 + dy1}" />
        <path d="M 512 ${128 + dy1} C ${464 + dx3} ${120 + dy1}, ${432 + dx4} ${144 + dy2}, ${384 + dx3} ${140 + dy1}" />
      </g>
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

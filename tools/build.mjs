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

function generateWaterFlowStripSvg(frameCount = 16) {
  const frames = [];
  const W = 1024;
  for (let f = 0; f < frameCount; f++) {
    frames.push(`
    <g transform="translate(0, ${f * W})">
      <!-- Frame ${f} Base Translucent Flowing Water (30% opacity, zero scratch lines) -->
      <rect width="${W}" height="${W}" fill="#ffffff" fill-opacity="0.30" />
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

    if (stem === "water_flow") {
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

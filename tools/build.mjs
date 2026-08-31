import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { renderAsync } from "@resvg/resvg-js";
import {
  findCompanionMcmeta,
  generateMcmeta,
  processAnimatedTextures
} from "./lib/animation-packager.mjs";
import {
  loadPalette,
  compileAllVariations
} from "./lib/palette-injector.mjs";

const require = createRequire(import.meta.url);
const archiver = require("archiver");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const TEXTURES_DIR = path.join(ROOT_DIR, "textures");
const TEMPLATE_DIR = path.join(ROOT_DIR, "pack_template");
const DIST_DIR = path.join(ROOT_DIR, "dist");

const ALLOWED_ASSET_EXTS = new Set([".png", ".mcmeta", ".json"]);

/**
 * Creates a clean POSIX zip archive using pure Node.js (cross-platform Linux/Win/macOS)
 */
function createZipArchive(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archiverFn = typeof archiver === "function" ? archiver : archiver.default;
    const archive = archiverFn("zip", {
      zlib: { level: 9 }
    });

    output.on("close", () => resolve());
    output.on("error", (err) => reject(err));
    archive.on("error", (err) => reject(err));
    archive.on("warning", (err) => {
      if (err.code === "ENOENT") {
        console.warn("  [Archive Warning]", err);
      } else {
        reject(err);
      }
    });

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

/**
 * Resolves standard OS Minecraft resourcepacks directory
 */
function getMinecraftResourcePacksDir() {
  const platform = os.platform();
  const home = os.homedir();

  if (platform === "win32") {
    return process.env.APPDATA
      ? path.join(process.env.APPDATA, ".minecraft", "resourcepacks")
      : path.join(home, "AppData", "Roaming", ".minecraft", "resourcepacks");
  } else if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", "minecraft", "resourcepacks");
  } else {
    return path.join(home, ".minecraft", "resourcepacks");
  }
}

/**
 * Recursively scans directory and returns all whitelisted texture file entries with relative paths
 */
function getAllTextureFiles(dir, baseDir = dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...getAllTextureFiles(fullPath, baseDir));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (ext === ".svg" || ALLOWED_ASSET_EXTS.has(ext)) {
        const relPath = path.relative(baseDir, fullPath);
        results.push({
          fullPath,
          relPath,
          name: entry.name,
          ext
        });
      }
    }
  }
  return results;
}

/**
 * Parallel mapper with concurrency limit
 */
async function pMap(items, mapper, concurrency = 8) {
  const results = new Array(items.length);
  let currentIndex = 0;

  const workers = new Array(Math.min(concurrency, items.length)).fill(null).map(async () => {
    while (currentIndex < items.length) {
      const i = currentIndex++;
      results[i] = await mapper(items[i], i);
    }
  });

  await Promise.all(workers);
  return results;
}

/**
 * Rasterizes an SVG file or raw string to PNG at the target resolution using Rust Resvg
 */
async function rasterizeSvg(srcSvgOrText, destPngPath, size) {
  const svgText = typeof srcSvgOrText === "string" && (srcSvgOrText.startsWith("<") || srcSvgOrText.includes("<svg"))
    ? srcSvgOrText
    : fs.readFileSync(srcSvgOrText, "utf-8");
  const rendered = await renderAsync(svgText, {
    fitTo: {
      mode: "width",
      value: size
    },
    // System fonts disabled for deterministic rendering and fast startup; Keyframe textures author pure vector geometry without <text> tags.
    font: {
      loadSystemFonts: false
    }
  });
  fs.writeFileSync(destPngPath, rendered.asPng());
}

/**
 * Keyframe Resource Pack Compiler
 */
export async function buildResourcePack(targetRes = 512, options = {}) {
  const deploy = Boolean(options.deploy);
  const paletteName = options.palette || "trailer";
  const rawConcurrency = typeof options.concurrency === "number" && !isNaN(options.concurrency) && options.concurrency > 0
    ? options.concurrency
    : (os.availableParallelism ? os.availableParallelism() : 8);
  const concurrency = Math.max(1, Math.floor(rawConcurrency));

  console.log("\n======================================================");
  console.log("  Keyframe Resource Pack Compiler");
  console.log("  Target Resolution: " + targetRes + "×" + targetRes);
  console.log("  Palette Baseline:  " + paletteName);
  if (deploy) console.log("  Auto-Deploy: Enabled");
  console.log("======================================================\n");

  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }

  const BUILD_TMP = path.join(ROOT_DIR, "cache", "build_tmp_" + targetRes);
  if (fs.existsSync(BUILD_TMP)) {
    fs.rmSync(BUILD_TMP, { recursive: true, force: true });
  }

  const ASSETS_TEXTURES_DIR = path.join(BUILD_TMP, "assets", "minecraft", "textures");
  const BLOCKS_DIR = path.join(ASSETS_TEXTURES_DIR, "block");
  const ITEMS_DIR = path.join(ASSETS_TEXTURES_DIR, "item");
  fs.mkdirSync(ASSETS_TEXTURES_DIR, { recursive: true });
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
      description: "§6Keyframe §8- §a" + targetRes + "x§r\n§7The Cinematic Trailer Vector Pack"
    }
  };

  fs.writeFileSync(path.join(BUILD_TMP, "pack.mcmeta"), JSON.stringify(mcmeta, null, 2), "utf-8");
  console.log("[1/5] Created pack.mcmeta (Supported Formats: 1.20 - 1.21.4+)");

  // 2. High-Speed Multi-Threaded Rust Resvg Rasterization with Directory Mirroring & Palette Injection
  const palette = loadPalette(paletteName, options.override || null);
  const textureFiles = getAllTextureFiles(TEXTURES_DIR);
  textureFiles.sort((a, b) => a.relPath.localeCompare(b.relPath));
  console.log("[2/5] Rasterizing " + textureFiles.length + " vector textures to " + targetRes + "×" + targetRes + " PNG (concurrency: " + concurrency + ")...");

  const aliasesToCopy = [];

  const logs = await pMap(
    textureFiles,
    async (file) => {
      const relDir = path.dirname(file.relPath);
      const targetDir = relDir === "." ? ASSETS_TEXTURES_DIR : path.join(ASSETS_TEXTURES_DIR, relDir);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      if (file.name.endsWith(".template.svg")) {
        // Dynamic 16-color variation template compilation in-memory
        const stem = file.name.replace(/\.template\.svg$/, "");
        const svgText = fs.readFileSync(file.fullPath, "utf-8");
        const variations = compileAllVariations(svgText, palette, {
          stem,
          namePattern: "{color}_{stem}.svg",
          strict: true,
          namespaceIds: true
        });

        for (const v of variations) {
          const destPng = path.join(targetDir, v.filename.replace(/\.svg$/, ".png"));
          await rasterizeSvg(v.svg, destPng, targetRes);
        }

        const relLog = path.join(relDir === "." ? "" : relDir, stem + " [16 variations]").replace(/\\/g, "/");
        return "  ✓ " + relLog + " (palette-injected)";
      } else if (file.ext === ".svg") {
        const stem = path.basename(file.name, ".svg");
        const destPng = path.join(targetDir, stem + ".png");
        await rasterizeSvg(file.fullPath, destPng, targetRes);
        const relLog = path.join(relDir === "." ? "" : relDir, stem + ".png").replace(/\\/g, "/");

        // Check companion .mcmeta files next to this SVG
        const companionInfo = findCompanionMcmeta(file.fullPath, path.dirname(file.fullPath));
        if (companionInfo.found && !companionInfo.isPreset) {
          const destMcmeta = path.join(targetDir, stem + ".png.mcmeta");
          const mcmetaContent = generateMcmeta({
            metadata: companionInfo.metadata,
            frametime: options.frametime,
            interpolate: options.interpolate
          }, stem);
          fs.writeFileSync(destMcmeta, mcmetaContent, "utf-8");
        }

        // Backwards-compatibility aliases for 1.20 - 1.20.2 (grass.png, grass_1.png, grass_2.png)
        const normalizedRel = file.relPath.replace(/\\/g, "/");
        if (normalizedRel === "block/short_grass.svg" || stem === "short_grass") {
          const grassRel = path.join(relDir === "." ? "" : relDir, "grass.png").replace(/\\/g, "/");
          aliasesToCopy.push({ src: destPng, dest: path.join(targetDir, "grass.png"), label: grassRel, stem });
        } else if (normalizedRel === "block/short_grass_1.svg" || stem === "short_grass_1") {
          const grassRel = path.join(relDir === "." ? "" : relDir, "grass_1.png").replace(/\\/g, "/");
          aliasesToCopy.push({ src: destPng, dest: path.join(targetDir, "grass_1.png"), label: grassRel, stem });
        } else if (normalizedRel === "block/short_grass_2.svg" || stem === "short_grass_2") {
          const grassRel = path.join(relDir === "." ? "" : relDir, "grass_2.png").replace(/\\/g, "/");
          aliasesToCopy.push({ src: destPng, dest: path.join(targetDir, "grass_2.png"), label: grassRel, stem });
        }

        return "  ✓ " + relLog;
      } else {
        // Direct mirror for non-SVG texture assets (.mcmeta, .png, .json)
        const destFile = path.join(targetDir, file.name);
        fs.copyFileSync(file.fullPath, destFile);
        const relLog = path.join(relDir === "." ? "" : relDir, file.name).replace(/\\/g, "/");
        return "  ✓ " + relLog;
      }
    },
    concurrency
  );

  // Deterministically output sorted file processing logs
  for (const logLine of logs) {
    if (logLine) console.log(logLine);
  }

  // Copy backwards-compatibility aliases (and companion .mcmeta if present)
  for (const alias of aliasesToCopy) {
    fs.copyFileSync(alias.src, alias.dest);
    console.log("  ✓ " + alias.label + " (alias)");

    const sourceMcmeta = alias.src + ".mcmeta";
    if (fs.existsSync(sourceMcmeta)) {
      fs.copyFileSync(sourceMcmeta, alias.dest + ".mcmeta");
      console.log("    + " + alias.label + ".mcmeta (alias metadata)");
    }
  }

  // 2b. Multi-Frame Vertical Animation Strip Compiler
  const animResults = processAnimatedTextures(
    TEXTURES_DIR,
    { blocksDir: BLOCKS_DIR, itemsDir: ITEMS_DIR },
    targetRes,
    options
  );

  if (animResults.length > 0) {
    console.log("  Processed " + animResults.length + " multi-frame animated texture(s):");
    for (const anim of animResults) {
      console.log("  ✓ " + (anim.isItem ? "item" : "block") + "/" + anim.stem + ".png (" + anim.frameCount + " frames, " + anim.dimensions + ") + .mcmeta");
    }
  }

  // 3. Bundle custom pack_template/assets (blockstates, models)
  const templateAssets = path.join(TEMPLATE_DIR, "assets");
  if (fs.existsSync(templateAssets)) {
    fs.cpSync(templateAssets, path.join(BUILD_TMP, "assets"), { recursive: true });
    console.log("[3/5] Bundled pack_template/assets (un-rotated blockstates and custom models)");
  }

  // 4. Generate pack.png (128x128 pack icon)
  const packIconDest = path.join(BUILD_TMP, "pack.png");
  const smallPlatePng = path.join(ROOT_DIR, "docs", "assets", "icon-small-plate-128.png");
  const smallPlateSvg = path.join(ROOT_DIR, "docs", "assets", "icon-small-plate.svg");
  const grassBlockTopSvg = path.join(TEXTURES_DIR, "block", "grass_block_top.svg");
  const grassBlockTopSvgFallback = path.join(TEXTURES_DIR, "grass_block_top.svg");

  if (fs.existsSync(smallPlatePng)) {
    fs.copyFileSync(smallPlatePng, packIconDest);
    console.log("[4/5] Pack icon: icon-small-plate-128.png -> pack.png");
  } else if (fs.existsSync(smallPlateSvg)) {
    await rasterizeSvg(smallPlateSvg, packIconDest, 128);
    console.log("[4/5] Generated pack.png from icon-small-plate.svg (128×128)");
  } else if (fs.existsSync(grassBlockTopSvg)) {
    await rasterizeSvg(grassBlockTopSvg, packIconDest, 128);
    console.log("[4/5] Generated pack.png from textures/block/grass_block_top.svg (128×128 fallback)");
  } else if (fs.existsSync(grassBlockTopSvgFallback)) {
    await rasterizeSvg(grassBlockTopSvgFallback, packIconDest, 128);
    console.log("[4/5] Generated pack.png from textures/grass_block_top.svg (128×128 fallback)");
  }

  // 5. Package into clean Minecraft-compliant .ZIP (pure Node.js archiver)
  const zipFileName = "Keyframe-" + targetRes + "x.zip";
  const zipOutputPath = path.join(DIST_DIR, zipFileName);

  if (fs.existsSync(zipOutputPath)) {
    fs.unlinkSync(zipOutputPath);
  }

  console.log("[5/5] Creating pure cross-platform ZIP archive: " + zipFileName + "...");
  await createZipArchive(BUILD_TMP, zipOutputPath);

  // 6. Auto-deploy to Minecraft resourcepacks if --deploy flag is provided
  if (deploy) {
    const mcResourcePacks = getMinecraftResourcePacksDir();
    const mcHomeDir = path.dirname(mcResourcePacks);
    if (!fs.existsSync(mcHomeDir)) {
      console.warn("  [DEPLOY WARNING] Skipped: Minecraft directory does not exist at \"" + mcHomeDir + "\"");
    } else {
      if (!fs.existsSync(mcResourcePacks)) {
        fs.mkdirSync(mcResourcePacks, { recursive: true });
      }
      const destZip = path.join(mcResourcePacks, zipFileName);
      fs.copyFileSync(zipOutputPath, destZip);
      console.log("[DEPLOY] Auto-deployed to Minecraft: " + destZip);
    }
  }

  const fileBuffer = fs.readFileSync(zipOutputPath);
  const sha1Hash = crypto.createHash("sha1").update(fileBuffer).digest("hex");
  const stats = fs.statSync(zipOutputPath);

  fs.rmSync(BUILD_TMP, { recursive: true, force: true });

  console.log("\n======================================================");
  console.log("  ✓ BUILD SUCCESSFUL!");
  console.log("  File:    " + zipOutputPath);
  console.log("  Size:    " + (stats.size / 1024).toFixed(1) + " KB");
  console.log("  SHA-1:   " + sha1Hash);
  console.log("======================================================\n");

  return {
    filePath: zipOutputPath,
    fileName: zipFileName,
    sizeKb: (stats.size / 1024).toFixed(1),
    sha1: sha1Hash
  };
}

// CLI Execution Support
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const isAll = args.includes("--all");
  const isDeploy = args.includes("--deploy");
  const options = { deploy: isDeploy };

  let concurrency;
  const concurrencyIdx = args.indexOf("--concurrency");
  if (concurrencyIdx !== -1 && args[concurrencyIdx + 1]) {
    const parsed = parseInt(args[concurrencyIdx + 1], 10);
    if (!isNaN(parsed) && parsed > 0) {
      concurrency = Math.max(1, parsed);
    }
  }
  options.concurrency = concurrency;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--frametime" && args[i + 1]) {
      options.frametime = parseInt(args[i + 1], 10);
      i++;
    } else if (arg === "--interpolate") {
      options.interpolate = true;
    } else if (arg === "--no-interpolate") {
      options.interpolate = false;
    } else if (arg === "--palette" && args[i + 1]) {
      options.palette = args[i + 1];
      i++;
    }
  }

  if (isAll) {
    const resolutions = [512, 256, 128, 64, 32];
    for (const res of resolutions) {
      await buildResourcePack(res, options);
    }
  } else {
    let targetRes = 512;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--res" && args[i + 1]) {
        const parsed = parseInt(args[i + 1], 10);
        if (!isNaN(parsed) && parsed > 0) {
          targetRes = parsed;
        }
        i++;
      } else if (args[i] === "--concurrency" || args[i] === "--frametime" || args[i] === "--palette") {
        i++;
      } else if (!args[i].startsWith("-") && !isNaN(parseInt(args[i], 10))) {
        const parsed = parseInt(args[i], 10);
        if (!isNaN(parsed) && parsed > 0) {
          targetRes = parsed;
        }
      }
    }
    await buildResourcePack(targetRes, options);
  }
}

import fs from "node:fs";
import path from "node:path";
import assert from "node:assert";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_ANIMATION_PRESETS,
  naturalSortFrames,
  sanitizeAndNamespaceSvg,
  assembleCompositeSvgStrip,
  compileAnimationStrip,
  findCompanionMcmeta,
  normalizeAnimationMetadata,
  generateMcmeta,
  processAnimatedTextures
} from "./lib/animation-packager.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..");
const TEST_TMP = path.join(ROOT_DIR, "cache", "test_animation_tmp");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗ ${name}`);
    console.error(err);
    failed++;
  }
}

console.log(`\n======================================================`);
console.log(`  Running Keyframe Animation Packager Test Suite`);
console.log(`======================================================\n`);

// Setup temporary test directory
if (fs.existsSync(TEST_TMP)) {
  fs.rmSync(TEST_TMP, { recursive: true, force: true });
}
fs.mkdirSync(TEST_TMP, { recursive: true });

// 1. Natural Frame Sorting Test
test("Natural Numerical Frame Sorting", () => {
  const unsorted = ["frame_10.svg", "frame_2.svg", "frame_1.svg", "frame_0.svg", "frame_20.svg", "frame_11.svg"];
  const sorted = naturalSortFrames(unsorted);
  assert.deepStrictEqual(sorted, [
    "frame_0.svg",
    "frame_1.svg",
    "frame_2.svg",
    "frame_10.svg",
    "frame_11.svg",
    "frame_20.svg"
  ]);

  const numberOnly = ["10.svg", "2.svg", "1.svg", "0.svg", "20.svg"];
  assert.deepStrictEqual(naturalSortFrames(numberOnly), [
    "0.svg",
    "1.svg",
    "2.svg",
    "10.svg",
    "20.svg"
  ]);

  const paddedNumbers = ["02.svg", "10.svg", "00.svg", "01.svg"];
  assert.deepStrictEqual(naturalSortFrames(paddedNumbers), [
    "00.svg",
    "01.svg",
    "02.svg",
    "10.svg"
  ]);
});

// 2. SVG Sanitization and ID Scoping Test
test("SVG XML Prolog / DOCTYPE Sanitization & ID Namespacing", () => {
  const rawSvg = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="waterGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#0284C7"/>
      <stop offset="100%" stop-color="#0369A1"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" fill="url(#waterGrad)"/>
</svg>`;

  const parsed = sanitizeAndNamespaceSvg(rawSvg, 3);
  assert.strictEqual(parsed.viewBox, "0 0 512 512");
  assert.strictEqual(parsed.width, 512);
  assert.strictEqual(parsed.height, 512);
  assert.ok(!parsed.innerContent.includes("<?xml"));
  assert.ok(!parsed.innerContent.includes("<!DOCTYPE"));
  assert.ok(parsed.innerContent.includes('id="f3_waterGrad"'));
  assert.ok(parsed.innerContent.includes('fill="url(#f3_waterGrad)"'));
});

// 3. Composite SVG Strip Assembly
test("Composite SVG Strip Document Generation", () => {
  const frame1 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#FF0000"/></svg>`;
  const frame2 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#00FF00"/></svg>`;
  const frame3 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0000FF"/></svg>`;

  const composite = assembleCompositeSvgStrip([frame1, frame2, frame3]);
  assert.ok(composite.includes('viewBox="0 0 512 1536"'));
  assert.ok(composite.includes('height="1536"'));
  assert.ok(composite.includes('y="0"'));
  assert.ok(composite.includes('y="512"'));
  assert.ok(composite.includes('y="1024"'));
});

// 4. Multi-Resolution Rasterization Strip Test
await asyncTest("Multi-Resolution Animation Strip Compilation (512x to 32x)", async () => {
  const frame1 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#38BDF8"/></svg>`;
  const frame2 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0284C7"/></svg>`;
  const frame3 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0369A1"/></svg>`;
  const frame4 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#075985"/></svg>`;

  const frames = [frame1, frame2, frame3, frame4];
  const resolutions = [512, 256, 128, 64, 32];

  for (const res of resolutions) {
    const outPng = path.join(TEST_TMP, `test_strip_${res}x.png`);
    const result = compileAnimationStrip(frames, outPng, res);
    assert.strictEqual(result.width, res);
    assert.strictEqual(result.height, res * 4);
    assert.strictEqual(result.frameCount, 4);
    assert.ok(fs.existsSync(outPng));
    assert.ok(result.bytes > 0);
  }
});

// 5. Metadata Discovery Ladder & Presets
test("Metadata Discovery Ladder and Default Presets", () => {
  // Built-in Presets Check
  assert.strictEqual(DEFAULT_ANIMATION_PRESETS.water_still.frametime, 2);
  assert.strictEqual(DEFAULT_ANIMATION_PRESETS.water_still.interpolate, true);
  assert.strictEqual(DEFAULT_ANIMATION_PRESETS.lava_still.frametime, 3);
  assert.strictEqual(DEFAULT_ANIMATION_PRESETS.fire_0.interpolate, false);
  assert.strictEqual(DEFAULT_ANIMATION_PRESETS.prismarine.frametime, 4);

  // Discovery via Preset
  const waterInfo = findCompanionMcmeta("water_still");
  assert.strictEqual(waterInfo.found, true);
  assert.strictEqual(waterInfo.metadata.animation.frametime, 2);
  assert.strictEqual(waterInfo.metadata.animation.interpolate, true);

  // Discovery via companion file
  const mockTextureDir = path.join(TEST_TMP, "mock_textures");
  fs.mkdirSync(mockTextureDir, { recursive: true });

  const customSvg = path.join(mockTextureDir, "custom_lamp.svg");
  const customMcmeta = path.join(mockTextureDir, "custom_lamp.svg.mcmeta");
  fs.writeFileSync(customSvg, "<svg></svg>", "utf-8");
  fs.writeFileSync(customMcmeta, JSON.stringify({ animation: { frametime: 6, interpolate: false } }), "utf-8");

  const companionResult = findCompanionMcmeta(customSvg, mockTextureDir);
  assert.strictEqual(companionResult.found, true);
  assert.strictEqual(companionResult.metadata.animation.frametime, 6);
  assert.strictEqual(companionResult.metadata.animation.interpolate, false);
});

// 6. Metadata Normalization, Partial JSON & Overrides
test("Metadata Normalization and CLI Overrides", () => {
  // Partial JSON auto-wrapped
  const normalizedPartial = normalizeAnimationMetadata({ frametime: 5, interpolate: true });
  assert.deepStrictEqual(normalizedPartial, {
    animation: { frametime: 5, interpolate: true }
  });

  // Generate .mcmeta with CLI override
  const jsonOutput = generateMcmeta({
    metadata: { animation: { frametime: 2, interpolate: true } },
    overrideFrametime: 10,
    overrideInterpolate: false
  });

  const parsedJson = JSON.parse(jsonOutput);
  assert.strictEqual(parsedJson.animation.frametime, 10);
  assert.strictEqual(parsedJson.animation.interpolate, false);
});

// 7. Directory-Based Animation Processing
await asyncTest("Workspace Directory-Based Animation Packager", async () => {
  const mockWorkspace = path.join(TEST_TMP, "workspace_textures");
  const waterDir = path.join(mockWorkspace, "water_still");
  fs.mkdirSync(waterDir, { recursive: true });

  // Write 3 frames
  fs.writeFileSync(path.join(waterDir, "0.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0000AA"/></svg>`, "utf-8");
  fs.writeFileSync(path.join(waterDir, "1.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0000CC"/></svg>`, "utf-8");
  fs.writeFileSync(path.join(waterDir, "2.svg"), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0000EE"/></svg>`, "utf-8");

  const outBlocks = path.join(TEST_TMP, "out_blocks");
  const outItems = path.join(TEST_TMP, "out_items");
  fs.mkdirSync(outBlocks, { recursive: true });
  fs.mkdirSync(outItems, { recursive: true });

  const results = processAnimatedTextures(
    mockWorkspace,
    { blocksDir: outBlocks, itemsDir: outItems },
    512
  );

  assert.strictEqual(results.length, 1);
  assert.strictEqual(results[0].stem, "water_still");
  assert.strictEqual(results[0].frameCount, 3);
  assert.strictEqual(results[0].dimensions, "512x1536");

  const outPng = path.join(outBlocks, "water_still.png");
  const outMcmeta = path.join(outBlocks, "water_still.png.mcmeta");
  assert.ok(fs.existsSync(outPng));
  assert.ok(fs.existsSync(outMcmeta));

  const mcmetaContent = JSON.parse(fs.readFileSync(outMcmeta, "utf-8"));
  assert.strictEqual(mcmetaContent.animation.frametime, 2);
  assert.strictEqual(mcmetaContent.animation.interpolate, true);
});

// Clean up temporary test files
if (fs.existsSync(TEST_TMP)) {
  fs.rmSync(TEST_TMP, { recursive: true, force: true });
}

console.log(`\n======================================================`);
if (failed === 0) {
  console.log(`  ✓ ALL ${passed} TESTS PASSED!`);
  console.log(`======================================================\n`);
  process.exit(0);
} else {
  console.error(`  ✗ ${failed} TEST(S) FAILED (${passed} passed)`);
  console.log(`======================================================\n`);
  process.exit(1);
}

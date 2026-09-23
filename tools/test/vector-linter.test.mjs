#!/usr/bin/env node

/**
 * Keyframe Automated Static SVG Vector Master Linter Test Suite
 *
 * Verifies that:
 * 1. Every vector master under textures/ passes without error.
 * 2. Invalid viewBoxes (missing, non-512x512, offset origin) are flagged.
 * 3. Forbidden editor namespaces (inkscape, sodipodi, illustrator) are flagged.
 * 4. Forbidden embedded raster images (<image>, raster <feImage>) are flagged while XML
 *    comments are ignored.
 * 5. ClipPath definition integrity and url(#id) referential integrity are enforced, and
 *    data-id attributes do not satisfy a url(#id) reference.
 * 6. CLI execution and directory-level linting correctly report aggregate status.
 * 7. package.json and .github/workflows/ci.yml pipeline wiring is enforced.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  lintVectors,
  lintSvgContent,
  lintSvgFile,
  findSvgFiles,
  stripComments,
  ROOT_DIR,
  DEFAULT_TEXTURES_DIR,
  REQUIRED_VIEWBOX,
  FORBIDDEN_NAMESPACES
} from "../lib/vector-linter.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEST_TMP = path.join(ROOT_DIR, "cache", "test_vector_linter");

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

function makeFixtureDir(files) {
  if (fs.existsSync(TEST_TMP)) {
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  }
  fs.mkdirSync(TEST_TMP, { recursive: true });
  for (const [relPath, content] of Object.entries(files)) {
    const full = path.join(TEST_TMP, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, "utf-8");
  }
  return TEST_TMP;
}

function cleanupFixtureDir() {
  if (fs.existsSync(TEST_TMP)) {
    fs.rmSync(TEST_TMP, { recursive: true, force: true });
  }
}

// -----------------------------------------------------------------------------
// Suite 1: Current Texture Masters Verification (every master under textures/)
// -----------------------------------------------------------------------------
console.log("\n[Suite 1] Current Texture Masters Verification (textures/)");
{
  // The expected set is derived from disk so adding a texture never breaks this suite.
  const svgFiles = findSvgFiles(DEFAULT_TEXTURES_DIR);
  assert(svgFiles.length > 0, `Found ${svgFiles.length} vector master(s) under textures/`);

  const result = lintVectors(DEFAULT_TEXTURES_DIR);
  assertEqual(result.ok, true, "All masters under textures/ pass vector linter without error");
  assertEqual(result.errors.length, 0, `Zero errors reported across all ${svgFiles.length} masters`);
  assertEqual(result.filesChecked, svgFiles.length, `Reported ${svgFiles.length} files checked under textures/`);

  // Verify each individual master file passes
  for (const file of svgFiles) {
    const fileResult = lintSvgFile(file);
    const basename = path.basename(file);
    assert(fileResult.ok, `Master "${basename}" passes all vector linter checks individually`);
  }
}

// -----------------------------------------------------------------------------
// Suite 2: ViewBox Invariant Verification
// -----------------------------------------------------------------------------
console.log("\n[Suite 2] ViewBox Invariant Verification");
{
  const validSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512"><rect width="512" height="512" fill="#000"/></svg>`;
  const validRes = lintSvgContent(validSvg, "valid.svg");
  assertEqual(validRes.ok, true, 'Valid viewBox "0 0 512 512" passes');
  assertEqual(validRes.errors.length, 0, "No errors on valid viewBox");

  const missingViewBox = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#000"/></svg>`;
  const missingRes = lintSvgContent(missingViewBox, "missing_viewbox.svg");
  assertEqual(missingRes.ok, false, "Missing viewBox is rejected");
  assert(missingRes.errors[0].includes("Missing viewBox attribute"), "Error message specifies missing viewBox attribute");

  const invalid256 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><rect width="256" height="256" fill="#000"/></svg>`;
  const res256 = lintSvgContent(invalid256, "256.svg");
  assertEqual(res256.ok, false, "256x256 viewBox is rejected");
  assert(res256.errors[0].includes('Invalid viewBox "0 0 256 256"'), "Error message identifies 256x256 viewBox");

  const invalid1024 = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"><rect width="1024" height="1024" fill="#000"/></svg>`;
  const res1024 = lintSvgContent(invalid1024, "1024.svg");
  assertEqual(res1024.ok, false, "1024x1024 viewBox is rejected");

  const asymmetricViewBox = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 513"><rect width="512" height="512" fill="#000"/></svg>`;
  const resAsym = lintSvgContent(asymmetricViewBox, "asym.svg");
  assertEqual(resAsym.ok, false, "Asymmetric viewBox 0 0 512 513 is rejected");

  const offsetOrigin = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 10 512 512"><rect width="512" height="512" fill="#000"/></svg>`;
  const resOffset = lintSvgContent(offsetOrigin, "offset.svg");
  assertEqual(resOffset.ok, false, "Offset origin viewBox 10 10 512 512 is rejected");

  const malformedViewBox = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="invalid-string"><rect width="512" height="512" fill="#000"/></svg>`;
  const resMalformed = lintSvgContent(malformedViewBox, "malformed.svg");
  assertEqual(resMalformed.ok, false, "Malformed viewBox string is rejected");

  const missingRootSvg = `<div>Not an SVG</div>`;
  const resNoSvg = lintSvgContent(missingRootSvg, "nosvg.svg");
  assertEqual(resNoSvg.ok, false, "Missing root <svg> element is rejected");
}

// -----------------------------------------------------------------------------
// Suite 3: Forbidden Editor Namespaces Verification
// -----------------------------------------------------------------------------
console.log("\n[Suite 3] Forbidden Editor Namespaces Verification");
{
  const inkscapeSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 512 512"><rect width="512" height="512"/></svg>`;
  const resInkscape = lintSvgContent(inkscapeSvg, "inkscape.svg");
  assertEqual(resInkscape.ok, false, "xmlns:inkscape is rejected");
  assert(resInkscape.errors.some(e => e.includes("xmlns:inkscape")), "Error reports forbidden xmlns:inkscape");

  const sodipodiSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" viewBox="0 0 512 512"><rect width="512" height="512"/></svg>`;
  const resSodipodi = lintSvgContent(sodipodiSvg, "sodipodi.svg");
  assertEqual(resSodipodi.ok, false, "xmlns:sodipodi is rejected");
  assert(resSodipodi.errors.some(e => e.includes("xmlns:sodipodi")), "Error reports forbidden xmlns:sodipodi");

  const illustratorSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:illustrator="http://ns.adobe.com/illustrator" viewBox="0 0 512 512"><rect width="512" height="512"/></svg>`;
  const resIllustrator = lintSvgContent(illustratorSvg, "illustrator.svg");
  assertEqual(resIllustrator.ok, false, "xmlns:illustrator is rejected");
  assert(resIllustrator.errors.some(e => e.includes("xmlns:illustrator")), "Error reports forbidden xmlns:illustrator");

  const residueSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><sodipodi:namedview id="base"/><rect width="512" height="512"/></svg>`;
  const resResidue = lintSvgContent(residueSvg, "residue.svg");
  assertEqual(resResidue.ok, false, "Editor tag residue <sodipodi:namedview> is rejected");

  const validNamespaces = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512"><rect width="512" height="512"/></svg>`;
  const resValidNs = lintSvgContent(validNamespaces, "valid_ns.svg");
  assertEqual(resValidNs.ok, true, "Standard SVG namespaces (xmlns, xmlns:xlink) are permitted");
}

// -----------------------------------------------------------------------------
// Suite 4: Forbidden Embedded Raster Images Verification
// -----------------------------------------------------------------------------
console.log("\n[Suite 4] Forbidden Embedded Raster Images Verification");
{
  const rasterDataSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><image href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" width="512" height="512"/></svg>`;
  const resData = lintSvgContent(rasterDataSvg, "raster_data.svg");
  assertEqual(resData.ok, false, "Base64 data URI <image> is rejected");
  assert(resData.errors.some(e => e.includes("Forbidden embedded raster image (<image>)")), "Error message mentions <image>");

  const rasterHrefSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><image href="baked_texture.png" width="512" height="512"/></svg>`;
  const resHref = lintSvgContent(rasterHrefSvg, "raster_href.svg");
  assertEqual(resHref.ok, false, "Linked raster file <image href=...> is rejected");

  const rasterXlinkSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512"><image xlink:href="baked_texture.png" width="512" height="512"/></svg>`;
  const resXlink = lintSvgContent(rasterXlinkSvg, "raster_xlink.svg");
  assertEqual(resXlink.ok, false, "Linked raster file <image xlink:href=...> is rejected");

  const commentRasterSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><!-- Note: do not use <image> in this file --><rect width="512" height="512" fill="#fff"/></svg>`;
  const resComment = lintSvgContent(commentRasterSvg, "comment_raster.svg");
  assertEqual(resComment.ok, true, "<image> inside XML comments is ignored and does not trigger error");

  const feImageFileSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><filter id="f"><feImage href="x.png"/></filter></defs><rect width="512" height="512" filter="url(#f)"/></svg>`;
  const resFeFile = lintSvgContent(feImageFileSvg, "fe_image_file.svg");
  assertEqual(resFeFile.ok, false, "Linked raster file <feImage href=...> is rejected");
  assert(resFeFile.errors.some(e => e.includes("<feImage")), "Error message mentions <feImage>");

  const feImageXlinkSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512"><defs><filter id="f"><feImage xlink:href="baked_texture.png"/></filter></defs><rect width="512" height="512" filter="url(#f)"/></svg>`;
  const resFeXlink = lintSvgContent(feImageXlinkSvg, "fe_image_xlink.svg");
  assertEqual(resFeXlink.ok, false, "Linked raster file <feImage xlink:href=...> is rejected");

  const feImageDataSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><filter id="f"><feImage href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="/></filter></defs><rect width="512" height="512" filter="url(#f)"/></svg>`;
  const resFeData = lintSvgContent(feImageDataSvg, "fe_image_data.svg");
  assertEqual(resFeData.ok, false, "Base64 data URI <feImage> is rejected");

  const feImageFragmentSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><circle id="dot" cx="16" cy="16" r="8"/><filter id="f"><feImage href="#dot"/></filter></defs><rect width="512" height="512" filter="url(#f)"/></svg>`;
  const resFeFragment = lintSvgContent(feImageFragmentSvg, "fe_image_fragment.svg");
  assertEqual(resFeFragment.ok, true, "<feImage> referencing an in-document vector element (#id) is permitted");
}

// -----------------------------------------------------------------------------
// Suite 5: ClipPath and url(#id) Referential Integrity Verification
// -----------------------------------------------------------------------------
console.log("\n[Suite 5] ClipPath and url(#id) Referential Integrity Verification");
{
  // Valid clipPath and reference
  const validClipSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs>
      <clipPath id="tile_mask">
        <rect width="256" height="256" />
      </clipPath>
    </defs>
    <g clip-path="url(#tile_mask)">
      <circle cx="128" cy="128" r="100" />
    </g>
  </svg>`;
  const resValidClip = lintSvgContent(validClipSvg, "valid_clip.svg");
  assertEqual(resValidClip.ok, true, "Valid clipPath definition and clip-path reference passes");

  // Missing id attribute on <clipPath>
  const missingIdClipSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs>
      <clipPath>
        <rect width="256" height="256" />
      </clipPath>
    </defs>
  </svg>`;
  const resMissingClipId = lintSvgContent(missingIdClipSvg, "missing_clip_id.svg");
  assertEqual(resMissingClipId.ok, false, "<clipPath> missing id attribute is rejected");
  assert(resMissingClipId.errors.some(e => e.includes('missing required "id" attribute')), "Reports missing required id attribute");

  // Empty id attribute on <clipPath>
  const emptyIdClipSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs>
      <clipPath id="">
        <rect width="256" height="256" />
      </clipPath>
    </defs>
  </svg>`;
  const resEmptyClipId = lintSvgContent(emptyIdClipSvg, "empty_clip_id.svg");
  assertEqual(resEmptyClipId.ok, false, "<clipPath> with empty id is rejected");

  // Missing referenced clipPath ID
  const danglingClipRefSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <g clip-path="url(#non_existent_clip)">
      <rect width="512" height="512" fill="#333" />
    </g>
  </svg>`;
  const resDanglingClip = lintSvgContent(danglingClipRefSvg, "dangling_clip.svg");
  assertEqual(resDanglingClip.ok, false, "Dangling clip-path url(#id) reference is rejected");
  assert(resDanglingClip.errors.some(e => e.includes("non_existent_clip")), "Error names non_existent_clip");

  // Missing referenced gradient ID
  const danglingGradSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect width="512" height="512" fill="url(#missing_linear_grad)" />
  </svg>`;
  const resDanglingGrad = lintSvgContent(danglingGradSvg, "dangling_grad.svg");
  assertEqual(resDanglingGrad.ok, false, "Dangling fill url(#id) gradient reference is rejected");
  assert(resDanglingGrad.errors.some(e => e.includes("missing_linear_grad")), "Error names missing_linear_grad");

  // Missing referenced mask ID
  const danglingMaskSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <g mask="url(#missing_mask_layer)">
      <rect width="512" height="512" fill="#fff" />
    </g>
  </svg>`;
  const resDanglingMask = lintSvgContent(danglingMaskSvg, "dangling_mask.svg");
  assertEqual(resDanglingMask.ok, false, "Dangling mask url(#id) reference is rejected");
  assert(resDanglingMask.errors.some(e => e.includes("missing_mask_layer")), "Error names missing_mask_layer");

  // clip-path referencing element that is NOT a clipPath
  const nonClipRefSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <rect id="not_a_clip" width="512" height="512" />
    <g clip-path="url(#not_a_clip)">
      <circle cx="256" cy="256" r="100" />
    </g>
  </svg>`;
  const resNonClip = lintSvgContent(nonClipRefSvg, "non_clip_ref.svg");
  assertEqual(resNonClip.ok, false, "clip-path referencing a non-<clipPath> element is rejected");
  assert(resNonClip.errors.some(e => e.includes("not a <clipPath>")), "Error reports element is not a <clipPath>");

  // data-id must not be mistaken for an id declaration
  const dataIdRefSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <g data-id="g"><rect width="512" height="512" fill="url(#g)" /></g>
  </svg>`;
  const resDataId = lintSvgContent(dataIdRefSvg, "data_id_ref.svg");
  assertEqual(resDataId.ok, false, 'url(#g) is rejected when only data-id="g" exists');
  assert(resDataId.errors.some(e => e.includes('Missing referenced ID "g"')), "Error names the unresolved id g");

  // data-id on a <clipPath> does not stand in for its id
  const dataIdClipSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs><clipPath data-id="c"><rect width="256" height="256" /></clipPath></defs>
  </svg>`;
  const resDataIdClip = lintSvgContent(dataIdClipSvg, "data_id_clip.svg");
  assertEqual(resDataIdClip.ok, false, '<clipPath> carrying only data-id is rejected as missing id');

  // A real id alongside data-id still resolves
  const dataIdWithIdSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs><linearGradient data-id="x" id="g"><stop offset="0" stop-color="#000"/></linearGradient></defs>
    <rect width="512" height="512" fill="url(#g)" />
  </svg>`;
  const resDataIdWithId = lintSvgContent(dataIdWithIdSvg, "data_id_with_id.svg");
  assertEqual(resDataIdWithId.ok, true, "A real id declared next to data-id still resolves url(#id)");
}

// -----------------------------------------------------------------------------
// Suite 6: Directory and Fixture Batch Linting
// -----------------------------------------------------------------------------
console.log("\n[Suite 6] Directory and Fixture Batch Linting");
{
  const fixtureTree = {
    "clean/a.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#111"/></svg>`,
    "clean/b.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><circle cx="256" cy="256" r="128" fill="#222"/></svg>`,
    "dirty/bad_viewbox.svg": `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/></svg>`,
    "dirty/editor.svg": `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://test" viewBox="0 0 512 512"><rect width="512" height="512"/></svg>`
  };

  const fixtureDir = makeFixtureDir(fixtureTree);

  // Lint clean subfolder
  const cleanResult = lintVectors(path.join(fixtureDir, "clean"));
  assertEqual(cleanResult.ok, true, "Clean directory passes lintVectors");
  assertEqual(cleanResult.filesChecked, 2, "Checked 2 clean files");
  assertEqual(cleanResult.errors.length, 0, "Zero errors in clean directory");

  // Lint dirty subfolder
  const dirtyResult = lintVectors(path.join(fixtureDir, "dirty"));
  assertEqual(dirtyResult.ok, false, "Dirty directory fails lintVectors");
  assertEqual(dirtyResult.filesChecked, 2, "Checked 2 dirty files");
  assertEqual(dirtyResult.errors.length, 2, "Reported 2 errors across dirty files");

  // Lint combined fixture dir
  const combinedResult = lintVectors(fixtureDir);
  assertEqual(combinedResult.ok, false, "Combined fixture dir fails lintVectors");
  assertEqual(combinedResult.filesChecked, 4, "Checked 4 total files");
  assertEqual(combinedResult.errors.length, 2, "Reported 2 errors overall");

  // Lint non-existent path
  const nonExistent = lintVectors(path.join(fixtureDir, "does_not_exist"));
  assertEqual(nonExistent.ok, false, "Non-existent path returns ok=false");
  assertEqual(nonExistent.filesChecked, 0, "Zero files checked for non-existent path");

  cleanupFixtureDir();
}

// -----------------------------------------------------------------------------
// Suite 7: Package.json and CI Pipeline Wiring Verification
// -----------------------------------------------------------------------------
console.log("\n[Suite 7] Package.json and CI Pipeline Wiring Verification");
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf-8"));

  // Check lint:svg script
  assertEqual(
    pkg.scripts["lint:svg"],
    "node tools/lib/vector-linter.mjs",
    'package.json exposes "lint:svg": "node tools/lib/vector-linter.mjs"'
  );

  // Check test:vector-linter script
  assertEqual(
    pkg.scripts["test:vector-linter"],
    "node tools/test/vector-linter.test.mjs",
    'package.json exposes "test:vector-linter": "node tools/test/vector-linter.test.mjs"'
  );

  // Check test aggregator script
  assert(
    pkg.scripts.test.includes("npm run lint:svg"),
    'npm test aggregator runs "npm run lint:svg"'
  );
  assert(
    pkg.scripts.test.includes("tools/test/vector-linter.test.mjs"),
    'npm test aggregator runs "tools/test/vector-linter.test.mjs"'
  );

  // Check .github/workflows/ci.yml
  const ciPath = path.join(ROOT_DIR, ".github", "workflows", "ci.yml");
  const ciContent = fs.readFileSync(ciPath, "utf-8");

  assert(
    ciContent.includes("Run Vector Master Linter"),
    '.github/workflows/ci.yml contains step "Run Vector Master Linter"'
  );
  assert(
    ciContent.includes("npm run lint:svg"),
    '.github/workflows/ci.yml runs "npm run lint:svg"'
  );
  assert(
    ciContent.includes("npm run test:vector-linter"),
    '.github/workflows/ci.yml runs "npm run test:vector-linter"'
  );
}

console.log("\n=======================================================");
console.log(`  RESULTS: ${passedTests}/${totalTests} tests passed`);
console.log("=======================================================\n");

if (passedTests !== totalTests) {
  process.exit(1);
}

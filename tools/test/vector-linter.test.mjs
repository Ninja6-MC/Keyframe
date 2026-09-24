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
 * 5. ClipPath definition integrity and url(#id) / href="#id" referential integrity are
 *    enforced case-sensitively; data-id and ID= do not satisfy a reference, and quoted
 *    url() forms that resvg ignores are rejected.
 * 6. CLI execution and directory-level linting correctly report aggregate status.
 * 7. package.json and .github/workflows/ci.yml pipeline wiring is enforced.
 * 8. Only reference forms resvg honours pass: url() in any other case or spacing, on a
 *    property resvg does not apply it to, at the wrong element type or outside the
 *    document is rejected, as are href under a non-xlink prefix and editor namespaces
 *    bound to any prefix or declared through <!ENTITY>.
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

  // SVG attribute names are case-sensitive; resvg ignores both of these.
  const lowercaseViewBox = `<svg xmlns="http://www.w3.org/2000/svg" viewbox="0 0 512 512"><rect width="512" height="512" fill="#000"/></svg>`;
  const resLowercase = lintSvgContent(lowercaseViewBox, "lowercase_viewbox.svg");
  assertEqual(resLowercase.ok, false, 'Lowercase viewbox="0 0 512 512" is rejected');
  assert(resLowercase.errors[0].includes("Missing viewBox attribute"), "Lowercase viewbox is reported as a missing viewBox");

  const dataViewBox = `<svg xmlns="http://www.w3.org/2000/svg" data-viewBox="0 0 512 512"><rect width="512" height="512" fill="#000"/></svg>`;
  const resDataViewBox = lintSvgContent(dataViewBox, "data_viewbox.svg");
  assertEqual(resDataViewBox.ok, false, 'data-viewBox="0 0 512 512" does not satisfy the viewBox rule');

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

  // Uppercase ID= is not an id in XML; resvg leaves url(#g) unresolved
  const upperIdSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs><linearGradient ID="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>
    <rect width="512" height="512" fill="url(#g)" />
  </svg>`;
  const resUpperId = lintSvgContent(upperIdSvg, "upper_id.svg");
  assertEqual(resUpperId.ok, false, 'url(#g) is rejected when only ID="g" exists');
  assert(resUpperId.errors.some(e => e.includes('Missing referenced ID "g"')), "Error names the unresolved id g");

  // Lowercase <clippath> is not a clipPath element; resvg draws the target unclipped
  const lowercaseClipSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <clippath id="c"><rect width="256" height="512" /></clippath>
    <rect width="512" height="512" clip-path="url(#c)" />
  </svg>`;
  const resLowercaseClip = lintSvgContent(lowercaseClipSvg, "lowercase_clippath.svg");
  assertEqual(resLowercaseClip.ok, false, "clip-path referencing a lowercase <clippath> is rejected");
  assert(resLowercaseClip.errors.some(e => e.includes("not a <clipPath>")), "Lowercase <clippath> is reported as not a <clipPath>");

  // Same-document fragment hrefs must resolve
  const useOkSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512">
    <defs><rect id="r" width="512" height="512" /></defs>
    <use href="#r" /><use xlink:href="#r" />
  </svg>`;
  assertEqual(lintSvgContent(useOkSvg, "use_ok.svg").ok, true, '<use href="#r"> and <use xlink:href="#r"> resolving to an id pass');

  const useMissingSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs><rect id="r" width="512" height="512" /></defs>
    <use href="#missing" />
  </svg>`;
  const resUseMissing = lintSvgContent(useMissingSvg, "use_missing.svg");
  assertEqual(resUseMissing.ok, false, 'Dangling <use href="#missing"> is rejected');
  assert(resUseMissing.errors.some(e => e.includes('href="#missing"')), "Error names the dangling href");

  const useXlinkMissingSvg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 512 512">
    <use xlink:href="#missing" />
  </svg>`;
  assertEqual(lintSvgContent(useXlinkMissingSvg, "use_xlink_missing.svg").ok, false, 'Dangling <use xlink:href="#missing"> is rejected');

  const gradTemplateMissingSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs><linearGradient id="g" href="#nope" /></defs>
    <rect width="512" height="512" fill="url(#g)" />
  </svg>`;
  const resGradTemplate = lintSvgContent(gradTemplateMissingSvg, "grad_template_missing.svg");
  assertEqual(resGradTemplate.ok, false, "Gradient template link to a missing id is rejected");
  assert(resGradTemplate.errors.some(e => e.includes('href="#nope"')), "Error names the dangling template href");

  const feImageMissingSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs><filter id="f"><feImage href="#nope" /></filter></defs>
    <rect width="512" height="512" filter="url(#f)" />
  </svg>`;
  assertEqual(lintSvgContent(feImageMissingSvg, "fe_image_missing.svg").ok, false, '<feImage href="#nope"> to a missing id is rejected');

  // resvg does not resolve quoted url() references, in any quoting form
  const quotedGrad = (ref) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/></linearGradient></defs>
    <rect width="512" height="512" ${ref} />
  </svg>`;
  const resQuotEntity = lintSvgContent(quotedGrad('style="fill:url(&quot;#nope&quot;)"'), "quot_entity_missing.svg");
  assertEqual(resQuotEntity.ok, false, "Dangling url(&quot;#nope&quot;) in a style attribute is rejected");
  assert(resQuotEntity.errors.some(e => e.includes('Missing referenced ID "nope"')), "Entity-quoted dangling reference names nope");

  const resAposEntity = lintSvgContent(quotedGrad('fill="url(&apos;#nope&apos;)"'), "apos_entity_missing.svg");
  assert(resAposEntity.errors.some(e => e.includes('Missing referenced ID "nope"')), "Dangling url(&apos;#nope&apos;) is rejected");

  const resQuotResolved = lintSvgContent(quotedGrad('style="fill:url(&quot;#g&quot;)"'), "quot_entity_resolved.svg");
  assertEqual(resQuotResolved.ok, false, "Entity-quoted url(&quot;#g&quot;) is rejected even when #g exists");
  assert(resQuotResolved.errors.some(e => e.includes("is not resolved by resvg")), "Error explains resvg ignores quoted url()");

  const resSingleQuoted = lintSvgContent(quotedGrad(`fill="url('#g')"`), "single_quoted.svg");
  assertEqual(resSingleQuoted.ok, false, "Literal url('#g') is rejected even when #g exists");
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

// -----------------------------------------------------------------------------
// Suite 8: Only Reference Forms resvg Honours Pass
// -----------------------------------------------------------------------------
// Every rejected fixture below was rendered with @resvg/resvg-js 2.6.2 and draws wrong:
// the clip, mask or filter is dropped, the fill falls back to black or transparent, the
// <use> draws nothing, or (for the namespace cases) editor residue survives into the
// master. Every accepted fixture renders as written.
console.log("\n[Suite 8] Only Reference Forms resvg Honours Pass");
{
  const DEFS = `<defs>
    <clipPath id="c"><rect width="256" height="512"/></clipPath>
    <linearGradient id="g"><stop offset="0" stop-color="#0f0"/></linearGradient>
    <pattern id="p" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="16" height="16"/></pattern>
    <rect id="r" width="256" height="512" fill="#00f"/>
    <mask id="m"><rect width="256" height="512" fill="#fff"/></mask>
    <filter id="f"><feFlood flood-color="#0f0"/></filter>
    <marker id="mk" markerWidth="8" markerHeight="8"><rect width="8" height="8"/></marker>
  </defs>`;
  const doc = (body, { head = "", ns = "" } = {}) =>
    `${head}<svg xmlns="http://www.w3.org/2000/svg" ${ns} viewBox="0 0 512 512">${DEFS}${body}</svg>`;

  const rejected = [
    // url() function spelled in a case resvg does not recognise
    ['clip-path="URL(#c)" attribute', doc(`<rect width="512" height="512" clip-path="URL(#c)"/>`), "not recognised by resvg"],
    ['clip-path="Url(#c)" attribute', doc(`<rect width="512" height="512" clip-path="Url(#c)"/>`), "not recognised by resvg"],
    ['style="clip-path:URL(#c)"', doc(`<rect width="512" height="512" style="clip-path:URL(#c)"/>`), "not recognised by resvg"],
    ['fill="URL(#g)" attribute', doc(`<rect width="512" height="512" fill="URL(#g)"/>`), "not recognised by resvg"],
    ["<style> rule fill:URL(#g)", doc(`<style>.a{fill:URL(#g)}</style><rect class="a" width="512" height="512"/>`), "not recognised by resvg"],
    ["<style> CDATA rule fill:uRl(#g)", doc(`<style><![CDATA[.a{fill:uRl(#g)}]]></style><rect class="a" width="512" height="512"/>`), "not recognised by resvg"],
    ['entity-encoded fill="&#85;RL(#g)"', doc(`<rect width="512" height="512" fill="&#85;RL(#g)"/>`), "not recognised by resvg"],
    ['clip-path="url (#c)" with a space before the parenthesis', doc(`<rect width="512" height="512" clip-path="url (#c)"/>`), "not recognised by resvg"],
    // property names resvg does not apply a url() on
    ['upper-case attribute CLIP-PATH="url(#c)"', doc(`<rect width="512" height="512" CLIP-PATH="url(#c)"/>`), "is not applied by resvg"],
    ['upper-case style="FILL:url(#g)"', doc(`<rect width="512" height="512" style="FILL:url(#g)"/>`), "is not applied by resvg"],
    ["upper-case <style> rule FILL:url(#g)", doc(`<style>.a{FILL:url(#g)}</style><rect class="a" width="512" height="512"/>`), "is not applied by resvg"],
    ['marker shorthand marker="url(#mk)"', doc(`<path d="M0 0 L32 32" stroke="#000" marker="url(#mk)"/>`), "is not applied by resvg"],
    // url() pointing at an element of the wrong type
    ['fill="url(#r)" pointing at a <rect>', doc(`<rect width="512" height="512" fill="url(#r)"/>`), 'Invalid fill reference "#r"'],
    ['stroke="url(#c)" pointing at a <clipPath>', doc(`<rect width="512" height="512" stroke="url(#c)"/>`), 'Invalid stroke reference "#c"'],
    ['style="fill:url(#m)" pointing at a <mask>', doc(`<rect width="512" height="512" style="fill:url(#m)"/>`), 'Invalid fill reference "#m"'],
    ['mask="url(#c)" pointing at a <clipPath>', doc(`<rect width="512" height="512" mask="url(#c)"/>`), 'Invalid mask reference "#c"'],
    ['filter="url(#g)" pointing at a gradient', doc(`<rect width="512" height="512" filter="url(#g)"/>`), 'Invalid filter reference "#g"'],
    ['marker-start="url(#g)" pointing at a gradient', doc(`<path d="M0 0 L32 32" stroke="#000" marker-start="url(#g)"/>`), 'Invalid marker-start reference "#g"'],
    ["<style> rule mask:url(#f) pointing at a <filter>", doc(`<style>.a{mask:url(#f)}</style><rect class="a" width="512" height="512"/>`), 'Invalid mask reference "#f"'],
    ["clip-path to a <clipPath> in a foreign namespace", doc(`<clipPath xmlns="http://example.com/x" id="fc"><rect width="256" height="512"/></clipPath><rect width="512" height="512" clip-path="url(#fc)"/>`), "not a <clipPath>"],
    // references that leave the document
    ['<use href="other.svg#r">', doc(`<use href="other.svg#r"/>`), "Non-fragment reference"],
    ['<use xlink:href="other.svg#r">', doc(`<use xlink:href="other.svg#r"/>`, { ns: 'xmlns:xlink="http://www.w3.org/1999/xlink"' }), "Non-fragment reference"],
    ['fill="url(other.svg#g)"', doc(`<rect width="512" height="512" fill="url(other.svg#g)"/>`), "Non-fragment reference"],
    ['style="clip-path:url(https://example.com/a.svg#c)"', doc(`<rect width="512" height="512" style="clip-path:url(https://example.com/a.svg#c)"/>`), "Non-fragment reference"],
    // href under a prefix other than xlink:
    ['<feImage x:href="data:..."> with x bound to xlink', doc(`<filter id="fi"><feImage x:href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="/></filter><rect width="512" height="512" filter="url(#fi)"/>`, { ns: 'xmlns:x="http://www.w3.org/1999/xlink"' }), "Forbidden embedded raster image (<feImage x:href="],
    ['<use x:href="#missing"> with x bound to xlink', doc(`<use x:href="#missing"/>`, { ns: 'xmlns:x="http://www.w3.org/1999/xlink"' }), 'Missing referenced ID "missing" in x:href="#missing"'],
    ['<use q:href="#missing"> with q bound to xlink on the element', doc(`<use xmlns:q="http://www.w3.org/1999/xlink" q:href="#missing"/>`), 'Missing referenced ID "missing"'],
    ['<use foo:href="#r"> with foo not bound to xlink', doc(`<use foo:href="#r"/>`, { ns: 'xmlns:foo="http://example.com/foo"' }), "is ignored by resvg"],
    // editor namespaces declared under a different prefix
    ["Inkscape namespace bound to ns1", doc(`<rect width="512" height="512" ns1:label="x"/>`, { ns: 'xmlns:ns1="http://www.inkscape.org/namespaces/inkscape"' }), 'Inkscape namespace "http://www.inkscape.org/namespaces/inkscape"'],
    ["Sodipodi namespace bound to sp", doc(`<rect width="512" height="512"/>`, { ns: 'xmlns:sp="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd"' }), "Sodipodi namespace"],
    ["Illustrator namespace declared through <!ENTITY>", doc(`<rect width="512" height="512" i:knockout="Off"/>`, {
      head: `<?xml version="1.0"?>\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n  <!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">\n  <!ENTITY ns_graphs "http://ns.adobe.com/Graphs/1.0/">\n]>\n`,
      ns: 'xmlns:i="&ns_ai;" xmlns:graph="&ns_graphs;"'
    }), '"xmlns:i" (Adobe namespace "http://ns.adobe.com/AdobeIllustrator/10.0/")'],
    ["Adobe namespace as a default namespace on a child", doc(`<g xmlns="http://ns.adobe.com/Variables/1.0/"/>`), "Adobe namespace"]
  ];

  for (const [label, svg, expected] of rejected) {
    const res = lintSvgContent(svg, "fixture.svg");
    assertEqual(res.ok, false, `${label} is rejected`);
    assert(res.errors.some((e) => e.includes(expected)), `${label} reports "${expected}"`);
  }

  const accepted = [
    ['clip-path="url(#c)"', doc(`<rect width="512" height="512" clip-path="url(#c)"/>`)],
    ['clip-path="url( #c )" with inner whitespace', doc(`<rect width="512" height="512" clip-path="url( #c )"/>`)],
    ['fill="url(#g)" and stroke="url(#p)"', doc(`<rect width="512" height="512" fill="url(#g)" stroke="url(#p)"/>`)],
    ['fill="url(#g) #f00" with a fallback colour', doc(`<rect width="512" height="512" fill="url(#g) #f00"/>`)],
    ['entity-encoded fill="&#117;rl(#g)"', doc(`<rect width="512" height="512" fill="&#117;rl(#g)"/>`)],
    ["<style> rules with fill, mask and filter", doc(`<style>.a{fill:url(#g);mask:url(#m)} .b{filter:url(#f)}</style><rect class="a b" width="512" height="512"/>`)],
    ['style="fill:url(#g) !important"', doc(`<rect width="512" height="512" style="fill:url(#g) !important"/>`)],
    ["marker-start/mid/end pointing at a <marker>", doc(`<path d="M0 0 L32 32" stroke="#000" marker-start="url(#mk)" marker-mid="url(#mk)" style="marker-end:url(#mk)"/>`)],
    ["clip-path to an svg:-prefixed <clipPath>", doc(`<svg:clipPath id="sc"><rect width="256" height="512"/></svg:clipPath><rect width="512" height="512" clip-path="url(#sc)"/>`, { ns: 'xmlns:svg="http://www.w3.org/2000/svg"' })],
    ['<use x:href="#r"> with x bound to xlink', doc(`<use x:href="#r"/>`, { ns: 'xmlns:x="http://www.w3.org/1999/xlink"' })],
    ['<feImage x:href="#r"> with x bound to xlink', doc(`<filter id="fi"><feImage x:href="#r"/></filter><rect width="512" height="512" filter="url(#fi)"/>`, { ns: 'xmlns:x="http://www.w3.org/1999/xlink"' })],
    ["url() text inside a <desc> is not a reference", doc(`<desc>Uses URL(#c) for the clip</desc><rect width="512" height="512"/>`)]
  ];

  for (const [label, svg] of accepted) {
    const res = lintSvgContent(svg, "fixture.svg");
    assert(res.ok, `${label} is accepted${res.ok ? "" : `: ${res.errors.join(" | ")}`}`);
  }
}

console.log("\n=======================================================");
console.log(`  RESULTS: ${passedTests}/${totalTests} tests passed`);
console.log("=======================================================\n");

if (passedTests !== totalTests) {
  process.exit(1);
}

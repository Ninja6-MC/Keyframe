#!/usr/bin/env node

/**
 * Keyframe Automated Static SVG Vector Master Linter
 *
 * Enforces production-grade vector constraints across all SVG masters in textures/:
 * 1. Root viewBox is exactly "0 0 512 512" (512x512 master resolution requirement).
 * 2. Absolute prohibition of editor namespaces: Inkscape, Sodipodi and Adobe namespace
 *    URIs under any prefix (including URIs declared through <!ENTITY>), plus the
 *    xmlns:inkscape, xmlns:sodipodi and xmlns:illustrator prefixes.
 * 3. Absolute prohibition of embedded raster images (<image>, and <feImage> with a
 *    non-fragment href under any prefix).
 * 4. Referential integrity for clipPath definitions, url(#id) and href="#id" references,
 *    preventing silent @resvg/resvg-js rendering bugs and missing layer artifacts. Only
 *    the forms resvg honours pass: lowercase unquoted same-document url(#id) on fill,
 *    stroke, clip-path, mask, filter or marker-start/mid/end pointing at an element of
 *    the matching type, and same-document href="#id" under no prefix or an xlink-bound one.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, "..", "..");
export const DEFAULT_TEXTURES_DIR = path.join(ROOT_DIR, "textures");

export const REQUIRED_VIEWBOX = "0 0 512 512";

export const FORBIDDEN_NAMESPACES = Object.freeze([
  "xmlns:inkscape",
  "xmlns:sodipodi",
  "xmlns:illustrator"
]);

export const SVG_NS = "http://www.w3.org/2000/svg";
export const XLINK_NS = "http://www.w3.org/1999/xlink";

/**
 * Editor namespace URIs, matched case-insensitively as a prefix of the declared URI.
 * Every Adobe namespace (Illustrator, Graphs, SaveForWeb, Variables, XMP, ...) sits
 * under ns.adobe.com.
 */
export const FORBIDDEN_NAMESPACE_URIS = Object.freeze([
  { editor: "Inkscape", uri: "http://www.inkscape.org/namespaces/inkscape" },
  { editor: "Sodipodi", uri: "http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" },
  { editor: "Sodipodi", uri: "http://inkscape.sourceforge.net/DTD/sodipodi-0.dtd" },
  { editor: "Adobe", uri: "http://ns.adobe.com/" },
  { editor: "Adobe", uri: "adobe:ns:meta/" }
]);

/**
 * The properties on which resvg applies a url(#id) reference, and the SVG elements each
 * one accepts as a target. Property names are case-sensitive in resvg, and the `marker`
 * shorthand is not applied at all.
 */
export const URL_REFERENCE_TARGETS = Object.freeze({
  fill: ["linearGradient", "radialGradient", "pattern"],
  stroke: ["linearGradient", "radialGradient", "pattern"],
  "clip-path": ["clipPath"],
  mask: ["mask"],
  filter: ["filter"],
  "marker-start": ["marker"],
  "marker-mid": ["marker"],
  "marker-end": ["marker"]
});

function editorForUri(uri) {
  const normalized = uri.trim().toLowerCase();
  const hit = FORBIDDEN_NAMESPACE_URIS.find((ns) => normalized.startsWith(ns.uri.toLowerCase()));
  return hit ? hit.editor : null;
}

function truncate(text, max = 48) {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

const PREDEFINED_ENTITIES = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function decodeXml(text, entities, depth = 0) {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_][\w.-]*);/g, (whole, ref) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return whole;
      }
    }
    if (ref in PREDEFINED_ENTITIES) return PREDEFINED_ENTITIES[ref];
    if (entities.has(ref) && depth < 8) return decodeXml(entities.get(ref), entities, depth + 1);
    return whole;
  });
}

function splitQName(qname) {
  const i = qname.indexOf(":");
  return i === -1 ? { prefix: "", local: qname } : { prefix: qname.slice(0, i), local: qname.slice(i + 1) };
}

function parseDeclarations(cssText, where) {
  const decls = [];
  for (const part of cssText.split(";")) {
    const colon = part.indexOf(":");
    if (colon === -1) continue;
    const property = part.slice(0, colon).trim();
    if (property) decls.push({ property, value: part.slice(colon + 1), where: `"${property}" ${where}` });
  }
  return decls;
}

/**
 * Tokenizes an SVG document (comments already stripped) into elements with decoded
 * attribute values and in-scope namespace bindings, internal DTD entity declarations,
 * and every property declaration that can carry a url() reference: attributes, style
 * attributes and <style> rules.
 */
export function parseSvgDocument(clean) {
  const entityDecls = [];
  const entities = new Map();
  const entityRegex = /<!ENTITY\s+([^\s%"']+)\s+(?:"([^"]*)"|'([^']*)')\s*>/g;
  let entityMatch;
  while ((entityMatch = entityRegex.exec(clean)) !== null) {
    const name = entityMatch[1];
    const raw = entityMatch[2] ?? entityMatch[3];
    if (!entities.has(name)) entities.set(name, raw);
  }
  for (const [name, raw] of entities) {
    entityDecls.push({ name, value: decodeXml(raw, entities) });
  }

  const elements = [];
  const declarations = [];
  const stack = [];
  let styleText = null;

  const tokenRegex = /<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE(?:[^[>]|\[[\s\S]*?\])*>|<\?[\s\S]*?\?>|<(\/?)([^\s/>!?]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let lastIndex = 0;
  let token;
  while ((token = tokenRegex.exec(clean)) !== null) {
    if (styleText !== null) {
      styleText += decodeXml(clean.slice(lastIndex, token.index), entities);
      if (token[1] !== undefined) styleText += token[1];
    }
    lastIndex = tokenRegex.lastIndex;

    const [, , closing, qname, rawAttrs, selfClosing] = token;
    if (!qname) continue;

    if (closing) {
      const openIdx = stack.map((e) => e.name).lastIndexOf(qname);
      if (openIdx !== -1) {
        for (const el of stack.splice(openIdx)) {
          if (el.local === "style" && styleText !== null) {
            const css = styleText.replace(/\/\*[\s\S]*?\*\//g, "");
            const blockRegex = /\{([^{}]*)\}/g;
            let block;
            while ((block = blockRegex.exec(css)) !== null) {
              declarations.push(...parseDeclarations(block[1], "in <style>"));
            }
            styleText = null;
          }
        }
      }
      continue;
    }

    const attrs = [];
    const attrRegex = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
      const name = attrMatch[1];
      attrs.push({ name, ...splitQName(name), value: decodeXml(attrMatch[2] ?? attrMatch[3], entities) });
    }

    const parentScope = stack.length ? stack[stack.length - 1].scope : new Map([["xml", "http://www.w3.org/XML/1998/namespace"]]);
    const scope = new Map(parentScope);
    for (const attr of attrs) {
      if (attr.name === "xmlns") scope.set("", attr.value.trim());
      else if (attr.prefix === "xmlns") scope.set(attr.local, attr.value.trim());
    }

    const { prefix, local } = splitQName(qname);
    const el = { name: qname, prefix, local, ns: scope.get(prefix), attrs, scope };
    elements.push(el);

    for (const attr of attrs) {
      if (attr.name === "xmlns" || attr.prefix === "xmlns") continue;
      if (attr.name === "style") {
        declarations.push(...parseDeclarations(attr.value, `in style attribute on <${qname}>`));
      } else {
        declarations.push({ property: attr.name, value: attr.value, where: `"${attr.name}" attribute on <${qname}>` });
      }
    }

    if (!selfClosing) {
      stack.push(el);
      if (local === "style") styleText = "";
    }
  }

  return { elements, entityDecls, declarations };
}

/**
 * Strips XML comments so documentation and commented references do not cause false positives.
 */
export function stripComments(svgText) {
  return svgText.replace(/<!--[\s\S]*?-->/g, "");
}

/**
 * Normalizes a file path to POSIX format.
 */
export function toPosix(p) {
  return p.replace(/\\/g, "/");
}

/**
 * Recursively locates all .svg files under target directory.
 */
export function findSvgFiles(dir) {
  const results = [];
  if (!fs.existsSync(dir)) return results;

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".svg")) {
        results.push(fullPath);
      }
    }
  }

  walk(dir);
  return results.sort();
}

/**
 * Lints the SVG content string against all Keyframe vector master invariants.
 *
 * @param {string} svgContent Raw SVG source text
 * @param {string} [filePath="<inline>"] Context path for error formatting
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function lintSvgContent(svgContent, filePath = "<inline>") {
  const errors = [];
  const clean = stripComments(svgContent);

  // SVG is XML and case-sensitive: resvg ignores `viewbox=`, `ID=` and `<clippath>`, so
  // element and attribute names below are matched exactly. The viewBox attribute name is
  // anchored on preceding whitespace so `data-viewBox=` never counts.

  // 1. Root <svg> element and viewBox verification
  const rootSvgMatch = clean.match(/<svg\b([^>]*)>/);
  if (!rootSvgMatch) {
    errors.push(`${filePath}: Missing <svg> root element`);
    return { ok: false, errors };
  }

  const svgAttrs = rootSvgMatch[1];
  const viewBoxMatch = svgAttrs.match(/(?:^|\s)viewBox\s*=\s*(["'])(.*?)\1/);
  if (!viewBoxMatch) {
    errors.push(`${filePath}: Missing viewBox attribute (viewBox must be exactly "${REQUIRED_VIEWBOX}")`);
  } else {
    const rawViewBox = viewBoxMatch[2];
    const normalizedViewBox = rawViewBox.trim().replace(/\s+/g, " ");
    if (normalizedViewBox !== REQUIRED_VIEWBOX) {
      errors.push(`${filePath}: Invalid viewBox "${rawViewBox}" (must be exactly "${REQUIRED_VIEWBOX}")`);
    }
  }

  const doc = parseSvgDocument(clean);

  // 2. Forbidden editor namespaces & editor residue. Editors are identified by namespace
  // URI, not prefix: Inkscape may bind its namespace to `ns1`, and Illustrator writes
  // `xmlns:i="&ns_ai;"` with the URI declared in an internal <!ENTITY>.
  for (const entity of doc.entityDecls) {
    const editor = editorForUri(entity.value);
    if (editor) {
      errors.push(`${filePath}: Forbidden editor namespace detected: ${editor} URI in <!ENTITY ${entity.name} "${entity.value}">`);
    }
  }

  const reportedNsDecls = new Set();
  for (const el of doc.elements) {
    for (const attr of el.attrs) {
      if (attr.name !== "xmlns" && !attr.name.startsWith("xmlns:")) continue;
      const editor = editorForUri(attr.value);
      const byPrefix = FORBIDDEN_NAMESPACES.includes(attr.name);
      if (!editor && !byPrefix) continue;
      const key = `${attr.name}=${attr.value}`;
      if (reportedNsDecls.has(key)) continue;
      reportedNsDecls.add(key);
      const detail = editor ? ` (${editor} namespace "${attr.value}")` : "";
      errors.push(`${filePath}: Forbidden editor namespace detected: "${attr.name}"${detail}`);
    }
  }

  const editorTagMatch = clean.match(/<(?:inkscape|sodipodi):[a-z0-9_-]+/i);
  if (editorTagMatch) {
    errors.push(`${filePath}: Forbidden editor element detected: "${editorTagMatch[0]}"`);
  }

  // 3. Forbidden embedded raster images
  if (/<(?:[a-zA-Z0-9_-]+:)?image\b/i.test(clean)) {
    errors.push(`${filePath}: Forbidden embedded raster image (<image>) detected`);
  }

  // <feImage> renders an external or data-URI raster inside a filter just like <image>.
  // Only a same-document fragment reference (href="#id") keeps the source vector. Any
  // attribute whose local name is href counts, whatever its prefix: resvg honours
  // `x:href` when `x` is bound to the xlink namespace.
  for (const el of doc.elements) {
    if (el.local.toLowerCase() !== "feimage") continue;
    for (const attr of el.attrs) {
      if (attr.local.toLowerCase() === "href" && !attr.value.trim().startsWith("#")) {
        errors.push(`${filePath}: Forbidden embedded raster image (<feImage ${attr.name}="${truncate(attr.value)}">) detected`);
      }
    }
  }

  // 4. ClipPath, url(#id) and href="#id" referential integrity
  const idTargets = new Map();
  for (const el of doc.elements) {
    const idAttr = el.attrs.find((a) => a.name === "id");
    const id = idAttr ? idAttr.value.trim() : "";
    if (id && !idTargets.has(id)) {
      idTargets.set(id, el);
    }
    if (el.local === "clipPath" && !id) {
      errors.push(`${filePath}: <clipPath> element is missing required "id" attribute`);
    }
  }

  // href: resvg reads an unprefixed href or one whose prefix is bound to the xlink
  // namespace, and only resolves a same-document fragment. Everything else is dropped.
  for (const el of doc.elements) {
    for (const attr of el.attrs) {
      if (attr.local !== "href") continue;
      if (attr.prefix && el.scope.get(attr.prefix) !== XLINK_NS) {
        errors.push(`${filePath}: Attribute ${attr.name}="${truncate(attr.value)}" is ignored by resvg (prefix "${attr.prefix}" is not bound to ${XLINK_NS})`);
        continue;
      }
      const target = attr.value.trim();
      if (el.local === "feImage" && !target.startsWith("#")) continue; // reported as a raster above
      if (!/^#[^\s#]+$/.test(target)) {
        errors.push(`${filePath}: Non-fragment reference ${attr.name}="${truncate(attr.value)}" (only same-document href="#id" references are allowed)`);
        continue;
      }
      const refId = target.slice(1);
      if (!idTargets.has(refId)) {
        errors.push(`${filePath}: Missing referenced ID "${refId}" in ${attr.name}="#${refId}" (element with id="${refId}" does not exist in file)`);
      }
    }
  }

  // url(): every spelling of the function in any attribute, style attribute or <style>
  // rule is inspected. resvg only honours exactly `url(#id)` (lowercase, no space before
  // the parenthesis, unquoted, same-document) on a lowercase property it knows, pointing
  // at an element of the type that property needs. Anything else renders silently wrong
  // (unclipped, black, or invisible), so anything else is an error.
  for (const decl of doc.declarations) {
    const fnRegex = /(?<![\w-])url\s*\(/gi;
    let fnMatch;
    while ((fnMatch = fnRegex.exec(decl.value)) !== null) {
      const rest = decl.value.slice(fnMatch.index);
      const parsed = rest.match(/^url\s*\(\s*(["']?)([^"')]*?)\s*\1\s*\)/i);
      const snippet = parsed ? parsed[0] : truncate(rest.split(/[;\s]/)[0]);
      const where = decl.where;

      if (!rest.startsWith("url(")) {
        errors.push(`${filePath}: ${snippet} in ${where} is not recognised by resvg (write url(#id): lowercase, with no space before "(")`);
      }
      if (!parsed) {
        errors.push(`${filePath}: Malformed reference ${snippet} in ${where}`);
        continue;
      }
      const [, quote, rawTarget] = parsed;
      const target = rawTarget.trim();
      if (quote) {
        errors.push(`${filePath}: Quoted reference ${snippet} is not resolved by resvg (write url(${target}) without quotes)`);
      }
      if (!/^#[^\s#]+$/.test(target)) {
        errors.push(`${filePath}: Non-fragment reference ${snippet} in ${where} (only same-document url(#id) references are allowed)`);
        continue;
      }

      const refId = target.slice(1);
      const targetEl = idTargets.get(refId);
      if (!targetEl) {
        errors.push(`${filePath}: Missing referenced ID "${refId}" in url(#${refId}) (element with id="${refId}" does not exist in file)`);
        continue;
      }

      const allowed = URL_REFERENCE_TARGETS[decl.property];
      if (!allowed) {
        errors.push(`${filePath}: url(#${refId}) in ${where} is not applied by resvg (url() references are only honoured on ${Object.keys(URL_REFERENCE_TARGETS).join(", ")}; property names are case-sensitive)`);
      } else if (targetEl.ns !== SVG_NS || !allowed.includes(targetEl.local)) {
        const expected = allowed.map((t) => `<${t}>`).join(" or ");
        errors.push(`${filePath}: Invalid ${decl.property} reference "#${refId}": element exists but is not a ${expected} (found <${targetEl.name}>)`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}

/**
 * Lints a single SVG file on disk.
 *
 * @param {string} filePath Absolute or relative path to SVG file
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function lintSvgFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return lintSvgContent(content, toPosix(path.relative(ROOT_DIR, filePath)));
  } catch (err) {
    return {
      ok: false,
      errors: [`${toPosix(filePath)}: Failed to read file: ${err.message}`]
    };
  }
}

/**
 * Lints all SVG files in the given directory (or single file).
 *
 * @param {string} [targetDir=DEFAULT_TEXTURES_DIR] Directory or file to inspect
 * @returns {{ ok: boolean, errors: string[], filesChecked: number }}
 */
export function lintVectors(targetDir = DEFAULT_TEXTURES_DIR) {
  const allErrors = [];
  let files = [];

  if (!fs.existsSync(targetDir)) {
    return {
      ok: false,
      errors: [`Target path does not exist: "${toPosix(targetDir)}"`],
      filesChecked: 0
    };
  }

  const stat = fs.statSync(targetDir);
  if (stat.isFile()) {
    files = [targetDir];
  } else {
    files = findSvgFiles(targetDir);
  }

  for (const file of files) {
    const result = lintSvgFile(file);
    if (!result.ok) {
      allErrors.push(...result.errors);
    }
  }

  return {
    ok: allErrors.length === 0,
    errors: allErrors,
    filesChecked: files.length
  };
}

/**
 * CLI execution handler
 */
export function runCli() {
  const target = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : DEFAULT_TEXTURES_DIR;
  const relTarget = toPosix(path.relative(process.cwd(), target)) || ".";

  console.log(`\n======================================================`);
  console.log(`  Keyframe Vector Master Linter`);
  console.log(`  Target: ${relTarget}`);
  console.log(`======================================================\n`);

  const result = lintVectors(target);

  if (result.ok) {
    console.log(`✓ PASS: All ${result.filesChecked} vector master(s) conform to specifications.`);
    console.log(`        - viewBox: ${REQUIRED_VIEWBOX}`);
    console.log(`        - Editor namespaces: None`);
    console.log(`        - Embedded raster images: None`);
    console.log(`        - ClipPath, url(#id) and href="#id" references: Fully verified\n`);
    process.exit(0);
  } else {
    console.error(`❌ FAIL: Vector master linter detected ${result.errors.length} error(s) across ${result.filesChecked} file(s):\n`);
    for (const err of result.errors) {
      console.error(`  - ${err}`);
    }
    console.error("");
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  runCli();
}

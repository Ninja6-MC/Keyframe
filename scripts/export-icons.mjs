#!/usr/bin/env node
// Regenerates every Keyframe icon variant from docs/assets/icon-master.svg.
//
//   node scripts/export-icons.mjs
//
// The master holds geometry only. This script applies colour and plates.
// See brand/ICON_PLAN.md sections 3, 5, 7, and 8.

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RESVG = '@resvg/resvg-js@2.6.2';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'docs', 'assets');
const TOOLS = join(ROOT, 'build', 'icon-tools');

const CANVAS = 1024;
const CENTRE = CANVAS / 2;
const SAFE_RADIUS = 460; // ICON_PLAN section 2

// ---------------------------------------------------------------- palette

const PLATE = '#12161A';
const SKY_DARK = '#38BDF8';      // structural stroke, dark contexts (8.99:1 on #12161A)
const SKY_LIGHT = '#0284C7';     // structural stroke, light contexts (3.86:1 on #FFFFFF)
const AMBER = '#FFAC1C';         // family accent, dark contexts (9.29:1 on #12161A)
const AMBER_DARK = '#B8730A';    // family accent, light contexts (3.85:1 on #FFFFFF)
const SILVER = '#E8EDF2';

const VARIANTS = [
  // v1 - primary, opaque. Platform avatars: Modrinth, Hangar, GitHub, CurseForge.
  { file: 'icon', geo: 'geo', plate: PLATE, stroke: SKY_DARK, dot: AMBER,
    sizes: [64, 128, 180, 256, 400, 512, 1024], opaque: true },

  // v1r - rounded plate. Apple touch icon, docs headers.
  { file: 'icon-rounded', geo: 'geo', plate: PLATE, rx: 225, stroke: SKY_DARK, dot: AMBER,
    sizes: [180, 256, 512, 1024], opaque: false },

  // v2/v3 - transparent, one per theme.
  { file: 'icon-transparent-dark', geo: 'geo', stroke: SKY_DARK, dot: AMBER,
    sizes: [64, 128, 256, 512], opaque: false },
  { file: 'icon-transparent-light', geo: 'geo', stroke: SKY_LIGHT, dot: AMBER_DARK,
    sizes: [64, 128, 256, 512], opaque: false, assertLight: true },

  // v4 - simplified small cut, <=24px (stroke 118, dot dropped).
  { file: 'icon-small-dark', geo: 'geo-small', stroke: SKY_DARK,
    sizes: [16, 24, 32, 48, 64], opaque: false },
  { file: 'icon-small-light', geo: 'geo-small', stroke: SKY_LIGHT,
    sizes: [16, 24, 32, 48, 64], opaque: false, assertLight: true },
  { file: 'icon-small-plate', geo: 'geo-small', plate: PLATE, stroke: SKY_DARK,
    sizes: [64, 128], opaque: true },

  // v5 - monochrome. Dots dropped.
  { file: 'icon-mono-dark', geo: 'geo-small', stroke: SILVER, sizes: [] },
  { file: 'icon-mono-light', geo: 'geo-small', stroke: PLATE, sizes: [] },
];

// ---------------------------------------------------------------- master

const master = readFileSync(join(ASSETS, 'icon-master.svg'), 'utf8');
const defsMatch = master.match(/<defs>[\s\S]*?<\/defs>/);
if (!defsMatch) throw new Error('icon-master.svg has no <defs> block');
const defs = defsMatch[0];

// ---------------------------------------------------- safe-zone assertion

function worstRadius(geoBlock) {
  const shiftMatch = geoBlock.match(/translate\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/);
  const shift = shiftMatch ? [+shiftMatch[1], +shiftMatch[2]] : [0, 0];

  const cand = [];

  // Polylines
  const polyMatches = [...geoBlock.matchAll(/<polyline points="([^"]+)"[\s\S]*?stroke-width="(\d+)"/g)];
  for (const [, ptsStr, widthStr] of polyMatches) {
    const pts = ptsStr.trim().split(/\s+/).map((p) => p.split(',').map(Number));
    const hw = Number(widthStr) / 2;

    for (const [i, j] of [[0, 1], [pts.length - 1, pts.length - 2]]) {
      if (pts[i] && pts[j]) {
        const [x, y] = pts[i];
        const [xn, yn] = pts[j];
        const len = Math.hypot(x - xn, y - yn);
        const ux = (x - xn) / len;
        const uy = (y - yn) / len;
        const ex = x + ux * hw + shift[0];
        const ey = y + uy * hw + shift[1];
        cand.push([ex - uy * hw, ey + ux * hw], [ex + uy * hw, ey - ux * hw]);
      }
    }
    for (let k = 0; k < pts.length; k++) {
      const [x, y] = pts[k];
      for (const a of [-1, 1]) for (const b of [-1, 1]) {
        cand.push([x + shift[0] + a * hw, y + shift[1] + b * hw]);
      }
    }
  }

  // Polygons
  const polygonMatches = [...geoBlock.matchAll(/<polygon points="([^"]+)"[\s\S]*?stroke-width="(\d+)"/g)];
  for (const [, ptsStr, widthStr] of polygonMatches) {
    const pts = ptsStr.trim().split(/\s+/).map((p) => p.split(',').map(Number));
    const hw = Number(widthStr) / 2;
    for (let k = 0; k < pts.length; k++) {
      const [x, y] = pts[k];
      for (const a of [-1, 1]) for (const b of [-1, 1]) {
        cand.push([x + shift[0] + a * hw, y + shift[1] + b * hw]);
      }
    }
  }

  let worst = 0;
  let at = null;
  for (const [x, y] of cand) {
    const r = Math.hypot(x - CENTRE, y - CENTRE);
    if (r > worst) { worst = r; at = [x, y]; }
  }

  // Circles
  for (const m of geoBlock.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)) {
    const cx = +m[1] + shift[0];
    const cy = +m[2] + shift[1];
    const cr = +m[3];
    const r = Math.hypot(cx - CENTRE, cy - CENTRE) + cr;
    if (r > worst) { worst = r; at = [cx, cy]; }
  }
  return { worst, at };
}

// ---------------------------------------------------------------- compose

function compose(v) {
  const paint = [`stroke="${v.stroke}"`, v.dot ? `fill="${v.dot}"` : null]
    .filter(Boolean).join(' ');
  const plateAttr = v.rx ? ` rx="${v.rx}"` : '';
  const plate = v.plate
    ? `\n  <rect width="${CANVAS}" height="${CANVAS}"${plateAttr} fill="${v.plate}" />`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS} ${CANVAS}" width="${CANVAS}" height="${CANVAS}">
  <!-- GENERATED by scripts/export-icons.mjs from icon-master.svg. Do not edit.
       Colour and plate are applied here; the master carries geometry only. -->${plate}
  ${defs}
  <use href="#${v.geo}" ${paint} />
</svg>
`;
}

// ---------------------------------------------------------------- rasterize

async function loadResvg() {
  try {
    const mod = await import('@resvg/resvg-js');
    if (mod.Resvg) return mod;
  } catch {}

  const entry = join(TOOLS, 'node_modules', '@resvg', 'resvg-js', 'index.js');
  if (!existsSync(entry)) {
    console.log(`  fetching ${RESVG} into build/icon-tools ...`);
    mkdirSync(TOOLS, { recursive: true });
    writeFileSync(join(TOOLS, 'package.json'), '{"private":true}\n');
    execSync(`npm install --no-save --prefix "${TOOLS}" ${RESVG}`, { stdio: 'inherit' });
  }
  return import(pathToFileURL(entry).href);
}

const { Resvg } = await loadResvg();

function hexAt(px, i) {
  return '#' + [px[i], px[i + 1], px[i + 2]]
    .map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ---------------------------------------------------------------- run

let failures = 0;

console.log(`safe zone (limit ${SAFE_RADIUS}):`);
const geoBlocks = [...defs.matchAll(/<g id="(geo[a-z0-9\-]*)">([\s\S]*?<\/g>)/g)];
for (const [, id, blockContent] of geoBlocks) {
  const { worst, at } = worstRadius(blockContent);
  const ok = worst <= SAFE_RADIUS;
  if (!ok) failures++;
  console.log(`  ${id.padEnd(10)}  r = ${worst.toFixed(1)}` +
    ` at (${at.map((n) => n.toFixed(0)).join(',')})  ${ok ? 'ok' : 'BREACH'}`);
}
if (failures) {
  console.error('\nrefusing to export: artwork would be clipped by a circular crop.');
  process.exit(1);
}

console.log('\nvariants:');
for (const v of VARIANTS) {
  const svg = compose(v);
  writeFileSync(join(ASSETS, `${v.file}.svg`), svg);
  const written = [];

  for (const size of v.sizes) {
    const img = new Resvg(svg, {
      fitTo: { mode: 'width', value: size },
      font: { loadSystemFonts: false }
    }).render();

    // Post-export paint check
    if (v.assertLight) {
      const px = img.pixels;
      let seen = false;
      let leaked = false;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] < 250) continue;
        const hex = hexAt(px, i);
        if (hex === v.stroke.toUpperCase()) seen = true;
        if (hex === SKY_DARK.toUpperCase()) leaked = true;
      }
      if (!seen || leaked) {
        console.error(`  ${v.file}@${size}: expected ${v.stroke}` +
          (leaked ? `, found dark-theme ${SKY_DARK}` : ', not found'));
        failures++;
      }
    }

    writeFileSync(join(ASSETS, `${v.file}-${size}.png`), img.asPng());
    written.push(String(size));
  }
  console.log(`  ${v.file.padEnd(24)}  ${written.join(' ') || '(svg only)'}`);
}

if (failures) process.exit(1);
console.log('\ndone. All assets exported and assertions passed.');

#!/usr/bin/env node

/**
 * Keyframe -> TextureStudio master sync.
 *
 * TextureStudio consumes **SVG masters**, not compiled rasters. Its 3D viewport loads
 * `/textures/<name>.svg` straight into an `<img>` and draws it to a canvas (`src/app.js`,
 * `loadTexture`), and its own compiler (`tools/build-pack.mjs`) rasterizes the same SVGs
 * itself. The only place TextureStudio reads PNGs is the *external comparison pack* path
 * (`cache/packs/<pack>/assets/minecraft/textures/block/*.png`), which is fed by dropping a
 * built `.zip` into `cache/packs/` and is not what this tool is for. Pushing Keyframe's
 * compiled rasters into `textures/` would therefore feed the Studio the wrong artifact
 * entirely - it would lose the resolution independence that is the whole point of the
 * viewport.
 *
 * Directory-shape mismatch: Keyframe's masters are namespaced, `textures/block/<name>.svg`;
 * TextureStudio's `discoverActivePack()` does a single non-recursive `readdirSync` and
 * expects them flat, `textures/<name>.svg`. This tool therefore **flattens by basename**.
 * Basenames are already the Minecraft texture ids and are unique across the pack, so the
 * mapping is lossless in practice; if two namespaces ever do collide the sync aborts rather
 * than silently letting one master overwrite the other.
 *
 * Nothing here touches a tracked TextureStudio file. `TextureStudio/textures/` is gitignored
 * in that repository ("Creative Vector Master Assets (Authored locally)"), which is both why
 * the two copies were free to drift and why writing into it from here is safe.
 *
 * Usage:
 *   node tools/sync-studio.mjs [--studio <path>] [--textures <path>]
 *                              [--watch] [--dry-run] [--prune] [--quiet]
 *
 * Target resolution order: `--studio <path>`, then $KEYFRAME_STUDIO_DIR, then the sibling
 * `../TextureStudio`. A target that does not exist, or that does not look like the
 * TextureStudio repository, is a hard error - the sync never creates a stray directory
 * somewhere a typo pointed it.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const ROOT_DIR = path.resolve(__dirname, "..");
export const DEFAULT_TEXTURES_DIR = path.join(ROOT_DIR, "textures");
export const STUDIO_DIR_ENV = "KEYFRAME_STUDIO_DIR";

/** Files that identify a directory as the TextureStudio checkout rather than an arbitrary path. */
export const STUDIO_MARKERS = [
  path.join("tools", "server.mjs"),
  path.join("tools", "build-pack.mjs")
];

/** A user-facing failure: reported as a clean message and exit 1, never a stack trace. */
export class SyncError extends Error {
  constructor(message) {
    super(message);
    this.name = "SyncError";
  }
}

/**
 * Resolves which TextureStudio checkout to sync into, without touching the filesystem.
 * Returns the path and where it came from, so the CLI can say which knob to turn.
 */
export function resolveStudioDir({ cliPath = null, env = process.env, repoRoot = ROOT_DIR } = {}) {
  if (cliPath) {
    return { dir: path.resolve(cliPath), source: "--studio" };
  }
  const fromEnv = env[STUDIO_DIR_ENV];
  if (fromEnv && fromEnv.trim() !== "") {
    return { dir: path.resolve(fromEnv.trim()), source: `$${STUDIO_DIR_ENV}` };
  }
  return { dir: path.resolve(repoRoot, "..", "TextureStudio"), source: "default sibling" };
}

/**
 * Verifies the sync target before anything is written.
 *
 * The Studio's own `textures/` is gitignored, so a fresh clone legitimately has no such
 * directory and creating it there is correct. Creating the *checkout* is not: a mistyped
 * `--studio` must fail loudly rather than growing an empty tree nobody will ever look in.
 */
export function assertStudioTarget(studioDir, { source = "--studio" } = {}) {
  if (!fs.existsSync(studioDir)) {
    throw new SyncError(
      `TextureStudio was not found at ${studioDir} (from ${source}).\n` +
      `  Pass --studio <path>, or set ${STUDIO_DIR_ENV}, to point at your checkout.\n` +
      `  Refusing to create it: the sync target is an existing repository, not a directory to conjure.`
    );
  }
  if (!fs.statSync(studioDir).isDirectory()) {
    throw new SyncError(`TextureStudio target ${studioDir} (from ${source}) is a file, not a directory.`);
  }
  const found = STUDIO_MARKERS.filter((marker) => fs.existsSync(path.join(studioDir, marker)));
  if (found.length === 0) {
    throw new SyncError(
      `${studioDir} (from ${source}) does not look like the TextureStudio repository.\n` +
      `  Expected at least one of: ${STUDIO_MARKERS.map((m) => m.split(path.sep).join("/")).join(", ")}.\n` +
      `  Refusing to sync into it.`
    );
  }
  return path.join(studioDir, "textures");
}

/**
 * Collects every SVG master under Keyframe's textures tree, recursively, and works out the
 * flat name each one takes in the Studio. Sorted so a run is reproducible and a diff of two
 * runs is readable.
 */
export function collectMasters(texturesDir = DEFAULT_TEXTURES_DIR) {
  if (!fs.existsSync(texturesDir)) {
    throw new SyncError(`Keyframe texture masters were not found at ${texturesDir}.`);
  }

  const masters = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".svg") {
        masters.push({
          fullPath: full,
          relPath: path.relative(texturesDir, full).split(path.sep).join("/"),
          flatName: entry.name
        });
      }
    }
  };
  walk(texturesDir);
  masters.sort((a, b) => a.flatName.localeCompare(b.flatName) || a.relPath.localeCompare(b.relPath));

  const byFlatName = new Map();
  const collisions = [];
  for (const master of masters) {
    const previous = byFlatName.get(master.flatName);
    if (previous) {
      collisions.push(`${master.flatName}: ${previous.relPath} and ${master.relPath}`);
    } else {
      byFlatName.set(master.flatName, master);
    }
  }
  if (collisions.length > 0) {
    throw new SyncError(
      `Flattening textures/ into TextureStudio's flat textures/ would collide:\n` +
      collisions.map((c) => `  - ${c}`).join("\n") +
      `\n  TextureStudio discovers textures by basename, so two namespaces cannot share one.`
    );
  }

  return masters;
}

/**
 * Works out what a sync would do, without doing it. `--dry-run` and the tests both read
 * this rather than a report the writer produced after the fact.
 */
export function planSync(masters, destDir) {
  const actions = [];
  for (const master of masters) {
    const dest = path.join(destDir, master.flatName);
    let status = "create";
    if (fs.existsSync(dest)) {
      const same = fs.readFileSync(dest).equals(fs.readFileSync(master.fullPath));
      status = same ? "unchanged" : "update";
    }
    actions.push({ ...master, dest, status });
  }

  const known = new Set(masters.map((m) => m.flatName));
  const extras = fs.existsSync(destDir)
    ? fs.readdirSync(destDir, { withFileTypes: true })
        .filter((e) => e.isFile() && path.extname(e.name).toLowerCase() === ".svg" && !known.has(e.name))
        .map((e) => e.name)
        .sort()
    : [];

  return { actions, extras, destDir };
}

/**
 * One-shot sync. This is the mode that makes the sync reproducible and testable; --watch is
 * a loop around it.
 */
export function syncOnce({
  studioDir,
  studioSource = "--studio",
  texturesDir = DEFAULT_TEXTURES_DIR,
  dryRun = false,
  prune = false,
  log = console.log
} = {}) {
  const destDir = assertStudioTarget(studioDir, { source: studioSource });
  const masters = collectMasters(texturesDir);
  const plan = planSync(masters, destDir);

  const created = [];
  const updated = [];
  const unchanged = [];
  const pruned = [];

  if (!dryRun && !fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  for (const action of plan.actions) {
    if (action.status === "unchanged") {
      unchanged.push(action.flatName);
      continue;
    }
    if (!dryRun) {
      fs.copyFileSync(action.fullPath, action.dest);
    }
    (action.status === "create" ? created : updated).push(action.flatName);
  }

  if (prune) {
    for (const extra of plan.extras) {
      if (!dryRun) fs.rmSync(path.join(destDir, extra), { force: true });
      pruned.push(extra);
    }
  }

  const summary = {
    destDir,
    texturesDir,
    dryRun,
    created,
    updated,
    unchanged,
    pruned,
    extras: prune ? [] : plan.extras,
    total: masters.length
  };

  if (log) reportSummary(summary, log);
  return summary;
}

/** Human-readable one-run report. Kept separate so tests can call syncOnce with log: null. */
export function reportSummary(summary, log = console.log) {
  const prefix = summary.dryRun ? "[dry-run] " : "";
  log(
    `${prefix}${summary.total} master(s) -> ${summary.destDir}  ` +
    `(${summary.created.length} new, ${summary.updated.length} updated, ${summary.unchanged.length} unchanged` +
    (summary.pruned.length > 0 ? `, ${summary.pruned.length} pruned` : "") + `)`
  );
  for (const name of summary.created) log(`  + ${name}`);
  for (const name of summary.updated) log(`  ~ ${name}`);
  for (const name of summary.pruned) log(`  - ${name}`);
  if (summary.extras.length > 0) {
    log(
      `  ${summary.extras.length} file(s) in the Studio have no Keyframe master and were left alone ` +
      `(pass --prune to delete them): ${summary.extras.join(", ")}`
    );
  }
}

/**
 * Watch mode. Debounced, because an editor writing an SVG produces several events and a
 * burst of syncs would just print the same result repeatedly.
 */
export function watchStudio({
  studioDir,
  studioSource = "--studio",
  texturesDir = DEFAULT_TEXTURES_DIR,
  prune = false,
  debounceMs = 150,
  log = console.log
} = {}) {
  syncOnce({ studioDir, studioSource, texturesDir, prune, log });
  if (log) log(`\nWatching ${texturesDir} for changes. Ctrl+C to stop.`);

  let timer = null;
  const watcher = fs.watch(texturesDir, { recursive: true }, (_event, filename) => {
    if (filename && path.extname(filename.toString()).toLowerCase() !== ".svg") return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      try {
        syncOnce({ studioDir, studioSource, texturesDir, prune, log });
      } catch (err) {
        if (err instanceof SyncError) {
          if (log) log(`\n  sync failed: ${err.message}`);
        } else {
          throw err;
        }
      }
    }, debounceMs);
  });

  return watcher;
}

export function parseArgs(argv) {
  const opts = { studio: null, textures: null, watch: false, dryRun: false, prune: false, quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--studio" || arg === "--textures") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new SyncError(`${arg} requires a path.`);
      if (arg === "--studio") opts.studio = value;
      else opts.textures = value;
      i++;
    } else if (arg === "--watch") opts.watch = true;
    else if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--prune") opts.prune = true;
    else if (arg === "--quiet") opts.quiet = true;
    else if (arg === "--help" || arg === "-h") opts.help = true;
    else throw new SyncError(`Unknown argument: ${arg}`);
  }
  if (opts.watch && opts.dryRun) {
    throw new SyncError("--watch and --dry-run are mutually exclusive: a watcher that never writes does nothing.");
  }
  return opts;
}

const HELP = `
Keyframe -> TextureStudio master sync

  node tools/sync-studio.mjs [options]

  --studio <path>   TextureStudio checkout. Default: $${STUDIO_DIR_ENV}, else ../TextureStudio
  --textures <path> Keyframe masters. Default: textures/
  --watch           Sync, then keep syncing on every change to a master
  --dry-run         Report what would change and write nothing
  --prune           Delete Studio SVGs that have no Keyframe master (off by default)
  --quiet           Suppress the per-run report
  -h, --help        This text

Keyframe's textures/block/<name>.svg are flattened to TextureStudio's textures/<name>.svg,
which is the flat shape its discoverActivePack() reads.

Note: TextureStudio's server prefers a sibling ../Keyframe/textures over its own textures/,
and that path yields nothing because Keyframe's masters are one directory deeper. Until that
is fixed on the TextureStudio side, launch the Studio against the synced copy explicitly:

  npm start -- --textures textures
`;

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`\n  ${err.message}\n`);
    process.exit(1);
  }

  if (opts.help) {
    console.log(HELP);
    return;
  }

  const { dir, source } = resolveStudioDir({ cliPath: opts.studio });
  const texturesDir = opts.textures ? path.resolve(opts.textures) : DEFAULT_TEXTURES_DIR;
  const log = opts.quiet ? null : console.log;

  try {
    if (opts.watch) {
      watchStudio({ studioDir: dir, studioSource: source, texturesDir, prune: opts.prune, log });
    } else {
      syncOnce({ studioDir: dir, studioSource: source, texturesDir, dryRun: opts.dryRun, prune: opts.prune, log });
    }
  } catch (err) {
    if (err instanceof SyncError) {
      console.error(`\n  ${err.message}\n`);
      process.exit(1);
    }
    throw err;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  await main();
}

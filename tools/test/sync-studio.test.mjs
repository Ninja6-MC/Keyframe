#!/usr/bin/env node

/**
 * Test Suite for the Keyframe -> TextureStudio Master Sync
 *
 * Covers the contract that the Studio receives SVG *masters* (not compiled rasters),
 * flattened from textures/block/ into the flat textures/ shape its discovery expects, and
 * that a target which is absent or is not a TextureStudio checkout is a hard failure rather
 * than a silently-created stray directory.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SyncError,
  STUDIO_DIR_ENV,
  STUDIO_MARKERS,
  DEFAULT_TEXTURES_DIR,
  resolveStudioDir,
  assertStudioTarget,
  collectMasters,
  planSync,
  syncOnce,
  parseArgs,
  listDirectories,
  watchTree,
  watchStudio
} from "../sync-studio.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const TEST_TMP = path.join(ROOT_DIR, "cache", "test_sync_studio");

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

/** Captures the SyncError a call throws, or null. */
function catchSyncError(fn) {
  try {
    fn();
  } catch (err) {
    if (err instanceof SyncError) return err;
    throw err;
  }
  return null;
}

function resetTmp() {
  if (fs.existsSync(TEST_TMP)) fs.rmSync(TEST_TMP, { recursive: true, force: true });
  fs.mkdirSync(TEST_TMP, { recursive: true });
  return TEST_TMP;
}

function writeTree(root, files) {
  for (const [rel, text] of Object.entries(files)) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, text, "utf-8");
  }
  return root;
}

/** A throwaway directory that passes the "is this really TextureStudio?" check. */
function makeFakeStudio(name, extra = {}) {
  const dir = path.join(TEST_TMP, name);
  writeTree(dir, { [STUDIO_MARKERS[0]]: "// stub server\n", ...extra });
  return dir;
}

const SVG = (fill) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="${fill}"/></svg>\n`;

console.log("\n=======================================================");
console.log("  KEYFRAME -> TEXTURESTUDIO SYNC TEST SUITE");
console.log("=======================================================\n");

resetTmp();

// -----------------------------------------------------------------------------
// Suite 1: Target resolution
// -----------------------------------------------------------------------------
console.log("[Suite 1] Studio Target Resolution");
{
  const repoRoot = path.join(TEST_TMP, "repo");
  const explicit = resolveStudioDir({ cliPath: "some/where", env: { [STUDIO_DIR_ENV]: "env/where" }, repoRoot });
  assertEqual(explicit.dir, path.resolve("some/where"), "--studio wins over the environment");
  assertEqual(explicit.source, "--studio", "The resolution source names the flag");

  const fromEnv = resolveStudioDir({ env: { [STUDIO_DIR_ENV]: "env/where" }, repoRoot });
  assertEqual(fromEnv.dir, path.resolve("env/where"), `$${STUDIO_DIR_ENV} is used when no flag is given`);
  assertEqual(fromEnv.source, `$${STUDIO_DIR_ENV}`, "The resolution source names the environment variable");

  const blank = resolveStudioDir({ env: { [STUDIO_DIR_ENV]: "   " }, repoRoot });
  assertEqual(blank.dir, path.resolve(repoRoot, "..", "TextureStudio"), "A blank env var falls through to the default");

  const fallback = resolveStudioDir({ env: {}, repoRoot });
  assertEqual(
    fallback.dir,
    path.resolve(repoRoot, "..", "TextureStudio"),
    "The default is the sibling TextureStudio checkout"
  );

  // The shipped default has to point at the real sibling, not at some path inside the repo.
  const shipped = resolveStudioDir({ env: {} });
  assertEqual(
    shipped.dir,
    path.resolve(ROOT_DIR, "..", "TextureStudio"),
    "The shipped default resolves to ../TextureStudio relative to the repository root"
  );
}

// -----------------------------------------------------------------------------
// Suite 2: The target is validated before anything is written
// -----------------------------------------------------------------------------
console.log("\n[Suite 2] Target Validation");
{
  const absent = path.join(TEST_TMP, "no-such-studio");
  const err = catchSyncError(() => assertStudioTarget(absent, { source: "--studio" }));
  assert(Boolean(err), "An absent target throws SyncError rather than proceeding");
  assert(err.message.includes(absent), "The error names the path that was not found");
  assert(err.message.includes("--studio"), "The error names where the path came from");
  assert(err.message.includes(STUDIO_DIR_ENV), "The error names the environment variable that would fix it");
  assert(!fs.existsSync(absent), "An absent target is NOT created - no stray directory is left behind");

  const asFile = path.join(TEST_TMP, "studio-is-a-file");
  fs.writeFileSync(asFile, "not a directory", "utf-8");
  const fileErr = catchSyncError(() => assertStudioTarget(asFile));
  assert(Boolean(fileErr) && /not a directory/.test(fileErr.message), "A file target is rejected as not a directory");

  const stranger = path.join(TEST_TMP, "some-other-repo");
  fs.mkdirSync(stranger, { recursive: true });
  const strangerErr = catchSyncError(() => assertStudioTarget(stranger));
  assert(Boolean(strangerErr), "A directory that is not TextureStudio is rejected");
  assert(
    strangerErr.message.includes("tools/server.mjs"),
    "The rejection names the marker file it looked for, with forward slashes"
  );
  assert(
    !fs.existsSync(path.join(stranger, "textures")),
    "A rejected target gets no textures/ directory created inside it"
  );

  const studio = makeFakeStudio("studio-ok");
  assertEqual(
    assertStudioTarget(studio),
    path.join(studio, "textures"),
    "A valid checkout resolves to its flat textures/ directory"
  );
  assert(
    !fs.existsSync(path.join(studio, "textures")),
    "Validation alone does not create textures/ - only a real sync does"
  );

  // The real sibling checkout must satisfy the same check the tests use a stub for,
  // otherwise the marker list is right in the fixture and wrong in the world.
  const realStudio = resolveStudioDir({ env: {} }).dir;
  if (fs.existsSync(realStudio)) {
    const realErr = catchSyncError(() => assertStudioTarget(realStudio));
    assertEqual(realErr, null, "The real sibling TextureStudio checkout passes the marker check");
  } else {
    console.log("  · SKIP: no sibling TextureStudio checkout on this machine");
  }
}

// -----------------------------------------------------------------------------
// Suite 3: Collecting masters and flattening them
// -----------------------------------------------------------------------------
console.log("\n[Suite 3] Master Collection & Flattening");
{
  const tex = writeTree(path.join(TEST_TMP, "textures-a"), {
    "block/dirt.svg": SVG("#c77d38"),
    "block/nested/deep.svg": SVG("#111111"),
    "block/dirt.png": "not an svg",
    "block/dirt.svg.mcmeta": "{}",
    "loose.svg": SVG("#222222")
  });

  const masters = collectMasters(tex);
  const names = masters.map((m) => m.flatName);
  assertEqual(names.join(","), "deep.svg,dirt.svg,loose.svg", "Masters are collected recursively and sorted by flat name");
  assertEqual(
    masters.find((m) => m.flatName === "dirt.svg").relPath,
    "block/dirt.svg",
    "The source-relative path is recorded with POSIX separators"
  );

  // The corrected premise, encoded: TextureStudio consumes SVG masters, so the sync must
  // carry SVGs and nothing else. A PNG in the tree is not a texture the Studio can use.
  assert(!names.includes("dirt.png"), "A compiled raster alongside a master is NOT collected");
  assert(!names.some((n) => n.endsWith(".mcmeta")), "Animation metadata is not collected");

  const collide = writeTree(path.join(TEST_TMP, "textures-collide"), {
    "block/dirt.svg": SVG("#aaaaaa"),
    "item/dirt.svg": SVG("#bbbbbb")
  });
  const collideErr = catchSyncError(() => collectMasters(collide));
  assert(Boolean(collideErr), "Two namespaces sharing a basename abort the sync");
  assert(
    collideErr.message.includes("block/dirt.svg") && collideErr.message.includes("item/dirt.svg"),
    "The collision error names both colliding masters"
  );

  const missingErr = catchSyncError(() => collectMasters(path.join(TEST_TMP, "no-textures-here")));
  assert(Boolean(missingErr), "An absent masters directory is reported rather than treated as empty");
}

// -----------------------------------------------------------------------------
// Suite 4: One-shot sync
// -----------------------------------------------------------------------------
console.log("\n[Suite 4] One-Shot Sync");
{
  const tex = writeTree(path.join(TEST_TMP, "textures-b"), {
    "block/dirt.svg": SVG("#c77d38"),
    "block/stone.svg": SVG("#7e8187")
  });
  const studio = makeFakeStudio("studio-sync");
  const dest = path.join(studio, "textures");

  const dry = syncOnce({ studioDir: studio, texturesDir: tex, dryRun: true, log: null });
  assertEqual(dry.created.length, 2, "A dry run reports both masters as new");
  assert(!fs.existsSync(dest), "A dry run writes nothing at all, not even the destination directory");

  const first = syncOnce({ studioDir: studio, texturesDir: tex, log: null });
  assertEqual(first.created.length, 2, "The first real sync creates both masters");
  assertEqual(first.updated.length, 0, "The first sync updates nothing");
  assertEqual(
    fs.readdirSync(dest).sort().join(","),
    "dirt.svg,stone.svg",
    "Masters land flat in the Studio, with block/ flattened away"
  );
  assert(
    fs.readFileSync(path.join(dest, "dirt.svg")).equals(fs.readFileSync(path.join(tex, "block", "dirt.svg"))),
    "The synced file is byte-for-byte the Keyframe master"
  );

  const second = syncOnce({ studioDir: studio, texturesDir: tex, log: null });
  assertEqual(second.unchanged.length, 2, "A repeat sync is a no-op: identical content is left alone");
  assertEqual(second.created.length + second.updated.length, 0, "A repeat sync neither creates nor updates");

  // Drift in the Studio copy is exactly the failure this tool exists to end: the Studio's
  // dirt.svg carried a pre-#37 palette while Keyframe's carried the shipped one.
  fs.writeFileSync(path.join(dest, "dirt.svg"), SVG("#d98827"), "utf-8");
  const third = syncOnce({ studioDir: studio, texturesDir: tex, log: null });
  assertEqual(third.updated.join(","), "dirt.svg", "A drifted Studio copy is detected and overwritten");
  assert(
    fs.readFileSync(path.join(dest, "dirt.svg"), "utf-8").includes("#c77d38"),
    "After the sync the Studio carries Keyframe's palette, not its own stale one"
  );

  // A Studio-only file is somebody's local work until they say otherwise.
  fs.writeFileSync(path.join(dest, "experiment.svg"), SVG("#00ff00"), "utf-8");
  const kept = syncOnce({ studioDir: studio, texturesDir: tex, log: null });
  assertEqual(kept.extras.join(","), "experiment.svg", "A Studio file with no Keyframe master is reported as extra");
  assert(fs.existsSync(path.join(dest, "experiment.svg")), "An extra file is NOT deleted by default");

  const pruned = syncOnce({ studioDir: studio, texturesDir: tex, prune: true, log: null });
  assertEqual(pruned.pruned.join(","), "experiment.svg", "--prune removes a Studio file with no Keyframe master");
  assert(!fs.existsSync(path.join(dest, "experiment.svg")), "The pruned file is gone from disk");

  // planSync is what --dry-run and the report both read, so it has to agree with reality.
  const plan = planSync(collectMasters(tex), dest);
  assert(plan.actions.every((a) => a.status === "unchanged"), "planSync reports a settled tree as fully unchanged");
  assertEqual(plan.extras.length, 0, "planSync reports no extras once the tree is settled");
}

// -----------------------------------------------------------------------------
// Suite 5: Argument parsing
// -----------------------------------------------------------------------------
console.log("\n[Suite 5] Argument Parsing");
{
  const opts = parseArgs(["--studio", "C:/studio", "--textures", "tex", "--watch", "--prune", "--quiet"]);
  assertEqual(opts.studio, "C:/studio", "--studio takes the following value");
  assertEqual(opts.textures, "tex", "--textures takes the following value");
  assert(opts.watch && opts.prune && opts.quiet, "Boolean flags are set");
  assertEqual(parseArgs([]).watch, false, "Watch mode is off by default: a bare run is one-shot");

  assert(Boolean(catchSyncError(() => parseArgs(["--studio"]))), "A flag missing its value is rejected");
  assert(
    Boolean(catchSyncError(() => parseArgs(["--studio", "--watch"]))),
    "A flag followed by another flag is rejected rather than swallowing it as a path"
  );
  assert(Boolean(catchSyncError(() => parseArgs(["--nope"]))), "An unknown argument is rejected");
  assert(
    Boolean(catchSyncError(() => parseArgs(["--watch", "--dry-run"]))),
    "--watch with --dry-run is rejected as a contradiction"
  );
}

// -----------------------------------------------------------------------------
// Suite 5b: Watch mode
// -----------------------------------------------------------------------------
console.log("\n[Suite 5b] Watch Mode");
{
  const tex = writeTree(path.join(TEST_TMP, "textures-watch"), {
    "block/dirt.svg": SVG("#c77d38"),
    "block/nested/deep.svg": SVG("#111111")
  });

  const dirs = listDirectories(tex).map((d) => (path.relative(tex, d) || ".").split(path.sep).join("/")).sort();
  assertEqual(dirs.join(","), ".,block,block/nested", "listDirectories walks the whole masters tree");

  // A recording stand-in for fs.watch. The fallback branch only runs on Linux before Node
  // 20, so on Windows, macOS and CI (ubuntu + Node 20) it would otherwise be covered by
  // nothing at all - the platform decides which branch runs, and every platform this suite
  // runs on picks the other one.
  function makeFakeWatch({ recursiveSupported }) {
    const calls = { recursive: [], perDir: [] };
    const handles = [];
    const fire = (dir, filename) => {
      for (const h of handles) {
        if (!h.closed && h.dir === dir) h.listener("change", filename);
      }
    };
    const watchFn = (dir, a, b) => {
      const listener = typeof a === "function" ? a : b;
      const recursive = typeof a === "object" && a !== null && a.recursive === true;
      if (recursive) {
        calls.recursive.push(dir);
        if (!recursiveSupported) {
          const err = new Error("recursive watch unavailable");
          err.code = "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM";
          throw err;
        }
      } else {
        calls.perDir.push(dir);
      }
      const handle = { dir, listener, closed: false, close() { this.closed = true; } };
      handles.push(handle);
      return handle;
    };
    return { watchFn, calls, fire, openCount: () => handles.filter((h) => !h.closed).length };
  }

  // --- Primary path: one recursive watcher, no per-directory ones, no double-fire.
  {
    const fake = makeFakeWatch({ recursiveSupported: true });
    let fired = 0;
    const watcher = watchTree(tex, () => { fired++; }, { watchFn: fake.watchFn });
    assertEqual(fake.calls.recursive.length, 1, "The primary path asks fs.watch for one recursive watcher");
    assertEqual(fake.calls.perDir.length, 0, "The primary path opens no per-directory watchers, so nothing double-fires");

    fake.fire(tex, "block/dirt.svg");
    assertEqual(fired, 1, "A master change on the primary path reaches the callback exactly once");
    fake.fire(tex, "notes.txt");
    assertEqual(fired, 1, "A non-SVG change is filtered out");

    watcher.close();
    assertEqual(fake.openCount(), 0, "Closing the primary watcher closes it");
  }

  // --- Fallback path: the branch that exists for Node 18 on Linux.
  {
    const fake = makeFakeWatch({ recursiveSupported: false });
    let fired = 0;
    const watcher = watchTree(tex, () => { fired++; }, { watchFn: fake.watchFn });
    assertEqual(
      fake.calls.perDir.length,
      3,
      "The fallback opens one watcher per directory when a recursive watch is unavailable"
    );

    fake.fire(path.join(tex, "block", "nested"), "deep.svg");
    assertEqual(fired, 1, "A change in a nested directory reaches the callback on the fallback path");

    // The gap this fallback would otherwise have: a directory created after startup is
    // watched by nothing, so a whole namespace goes blind for the rest of the session.
    fs.mkdirSync(path.join(tex, "block", "late"), { recursive: true });
    fake.fire(path.join(tex, "block"), "late");
    assert(
      fake.calls.perDir.includes(path.join(tex, "block", "late")),
      "A directory created after startup is picked up and watched"
    );
    const before = fired;
    fake.fire(path.join(tex, "block", "late"), "arrived.svg");
    assertEqual(fired, before + 1, "A master in that new directory reaches the callback");

    watcher.close();
    assertEqual(fake.openCount(), 0, "close() closes every per-directory watcher, leaking none");
  }

  // --- A throw part-way through mounting must not orphan the watchers already open.
  {
    const fake = makeFakeWatch({ recursiveSupported: false });
    let opened = 0;
    const throwingWatch = (dir, a, b) => {
      const recursive = typeof a === "object" && a !== null && a.recursive === true;
      if (!recursive && ++opened === 2) {
        const err = new Error("ENOSPC: inotify watch limit reached");
        err.code = "ENOSPC";
        throw err;
      }
      return fake.watchFn(dir, a, b);
    };
    let threw = false;
    try {
      watchTree(tex, () => {}, { watchFn: throwingWatch });
    } catch (err) {
      threw = true;
      assertEqual(err.code, "ENOSPC", "The mount failure is propagated as itself, not swallowed");
    }
    assert(threw, "A watcher that cannot be opened fails loudly");
    assertEqual(fake.openCount(), 0, "Watchers opened before the failure are closed rather than orphaned");
  }

  // --- watchStudio: syncs up front, and a real change propagates through the debounce.
  {
    const studio = makeFakeStudio("studio-watch");
    const fake = makeFakeWatch({ recursiveSupported: true });
    const live = watchStudio({
      studioDir: studio,
      texturesDir: tex,
      log: null,
      debounceMs: 0,
      watchOptions: { watchFn: fake.watchFn }
    });
    assert(typeof live.close === "function", "watchStudio returns a closeable watcher");
    assertEqual(
      fs.readdirSync(path.join(studio, "textures")).sort().join(","),
      "deep.svg,dirt.svg",
      "watchStudio syncs once up front, before it waits for anything"
    );

    // This is the criterion the task turns on: a saved master reaches the Studio.
    fs.writeFileSync(path.join(tex, "block", "dirt.svg"), SVG("#ff0000"), "utf-8");
    fake.fire(tex, "block/dirt.svg");
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert(
      fs.readFileSync(path.join(studio, "textures", "dirt.svg"), "utf-8").includes("#ff0000"),
      "A saved master propagates to the Studio within one watch cycle"
    );

    // Closing with a debounce still armed must not let one more sync land afterwards.
    fs.writeFileSync(path.join(tex, "block", "dirt.svg"), SVG("#0000ff"), "utf-8");
    fake.fire(tex, "block/dirt.svg");
    live.close();
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert(
      fs.readFileSync(path.join(studio, "textures", "dirt.svg"), "utf-8").includes("#ff0000"),
      "close() disarms a pending debounce, so no sync lands after the watcher is closed"
    );
    assertEqual(fake.openCount(), 0, "watchStudio's close() closes the underlying watcher");
  }
}

// -----------------------------------------------------------------------------
// Suite 6: The shipped masters really do sync
// -----------------------------------------------------------------------------
console.log("\n[Suite 6] Shipped Masters Sync End To End");
{
  const studio = makeFakeStudio("studio-real");
  const result = syncOnce({ studioDir: studio, texturesDir: DEFAULT_TEXTURES_DIR, log: null });
  const shipped = collectMasters(DEFAULT_TEXTURES_DIR);

  assert(shipped.length > 0, `The repository ships master SVGs (found ${shipped.length})`);
  assertEqual(result.total, shipped.length, "Every shipped master is accounted for in the sync");
  assertEqual(
    fs.readdirSync(path.join(studio, "textures")).length,
    shipped.length,
    "Every shipped master landed in the Studio's flat textures/"
  );
  for (const master of shipped) {
    const dest = path.join(studio, "textures", master.flatName);
    if (!fs.readFileSync(dest).equals(fs.readFileSync(master.fullPath))) {
      assert(false, `${master.flatName} matches its Keyframe master byte-for-byte`);
    }
  }
  assert(true, "Every synced file matches its Keyframe master byte-for-byte");
  assert(
    fs.existsSync(path.join(studio, "textures", "dirt.svg")),
    "dirt.svg - the master that had drifted - is among the synced files"
  );
}

// -----------------------------------------------------------------------------
// Suite 7: The suite is actually wired into the things that run it
// -----------------------------------------------------------------------------
console.log("\n[Suite 7] Wiring");
{
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf-8"));
  assert(
    typeof pkg.scripts["sync:studio"] === "string" && pkg.scripts["sync:studio"].includes("tools/sync-studio.mjs"),
    "package.json exposes sync:studio"
  );
  assert(
    typeof pkg.scripts["sync:studio:watch"] === "string" && pkg.scripts["sync:studio:watch"].includes("--watch"),
    "package.json exposes sync:studio:watch"
  );
  assertEqual(
    pkg.scripts["test:sync-studio"],
    "node tools/test/sync-studio.test.mjs",
    "package.json exposes test:sync-studio"
  );
  assert(pkg.scripts.test.includes("tools/test/sync-studio.test.mjs"), "npm test runs this suite");

  // ci.yml names each suite individually rather than calling `npm test`, so a suite that is
  // not named there runs nowhere on a pull request - which would look exactly like passing.
  const ci = fs.readFileSync(path.join(ROOT_DIR, ".github", "workflows", "ci.yml"), "utf-8");
  assert(ci.includes("npm run test:sync-studio"), ".github/workflows/ci.yml runs test:sync-studio as its own step");
}

if (fs.existsSync(TEST_TMP)) fs.rmSync(TEST_TMP, { recursive: true, force: true });

console.log("\n=======================================================");
console.log(`  RESULTS: ${passedTests}/${totalTests} tests passed`);
console.log("=======================================================\n");

if (passedTests !== totalTests) process.exit(1);

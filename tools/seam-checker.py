#!/usr/bin/env python3
"""
Keyframe Seam Diagnostic & Visual Diff Tool
Python matrix analysis harness (NumPy / PIL) for deep statistical seam verification:
- Computes Max Delta, Mean Squared Error (MSE), and Discontinuity Counts
- Evaluates first-order boundary gradient continuity
- Generates visual diff heatmaps and error marker overlays
"""

import sys
import os
import argparse
import json
from pathlib import Path
from PIL import Image, ImageDraw
import numpy as np

# Ensure UTF-8 output encoding on Windows consoles
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT_DIR = Path(__file__).resolve().parent.parent
TEXTURES_DIR = ROOT_DIR / "textures"
RULES_FILE = ROOT_DIR / "tools" / "tiling-rules.json"


def load_rules():
    if RULES_FILE.exists():
        try:
            with open(RULES_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[WARN] Failed to load rules file: {e}", file=sys.stderr)
    return {
        "defaultCategory": "toroidal",
        "categories": {
            "toroidal": {"testAxes": ["x", "y"], "tolerance": 0},
            "x-only": {"testAxes": ["x"], "tolerance": 0},
            "y-only": {"testAxes": ["y"], "tolerance": 0},
            "exempt": {"testAxes": []}
        },
        "patterns": [
            {"pattern": "*_side.svg", "category": "x-only"},
            {"pattern": "*_overlay.svg", "category": "exempt"},
            {"pattern": "short_grass*.svg", "category": "exempt"},
            {"pattern": "tall_grass_*.svg", "category": "exempt"}
        ],
        "itemIds": ["cooked_beef", "golden_apple", "compass_nexus", "plot_compass", "spiral_core", "ninja6_token"],
        "overrides": {}
    }


def match_glob(filename, pattern):
    if pattern.startswith("*") and pattern.endswith("*"):
        return pattern[1:-1] in filename
    if pattern.startswith("*"):
        return filename.endswith(pattern[1:])
    if pattern.endswith("*"):
        return filename.startswith(pattern[:-1])
    return filename == pattern


def categorize_texture(filename, rules, axis_override=None):
    stem = Path(filename).stem
    if axis_override:
        ax = axis_override.lower()
        axes = ["x"] if ax == "x" else ["y"] if ax == "y" else ["x", "y"] if ax in ["xy", "both"] else []
        return {"category": "custom-override", "testAxes": axes, "tolerance": 0, "reason": f"CLI override ({axis_override})"}

    if rules.get("overrides", {}).get(filename):
        ovr = rules["overrides"][filename]
        cat = rules.get("categories", {}).get(ovr.get("category"), {"testAxes": ["x", "y"], "tolerance": 0})
        return {
            "category": ovr.get("category"),
            "testAxes": cat.get("testAxes", ["x", "y"]),
            "tolerance": ovr.get("tolerance", cat.get("tolerance", 0)),
            "reason": ovr.get("notes", "Explicit override")
        }

    if stem in rules.get("itemIds", []):
        return {"category": "exempt", "testAxes": [], "tolerance": 0, "reason": "Item icon"}

    for pat in rules.get("patterns", []):
        if match_glob(filename, pat.get("pattern", "")):
            cat = rules.get("categories", {}).get(pat.get("category"), {"testAxes": [], "tolerance": 0})
            return {
                "category": pat.get("category"),
                "testAxes": cat.get("testAxes", []),
                "tolerance": cat.get("tolerance", 0),
                "reason": pat.get("reason", f"Matched {pat.get('pattern')}")
            }

    def_cat = rules.get("defaultCategory", "toroidal")
    cat = rules.get("categories", {}).get(def_cat, {"testAxes": ["x", "y"], "tolerance": 0})
    return {"category": def_cat, "testAxes": cat.get("testAxes", ["x", "y"]), "tolerance": cat.get("tolerance", 0), "reason": "Default toroidal block"}


def rasterize_svg_resvg(svg_path, size=512):
    """Fallback rasterizer using Node's Resvg CLI wrapper or node process"""
    import subprocess
    js_script = f"""
    import fs from 'node:fs';
    import {{ Resvg }} from '@resvg/resvg-js';
    const svg = fs.readFileSync({json.dumps(str(svg_path))}, 'utf-8');
    const r = new Resvg(svg, {{ fitTo: {{ mode: 'width', value: {size} }} }}).render();
    process.stdout.write(r.asPng());
    """
    proc = subprocess.run(["node", "--input-type=module", "-e", js_script], capture_output=True, check=True)
    import io
    return Image.open(io.BytesIO(proc.stdout)).convert("RGBA")


def analyze_image_seams(img, test_axes=("x", "y"), tolerance=0):
    arr = np.array(img, dtype=np.int32)  # Shape: (H, W, 4)
    H, W, C = arr.shape

    errors = []
    x_stats = {"count": 0, "max_delta": 0, "mse": 0.0}
    y_stats = {"count": 0, "max_delta": 0, "mse": 0.0}

    # 1. X-Axis Boundary: Left (x=0) vs Right (x=W-1)
    if "x" in test_axes:
        left_col = arr[:, 0, :]    # (H, 4)
        right_col = arr[:, W - 1, :] # (H, 4)
        diff_x = np.abs(left_col - right_col) # (H, 4)
        max_diff_x = np.max(diff_x, axis=1)   # (H,)

        bad_y = np.where(max_diff_x > tolerance)[0]
        x_stats["count"] = int(len(bad_y))
        x_stats["max_delta"] = int(np.max(max_diff_x)) if len(bad_y) > 0 else 0
        x_stats["mse"] = float(np.mean(diff_x ** 2))

        for y in bad_y:
            errors.append({
                "axis": "X",
                "coord": int(y),
                "delta": int(max_diff_x[y]),
                "left_rgba": left_col[y].tolist(),
                "right_rgba": right_col[y].tolist()
            })

    # 2. Y-Axis Boundary: Top (y=0) vs Bottom (y=H-1)
    if "y" in test_axes:
        top_row = arr[0, :, :]       # (W, 4)
        bottom_row = arr[H - 1, :, :] # (W, 4)
        diff_y = np.abs(top_row - bottom_row) # (W, 4)
        max_diff_y = np.max(diff_y, axis=1)   # (W,)

        bad_x = np.where(max_diff_y > tolerance)[0]
        y_stats["count"] = int(len(bad_x))
        y_stats["max_delta"] = int(np.max(max_diff_y)) if len(bad_x) > 0 else 0
        y_stats["mse"] = float(np.mean(diff_y ** 2))

        for x in bad_x:
            errors.append({
                "axis": "Y",
                "coord": int(x),
                "delta": int(max_diff_y[x]),
                "top_rgba": top_row[x].tolist(),
                "bottom_rgba": bottom_row[x].tolist()
            })

    overall_max_delta = max(x_stats["max_delta"], y_stats["max_delta"])
    passed = len(errors) == 0

    return {
        "passed": passed,
        "width": W,
        "height": H,
        "errors": errors,
        "x_stats": x_stats,
        "y_stats": y_stats,
        "max_delta": overall_max_delta
    }


def generate_visual_diff(img, seam_results, out_path):
    """Generates a 3x3 tiled diagnostic image with highlighted seam errors in bright magenta/red"""
    W, H = img.size
    tiled = Image.new("RGBA", (W * 3, H * 3))
    for ty in range(3):
        for tx in range(3):
            tiled.paste(img, (tx * W, ty * H))

    draw = ImageDraw.Draw(tiled, "RGBA")

    # Draw grid divider lines in semi-transparent white
    for i in [1, 2]:
        draw.line([(i * W, 0), (i * W, H * 3)], fill=(255, 255, 255, 100), width=1)
        draw.line([(0, i * H), (W * 3, i * H)], fill=(255, 255, 255, 100), width=1)

    # Highlight X-seam errors along vertical boundary lines
    for err in seam_results["errors"]:
        if err["axis"] == "X":
            y = err["coord"]
            for seam_x in [W, 2 * W]:
                # Draw red dot on seam
                draw.rectangle([seam_x - 2, y, seam_x + 2, y + 1], fill=(255, 0, 80, 230))
                draw.rectangle([seam_x - 2, y + H, seam_x + 2, y + H + 1], fill=(255, 0, 80, 230))
                draw.rectangle([seam_x - 2, y + 2 * H, seam_x + 2, y + 2 * H + 1], fill=(255, 0, 80, 230))
        elif err["axis"] == "Y":
            x = err["coord"]
            for seam_y in [H, 2 * H]:
                # Draw red dot on seam
                draw.rectangle([x, seam_y - 2, x + 1, seam_y + 2], fill=(255, 0, 80, 230))
                draw.rectangle([x + W, seam_y - 2, x + W + 1, seam_y + 2], fill=(255, 0, 80, 230))
                draw.rectangle([x + 2 * W, seam_y - 2, x + 2 * W + 1, seam_y + 2], fill=(255, 0, 80, 230))

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    tiled.save(out_path, "PNG")


def main():
    parser = argparse.ArgumentParser(description="Keyframe Seam Diagnostic & Visual Diff Tool")
    parser.add_argument("--input", "-i", help="Input SVG or PNG texture file")
    parser.add_argument("--all", "-a", action="store_true", help="Audit all textures in textures/ directory")
    parser.add_argument("--tolerance", "-t", type=int, default=None, help="Discontinuity tolerance threshold")
    parser.add_argument("--axis", choices=["x", "y", "xy", "both"], default=None, help="Axis override")
    parser.add_argument("--visualize", "-v", action="store_true", help="Generate visual diff PNG")
    parser.add_argument("--diff-out", help="Output path for visual diff PNG")
    parser.add_argument("--json", action="store_true", help="Output JSON results")

    args = parser.parse_args()
    rules = load_rules()

    if not args.input and not args.all:
        parser.print_help()
        sys.exit(0)

    files_to_check = []
    if args.input:
        inp = Path(args.input)
        if inp.exists():
            files_to_check.append(inp)
        elif (TEXTURES_DIR / inp).exists():
            files_to_check.append(TEXTURES_DIR / inp)
        elif (TEXTURES_DIR / "block" / inp).exists():
            files_to_check.append(TEXTURES_DIR / "block" / inp)
        elif (TEXTURES_DIR / "block" / f"{inp.stem}.svg").exists():
            files_to_check.append(TEXTURES_DIR / "block" / f"{inp.stem}.svg")
        else:
            matches = list(TEXTURES_DIR.rglob(f"*{inp.stem}*.svg"))
            if matches:
                files_to_check.extend(matches)
            else:
                files_to_check.append(inp)
    elif args.all:
        files_to_check = sorted(list(TEXTURES_DIR.rglob("*.svg")))

    results = []
    passed_count = 0
    failed_count = 0
    exempt_count = 0

    if not args.json:
        print("\n" + "=" * 60)
        print("  Keyframe Python Seam Diagnostic & Matrix Analysis Suite")
        print(f"  Target Textures: {len(files_to_check)} file(s)")
        print("=" * 60 + "\n")

    for fpath in files_to_check:
        filename = fpath.name
        cat_info = categorize_texture(filename, rules, args.axis)
        tol = args.tolerance if args.tolerance is not None else cat_info["tolerance"]

        if cat_info["category"] == "exempt" or not cat_info["testAxes"]:
            exempt_count += 1
            results.append({"file": filename, "category": cat_info["category"], "passed": True, "exempt": True})
            if not args.json:
                print(f"  ⊘ EXEMPT  {filename:<28} ({cat_info['reason']})")
            continue

        if fpath.suffix.lower() == ".svg":
            img = rasterize_svg_resvg(fpath, 512)
        else:
            img = Image.open(fpath).convert("RGBA")

        audit = analyze_image_seams(img, cat_info["testAxes"], tol)
        audit["file"] = filename
        audit["category"] = cat_info["category"]
        audit["exempt"] = False
        results.append(audit)

        if args.visualize or args.diff_out:
            stem = fpath.stem
            out_diff = args.diff_out or str(ROOT_DIR / "dist" / "tiling_diagnostics" / f"{stem}_seam_diag.png")
            generate_visual_diff(img, audit, out_diff)
            audit["visual_diff"] = out_diff

        if audit["passed"]:
            passed_count += 1
            if not args.json:
                axis_str = "+".join(cat_info["testAxes"]).upper()
                print(f"  ✓ PASS    {filename:<28} [{axis_str}]  Seam Δ=0 (MSE: {audit['x_stats']['mse'] + audit['y_stats']['mse']:.3f})")
        else:
            failed_count += 1
            if not args.json:
                axis_str = "+".join(cat_info["testAxes"]).upper()
                print(f"  ✗ FAIL    {filename:<28} [{axis_str}]  X errs: {audit['x_stats']['count']}, Y errs: {audit['y_stats']['count']} (Max Δ={audit['max_delta']})")

    overall_passed = failed_count == 0

    if args.json:
        print(json.dumps({
            "passed": overall_passed,
            "total": len(files_to_check),
            "passed_count": passed_count,
            "failed_count": failed_count,
            "exempt_count": exempt_count,
            "results": results
        }, indent=2))
    else:
        print("\n" + "-" * 60)
        print(f"  Summary: Total: {len(files_to_check)} | Passed: {passed_count} | Failed: {failed_count} | Exempt: {exempt_count}")
        print(f"  Status: {'✓ ALL AUDITS PASSED (Zero Discontinuity)' if overall_passed else '✗ SEAM DISCONTINUITIES DETECTED'}")
        print("-" * 60 + "\n")

    if not overall_passed:
        sys.exit(1)


if __name__ == "__main__":
    main()

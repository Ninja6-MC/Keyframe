# Contributing to Keyframe

Thank you for your interest in contributing to **Keyframe**! We welcome contributions ranging from new block/item vector textures to compiler improvements and documentation fixes.

To maintain the high visual fidelity, seamless in-game tiling, and clean git history of Keyframe, please review and adhere to the guidelines below before opening a Pull Request.

---

## 🛠️ Development Setup

Keyframe utilizes a headless Node.js compiler powered by `@resvg/resvg-js` to rasterize vector SVG masters into pixel-perfect textures across 5 resolution tiers ($512\times512$ down to $32\times32$).

### Prerequisites
* **Node.js**: v18.0.0 or higher
* **npm**: v9.0.0 or higher
* **Git**

### Installation & Build Commands
```bash
# 1. Clone the repository
git clone https://github.com/Ninja6-MC/Keyframe.git
cd Keyframe

# 2. Install compiler dependencies
npm install

# 3. Build 512x Ultra HD pack
npm run build

# 4. Batch build all 5 resolution tiers
npm run build:all
```

Compiled `.zip` resource packs are saved to `dist/` and automatically deployed to your local `.minecraft/resourcepacks/` directory if detected.

---

## 🎨 Vector Texture Authoring Guidelines

All textures in Keyframe are authored as pure vector SVG files in `textures/`.

### 1. Canvas & Grid Alignment
* **Canvas Size**: Every texture must use a $512\times512$ viewport:
  ```xml
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  ```
* **Grid Intervals ($16\times16$ Texel Grid)**:
  * In Minecraft's default texel grid ($16\times16$), each pixel corresponds to **$32\text{px}$** on the $512\times512$ SVG canvas ($512 / 16 = 32$).
  * Align primary shapes, strata, and blocks to $32\text{px}$ multiples ($0, 32, 64, 96, 128, 160, \dots$).
  * Avoid unintended fractional or sub-pixel coordinates (e.g., $Y=144$ or $Y=208$ which are $4.5\times$ or $6.5\times 32\text{px}$) unless intentionally crafting sub-pixel bevels.

### 2. Toroidal Seamless Tiling ($X$ and $Y$ Wrapping)
Minecraft blocks repeat horizontally and vertically across infinite terrain. **Any element crossing a canvas boundary must wrap seamlessly to the opposite side:**

* **Horizontal ($X$-Axis Wrapping)**:
  * If a shape starts at $X=480$ with a width of $64\text{px}$ (exiting the right edge at $X=512$), the remaining $32\text{px}$ must be drawn at $X=0$ at the exact same $Y$ position and height.
  * Avoid cutting off rounded pills or boulders flat against canvas borders.
* **Vertical ($Y$-Axis Wrapping)**:
  * If a stone, boulder, or soil clod touches $Y=0$ (top edge), its corresponding bottom portion must touch $Y=512$ (bottom edge) at the identical $X$ coordinates.
* **Tiling Verification**:
  * Before submitting, test your texture in a $3\times3$ grid or compile and check how it tiles in-game when stacked and aligned horizontally and vertically.

### 3. Ore & Material Consistency
* **Shared Base Patterns**: Ore textures (e.g., `diamond_ore.svg`, `iron_ore.svg`, `gold_ore.svg`, `coal_ore.svg`) **must inherit the exact same stone background** (striation layout, positions, corner radius `rx`) as [`textures/stone.svg`](textures/stone.svg).
* **Ore Gems / Crystals**: Embed crystal shapes cleanly over the base stone layer without modifying or displacing the shared stone background pattern.

### 4. Art Direction & Shading
* **Cinematic Aesthetic**: Saturated, warm, joyful palette matching Minecraft promotional cinematics and update trailers.
* **Layered Depth**: Use clean 2-to-4 tone palettes:
  * Light highlight bevel / sunlit reflection (top-left edges).
  * Base body color.
  * Crevice / drop shadow (bottom-right edges).
* **Zero Visual Noise**: Avoid grainy pixel noise, dithering patterns, or random scattered dots.
* **Clean Markup**:
  * Use standard semantic SVG elements (`<rect>`, `<path>`, `<g>`, `<defs>`, `<use>`).
  * Remove temporary vector editor metadata, inline editor styles, and leftover AI generation comments (e.g., `USER CONFIRMED PERFECT`).

---

## 🗂️ Blockstates & Model Customization

Custom blockstates live in `pack_template/assets/minecraft/blockstates/` and un-rotate textures where necessary (e.g., stone, dirt, sand) to keep vector textures aligned cleanly across adjacent blocks.

* Follow compact JSON formatting matching existing files:
  ```json
  {
    "variants": {
      "": [
        { "model": "minecraft:block/stone" }
      ]
    }
  }
  ```
* Adhere to [`.editorconfig`](.editorconfig) (2 spaces indentation, LF line endings, trailing newline).

---

## 📜 Commit Conventions & Git Hygiene

We enforce clean git history, [Conventional Commits](https://www.conventionalcommits.org/), and the [Developer Certificate of Origin (DCO)](https://developercertificate.org/).

### Commit Message Format
Commit messages must follow the Conventional Commits specification:

```
<type>(<optional scope>): <description>

[optional body]

Signed-off-by: Your Name <your.email@example.com>
```

#### Allowed Types:
* `feat`: Adding new vector textures, blockstates, or compiler capabilities (e.g., `feat(textures): author stone and cobblestone vector masters`).
* `fix`: Fixing tiling seams, incorrect palettes, or compiler bugs (e.g., `fix(stone): resolve horizontal seam wrap on row 3`).
* `chore`: Maintenance, dependencies, or config updates (e.g., `chore: update build dependencies`).
* `docs`: Documentation updates (e.g., `docs: add contributing guide and PR template`).
* `refactor`: Refactoring SVG groups or compiler scripts without changing output.

### Developer Certificate of Origin (DCO) Sign-off
Every commit must be signed off with `Signed-off-by: Name <email>` to certify that you wrote the code or have the right to submit it.

* **Using the Git CLI**: Use the `-s` or `--signoff` flag:
  ```bash
  git commit -s -m "feat(textures): author cobblestone vector master"
  ```
* **Configuring Git to auto-sign (Optional)**:
  ```bash
  git config --global format.signOff true
  ```

### Rebase Workflow (No Merge Commits)
* Always create a dedicated feature branch from `main`:
  ```bash
  git checkout -b feat/stone-and-cobblestone
  ```
* Keep your branch up to date with `main` using **rebase**, not merge:
  ```bash
  git fetch origin
  git rebase origin/main
  ```
* Avoid submitting PRs containing `Merge branch 'main' into ...` commits.

### PR Review & Iteration Workflow
When feedback or review comments are received on an open pull request:
* **No Force-Pushing During Active Review**: Keep existing commits intact and never amend or force-push during an ongoing review cycle so reviewers can inspect the exact delta using GitHub's review diff tools.
* **Separate Fix Commits**: Address review comments in new, standalone commits with DCO sign-offs (`git commit -s`):
  ```bash
  git commit -s -m "fix(compiler): clamp concurrency and add whitelist extension guard"
  git push origin feat/your-branch-name
  ```
* **Link Commits to Comments**: When responding to review comments or resolving threads, cite the specific commit SHA(s) that introduced each fix (e.g., `Resolved in 51de542: ...`).
* **Squashing at Merge**: Linear history is maintained by squashing or rebasing when merging the pull request into `main`.

---

## 📋 Pull Request Checklist

Before submitting a pull request, please verify:

- [ ] All new textures are authored in `textures/*.svg` at $512\times512$.
- [ ] Seamless tiling has been verified on both $X$ and $Y$ axes.
- [ ] Ores share the identical base stone background as `stone.svg`.
- [ ] Pack compiles cleanly with `npm run build`.
- [ ] Commits follow Conventional Commits format.
- [ ] Every commit is signed off with DCO (`git commit -s`).
- [ ] Branch is rebased onto latest `origin/main` (no merge commits).

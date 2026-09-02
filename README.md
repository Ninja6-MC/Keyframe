# Keyframe

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/icon-transparent-dark.svg">
    <img src="docs/assets/icon-transparent-light.svg" width="160" height="160" alt="">
  </picture>
</p>

<p align="center">
  <b>The cinematic trailer aesthetic for Minecraft, rendered in infinite vector clarity.</b>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-Community%20ARR-blue.svg" alt="License: Keyframe Community License" /></a>
  <img src="https://img.shields.io/badge/Minecraft-1.20%20--%201.21.4%2B-brightgreen.svg" alt="Minecraft: 1.20 - 1.21.4+" />
  <img src="https://img.shields.io/badge/Resolutions-512x%20%7C%20256x%20%7C%20128x%20%7C%2064x%20%7C%2032x-orange.svg" alt="Resolutions: 512x to 32x" />
</p>

Part of the [Ninja6-MC](https://github.com/Ninja6-MC) suite. Designed with [Texture Studio](https://github.com/Ninja6-MC/texture-studio).

---

## Status

🚧 **Under Development** — *Batch 1 (Plains & Forest Landscape) in progress.*

---

## The Keyframe Vision

Ever wanted Minecraft to look just like the **cinematic animated update trailers and promotional cinematics**?

**Keyframe** brings that warm, joyful, clean art direction to life. Unlike standard pixel-art packs that are locked to low-resolution grids or noisy dithering, Keyframe is authored natively in **infinite-scale vector (SVG) masters** and compiled cleanly into pixel-perfect PNG textures at every resolution tier.

### Key Highlights
* **Cinematic Art Direction**: Saturated meadow greens, rich warm-umber soil, clean stepped grass overhangs, warm honey oak wood, and grounded slate pebbles.
* **Zero Visual Noise**: Eliminates gritty pixel noise and harsh dithering while preserving vanilla recognition.
* **Full Multi-Resolution Support**: Whether playing on a 4K monitor or an entry-level laptop, choose the exact resolution tier that fits your setup.
* **Un-Rotated Clean Tiling**: Bundles custom blockstates for seamless, unified wood grains and terrain surfaces.

---

## Resolution Tiers

| Tier | Package | Ideal For |
|:---|:---|:---|
| **512×512** | `Keyframe-512x.zip` | 🌟 **Ultra HD** — Crisp fidelity on 1440p / 4K displays with shaders. |
| **256×256** | `Keyframe-256x.zip` | 💎 **High Definition** — Balanced HD for 1080p / 1440p gaming. |
| **128×128** | `Keyframe-128x.zip` | ⚡ **Performance HD** — Smooth performance on medium-tier hardware. |
| **64×64** | `Keyframe-64x.zip` | 🍃 **Lightweight** — Fast loading with sharp vector silhouettes. |
| **32×32** | `Keyframe-32x.zip` | 🕹️ **Retro Clean** — Minimalist and fast on any system. |

---

## Recommended Synergy

For the ultimate cinematic Minecraft experience, pair **Keyframe** with:
* **[Fresh Animations](https://modrinth.com/resourcepack/fresh-animations)** — For fluid, expressive creature animations matching the trailer aesthetic.
* **[Complementary Shaders](https://modrinth.com/shader/complementary-reimagined)** — For warm golden-hour sunlight and ambient bounce.

---

## Compiling from Source

Keyframe includes a built-in headless compiler powered by `@resvg/resvg-js` and `archiver`:

```bash
# Clone the repository
git clone https://github.com/Ninja6-MC/Keyframe.git
cd Keyframe

# Install compiler dependencies
npm install

# Compile 512x Ultra HD Pack
npm run build

# Batch compile all 5 resolution tiers
npm run build:all
```

Compiled `.zip` archives are automatically output to `dist/` and deployed to your local `.minecraft/resourcepacks/` directory if detected.

---

## Contributing

Contributions are welcome! Please review our **[Contributing Guidelines](CONTRIBUTING.md)** for detailed setup, vector texture authoring standards, and pull request requirements.

### Quick Checklist
* **SVG Vector Masters**: Authored cleanly in `textures/` at $512\times512$ with verified seamless toroidal tiling.
* **Conventional Commits**: Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (e.g. `feat(textures): ...`).
* **DCO Sign-Off**: Every commit must be signed off (`git commit -s`) per the [Developer Certificate of Origin (DCO)](https://developercertificate.org/).
* **Rebase Workflow**: Keep branches rebased cleanly on `main` (avoid merge commits).

---

## Brand Assets

Two directories hold artwork, and they have opposite rules.

[`docs/assets/`](docs/assets/README.md) is **this repository's own** icon suite, authored
here and generated from [`icon-master.svg`](docs/assets/icon-master.svg) via
[`scripts/export-icons.mjs`](scripts/export-icons.mjs). Edit the master and re-export; do
not edit a generated file.

[`assets/`](assets/) holds the **shared organisation marks** and is **machine-managed**.
It is delivered by pull request from the asset-sync pipeline in the organisation's `brand`
repository, and its master lives there, not here. Anything hand-edited in it is overwritten
by the next sync, so changes to those marks belong in `brand`. See `N6-REPO-03` in the org
standards register, and [`docs/assets/README.md`](docs/assets/README.md) for the pipeline
and master by name.

Both conform to the Ninja6-MC brand identity system. (That system lives in the
organisation's private `brand` repository, so it is named rather than linked - a link
would 404 for everyone reading this.)

---

## License & Disclaimer

**Keyframe Community License** (All Rights Reserved with Permitted Use Grants).  
Free for personal gameplay, YouTube/Twitch content creation, multiplayer servers, and public modpacks. Third-party mirroring, texture ripping, and commercial resale are prohibited. See [LICENSE](LICENSE) for details.

That licence is deliberately **not** OSI-approved, and it is the only non-OSI licence in the
organisation — `SpiralGenesis` and `SessionPulse` are GPL-3.0, `.github` is CC0. A plugin is
source code meant to be forked, built on and redistributed; Keyframe is original artwork
whose value depends on it remaining one attributable pack, so the grants are written around
how a resource pack is actually used — gameplay, streaming, server packs, modpacks — while
withholding the rehosting and derivative-pack rights an open-source licence would have to
give away. GitHub does not recognise the licence, so this repository reports `NOASSERTION`
and shows no licence in the sidebar: that is expected, not an oversight waiting to be
corrected. For what the licence means the moment a download channel is added, see
[`RELEASE_PROCESS.md`](RELEASE_PROCESS.md) §5.

> **NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.**

---

<p align="center">
  <a href="https://github.com/Ninja6-MC"><img src="assets/ninja6-primary-256.png" width="48" height="48" alt=""></a>
</p>

<p align="center">
  <sub>A <a href="https://github.com/Ninja6-MC">Ninja6</a> project.</sub>
</p>

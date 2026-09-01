## Description

<!-- Provide a brief summary of the changes introduced by this pull request. -->

### Affected Assets
<!-- List any new or modified textures, blockstates, or models. Example: textures/block/stone.svg, pack_template/.../stone.json -->
- 

---

## Type of Change

- [ ] `feat`: New vector texture master, blockstate, or compiler capability
- [ ] `fix`: Tiling fix, palette correction, or bugfix
- [ ] `docs`: Documentation improvement
- [ ] `chore` / `refactor`: Maintenance, dependencies, or codebase cleanup

---

## Contributor Checklist

Please check all applicable boxes before requesting review:

### Vector Texture Standards (if adding/modifying SVGs)
- [ ] Authored as a clean $512\times512$ SVG (`viewBox="0 0 512 512"`).
- [ ] Primary shapes are aligned to the $32\text{px}$ texel grid ($16\times16$ grid).
- [ ] **Seamless Toroidal Tiling**: Checked and verified that elements wrapping across $X$ and $Y$ edges align perfectly without seams or chopped shapes.
- [ ] **Ore Consistency**: If adding an ore texture, the stone background geometry and corner radius (`rx`) match [`textures/block/stone.svg`](textures/block/stone.svg) exactly.
- [ ] Free of leftover AI generation comments, unnecessary editor namespaces, or embedded raster images.

### Build & Verification
- [ ] Ran `npm run build` locally and verified that the pack compiles successfully.
- [ ] Verified textures in-game or inspected the rasterized PNG outputs in `dist/`.

### Git Hygiene & Standards
- [ ] Commit message(s) follow [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat(textures): ...`).
- [ ] Every commit is signed off with the Developer Certificate of Origin (`git commit -s`).
- [ ] Branch is rebased cleanly onto latest `main` with no merge commits.
- [ ] Formatting complies with [`.editorconfig`](.editorconfig) (2-space indent, LF endings, trailing newline).

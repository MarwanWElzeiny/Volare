# GitHub Release Prep

Maintainer-only runbook — not shipped in the npm package (unlike `docs/`,
this file is not listed in `package.json`'s `files`). Checklist to publish
Volare publicly. Ordered. Everything above the line is already verified;
start at **Publish**.

## Pre-flight — verified (2026-07-23)

- `npm run validate` — passed (structure, paths, legacy cleanup)
- `npm test` — 17/17 (security envelope + SDK lifecycle)
- `npm run security:audit` — passed
- All 53 relative JS imports resolve; all Markdown links resolve
- `package.json` `exports`/`files`/`main` targets all exist
- No secrets in working tree or in any of the 83 history commits
- No `.env`/key/pem ever committed; `.env.example` is placeholder-only
- Largest file 27 MB (HDR); no file over GitHub's 100 MB limit
- No branded / unlicensed / oversized assets in git history
- Author/copyright consistent everywhere: `Marwan W. Elzeiny` (`LICENSE`, `package.json`)

## Security testing

Before publishing, run through
[`SECURITY.md`'s "How To Test The Security Path"](SECURITY.md#how-to-test-the-security-path) —
automated checks (`npm test`, `npm run security:audit`) plus manual smoke
tests for the protected/chunked delivery routes (nonce, origin, replay,
signature, hash-mismatch cases). That section is the canonical security test
plan; this checklist only tracks release logistics.

## Decision: profile vs studio org

**Recommended: GitHub Organization under the studio name (Volare).**

An org gives:

- Branded home: `github.com/volare-viewer/volare`
- Clean separation of product repos from personal repos
- Team seats later without migrating (transfers lose stars/issues)
- Professional look for an SDK others depend on

Use a **personal profile** only if this stays a solo hobby project with no
brand intent. You can transfer a personal repo to an org later, but the URL
and any stars/forks move with friction — cheaper to start in the org.

To create: GitHub → top-right **+** → **New organization** → Free plan →
name `volare-viewer` (or your studio slug).

## Publish

1. **Decide history**: 83 commits of dev churn (bloated `.git`, ~219 MB).
   - **Keep history** — fine, it's clean. Just push.
   - **Squash to one commit** (recommended for a first public release —
     smaller clone, no messy churn):
     ```bash
     git checkout --orphan release
     git add -A
     git commit -m "Volare 0.1.0-beta.0 — initial public release"
     git branch -M release main
     ```
2. **Commit current work** (the whole restructure is still uncommitted):
   ```bash
   git add -A
   git commit -m "restructure for public release"
   ```
3. **Create the repo** on GitHub (empty, no auto-README/license — you have them).
4. **Push**:
   ```bash
   git remote add origin git@github.com:volare-viewer/volare.git
   git push -u origin main
   ```

## GitHub repo settings to configure

**General**
- Description: "Premium 3D model viewer SDK on Three.js — GLB/glTF/FBX/OBJ, plugins, no server required."
- Website: your demo URL (GitHub Pages, see below)
- Topics: `threejs` `3d-viewer` `gltf` `glb` `webgl` `sdk` `model-viewer` `javascript`
- Features: enable **Issues**, **Discussions** (Q&A); disable Wiki/Projects unless used

**Security**
- Settings → Security → enable **Secret scanning** + **Push protection**
- Enable **Dependabot** alerts + security updates
- A `SECURITY.md` exists → shows under the Security tab automatically

**Branch protection** (Settings → Branches → add rule for `main`)
- Require PR before merge
- Require status checks (add the CI workflow below first)
- Block force-push

**Pages** (optional live demo)
- Settings → Pages → deploy from `main` branch
- Demo is static: `https://volare-viewer.github.io/volare/DEMO/index.html`
- Note: the Node server (`npm start`) and protected-asset features do NOT work
  on Pages — Pages is static only. The viewer + demo work fine.

## Recommended community files

Deleted in cleanup; GitHub nudges for them. Add back if you want contributors:
- `LICENSE` — present (MIT) ✓
- `SECURITY.md` — present ✓
- `CONTRIBUTING.md` — optional (was removed)
- `CODE_OF_CONDUCT.md` — optional (was removed)
- `.github/ISSUE_TEMPLATE/` + PR template — optional (were removed)

## CI (recommended)

Add `.github/workflows/ci.yml` so the gates run on every PR:

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run validate
      - run: npm test
      - run: npm run security:audit
```

CI on Linux is also the real check that the `DEMO/` casing fix holds
(case-sensitive filesystem — your local Windows would not have caught it).

## npm publish (optional — only if shipping to npm)

1. `npm login`
2. Scope `@volare-viewer` must exist on npm (create org there too)
3. `npm publish --access public`
4. `files` ships `SDK/ DEMO/ examples/ docs/ LICENSE README.md CHANGELOG.md` —
   ~250 MB because of demo HDRs. Consider trimming HDRs from the npm package (they're
   demo-only) via a `.npmignore` or dropping `DEMO/` from `files`.

## Tag the release

```bash
git tag -a v0.1.0-beta.0 -m "Volare 0.1.0-beta.0"
git push origin v0.1.0-beta.0
```

Then GitHub → Releases → Draft new release → pick the tag → paste the
CHANGELOG section → mark **pre-release** (it's a beta).

## Optional cleanups before publish

- **HDR weight**: 8 HDRs at ~24–27 MB each ≈ 200 MB. Ship 1–2 K versions for
  the demo and document 4 K as opt-in, or keep 4 K but expect a heavy clone.
- **Version**: `package.json` is `0.1.0-beta.0`; CHANGELOG top is `Unreleased`.
  Rename that heading to the version + date when you tag.

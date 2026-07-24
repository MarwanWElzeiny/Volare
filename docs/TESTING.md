# Testing Volare Before a Release

Run these in order. Stop at the first failure — later steps assume the earlier
ones passed.

## 1. Automated gates (2 minutes)

```bash
npm run validate && npm test && npm run security:audit
```

- **`validate`** — repo structure, path casing, no legacy/dev-tool directories.
- **`test`** — security envelope + VLB crypto + rate limits + 17 SDK lifecycle
  tests.
- **`security:audit`** — no private assets, secrets, or forbidden files in the
  public export; verifies `SECURITY.md` still contains its required honesty
  statements.

All three must print a `passed` / `0 failed` line. If `security:audit` reports
a forbidden file from a local tool directory, delete it and re-run.

## 2. Fresh-install check (5 minutes)

Proves the repo works for someone who just cloned it.

```bash
git clone <your-repo-url> /tmp/volare-fresh
cd /tmp/volare-fresh
npm install
npm run validate && npm test
npm start
```

Then open <http://localhost:3000>. If this fails but your working copy passes,
something needed is untracked — check `git status --ignored`.

## 3. Manual browser pass (15 minutes)

**Do this on a real desktop browser at full window size.** Headless checks and
narrow panes miss layout bugs — several real bugs in this project only appeared
at specific viewport widths.

### `/DEMO/index.html` — gallery flow
1. Page loads. **No viewer or canvas should exist yet** (open DevTools →
   `document.querySelector('#model canvas')` should be `null`).
2. Click a thumbnail → the notice card appears over a blurred, dimmed page (not
   solid black). Still no canvas.
3. Submit → viewer opens, model appears **centered and correctly framed**.
4. DevTools console: no red errors. (Deprecation warnings from three.js and any
   `chrome-extension://` noise from your own browser extensions are expected.)

### `/DEMO/direct.html` — direct viewer
1. Model loads immediately, centered.
2. Orbit / zoom / pan with the mouse.
3. Open the Visual Toolkit → Wireframe → Ambient Occlusion → Original.
4. Advanced Options → Features tab → toggle each of the 9 tools on and off.
5. Mesh Inspector and Material Inspector: while either is open the Visual
   Toolkit must be **invisible and unclickable**; it returns on close.
6. Load an animated model (`?model=brainstem`) → the animation bar appears and
   does not collide with the toolkit.

### `/examples/minimal/index.html` — bare integration
Model renders with no gallery, navbar, or branding. This is what an integrator
copies, so it must work standalone.

### Responsive
Resize the window through **1400px** (the breakpoint) and confirm the toolkit
becomes a bottom sheet rather than covering the screen. Test in a mobile
emulator too.

### Cross-browser
Chrome, Firefox, and Safari — Safari is the one that historically breaks
(`backdrop-filter`, `:has()`, WebGPU support all differ).

## 4. Renderer backends

Default is WebGL. Verify the opt-in path still works:

```js
const viewer = await createVolareViewer({
  container: '#viewer',
  model: './model.glb',
  renderer: { preferredBackend: 'webgpu' }
});
console.log(viewer.viewer.getRendererDiagnostics());
```

Check `selectedBackend`, then confirm the model still renders. WebGPU support
varies by GPU and driver, so test on every device you intend to claim support
for. If it renders blank, that is why WebGL is the default.

## 5. Formats

Load one model of each format you advertise: `.glb`, `.gltf`, `.fbx`, `.obj`,
and `.vlb`. `DEMO/models/` has samples for most. FBX and OBJ loaders are
lazy-loaded, so they exercise a different code path than glTF.

## 6. Protected delivery (only if you ship it)

Follow **[SECURITY.md → How To Test The Security Path](../SECURITY.md#how-to-test-the-security-path)**
for the manual `curl` checks: missing nonce, bad origin, replayed nonce, bad
manifest signature, and direct access to `protected-assets/`. Automated
coverage exists in `npm test`, but those manual checks confirm real HTTP
behavior.

## 7. Memory and disposal

With the viewer open, in DevTools:

```js
viewer.destroy();
```

Then check `viewer.viewer.getDiagnostics()` before disposal and confirm the
canvas is removed from the DOM afterward. Open and close the viewer ~10 times
and watch the JS heap in the Memory panel — it should return to roughly its
starting size, not climb steadily.

## Release sign-off

Everything above passes, plus:

- `git status` is clean.
- `npm pack --dry-run` lists only intended files.
- The version in `package.json` matches the tag you are about to push.
- `CHANGELOG.md` describes this release.

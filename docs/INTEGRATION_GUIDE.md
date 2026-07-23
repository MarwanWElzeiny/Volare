# Integration Guide

How to mount Volare in your own page, from scratch, with none of the demo's
gallery/navbar/branding baggage. A working copy of everything below lives at
[`examples/minimal/index.html`](../examples/minimal/index.html) — copy that
file as your starting point.

## 1. Serve over HTTP

Volare loads as native ES modules. That requires a real HTTP server —
`file://` will not work (browsers block module imports from `file://`).
Any static server works:

```bash
python -m http.server 8000
# or
npx serve
```

## 2. Map Three.js

Volare imports `three`, `three/addons/*`, and `three/webgpu` (used for
automatic WebGPU detection — see [PERFORMANCE.md](PERFORMANCE.md)). If you
don't have a bundler that resolves bare specifiers, map all three via an
import map:

```html
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.167.1/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.167.1/examples/jsm/",
    "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.167.1/build/three.webgpu.js"
  }
}
</script>
```

If you use a bundler (Vite, webpack, esbuild) instead, install `three` as a
real dependency (`npm install three@^0.167.0`) and skip the import map — your
bundler resolves all three specifiers from `node_modules` automatically.

## 3. Add a container

```html
<div id="viewer" style="width: 100%; height: 100vh;"></div>
```

Any element works — Volare sizes its canvas to the container's `clientWidth`/
`clientHeight`, so the container needs a non-zero size.

## 4. Mount the viewer

```html
<script type="module">
  import { createVolareViewer } from './SDK/Core/createVolareViewer.js';

  const viewer = await createVolareViewer({
    container: '#viewer',
    model: './your-model.glb',
    environment: {
      hdri: './your-environment.hdr' // optional; omit for the default lighting rig
    }
  });
</script>
```

That's the entire integration. `createVolareViewer()` is the one public entry
point — it builds the renderer (WebGPU when available, WebGL otherwise; see
[CUSTOMIZATION.md](CUSTOMIZATION.md#renderer)), the scene, controls, and
optionally the full glass-morphism toolkit UI.

## 5. Copy your own assets

Point `model` at any `.glb`/`.gltf`/`.fbx`/`.obj`/`.vlb` URL — see
[FORMATS.md](FORMATS.md). For HDRI lighting, either pass a direct URL via
`environment.hdri`, or use one of the built-in presets:

```js
import { setHdriBasePath } from './SDK/Managers/LightingController.js';
setHdriBasePath('./your-hdr-folder/');

const viewer = await createVolareViewer({
  container: '#viewer',
  model: './your-model.glb',
  environment: { preset: 'studio-small-03' } // see VOLARE_HDRI_PRESETS
});
```

## What you do NOT need

The full `DEMO/` folder is a gallery site built *around* Volare — it has its
own navbar, thumbnail grid, watermark/quick-guide overlays, and Font Awesome/
Boxicons/Swiper CDN includes for that gallery chrome. None of that is part of
the SDK and none of it is required to mount a viewer. If you copied a page
out of `DEMO/` and hit missing icon fonts or broken nav links, that's gallery
cosmetics — strip them, they have nothing to do with Volare initializing.

## Optional: full UI

By default `createVolareViewer()` renders Volare's built-in glass-morphism
toolkit (material modes, HDRI switcher, analysis tools, etc.). To mount a bare
canvas with no UI chrome (e.g. to build your own controls), pass `ui: false`:

```js
const viewer = await createVolareViewer({
  container: '#viewer',
  model: './your-model.glb',
  ui: false
});
```

See [CUSTOMIZATION.md](CUSTOMIZATION.md) for granular UI/tool toggles,
theming, and plugin hooks instead of an all-or-nothing `ui` flag.

## Next steps

- [CUSTOMIZATION.md](CUSTOMIZATION.md) — config reference (theme, tools, renderer backend, plugins)
- [FORMATS.md](FORMATS.md) — supported model formats
- [PLUGINS.md](PLUGINS.md) — lifecycle hooks
- [SECURITY_TESTING.md](SECURITY_TESTING.md) — if you're using protected/chunked asset delivery
